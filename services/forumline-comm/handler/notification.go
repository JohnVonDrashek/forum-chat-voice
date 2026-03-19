package handler

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/forumline/forumline/backend/auth"
	"github.com/forumline/forumline/backend/events"
	"github.com/forumline/forumline/backend/pubsub"
	"github.com/forumline/forumline/services/forumline-comm/service"
	"github.com/forumline/forumline/services/forumline-comm/sqlcdb"
)

type NotificationHandler struct {
	Q        *sqlcdb.Queries
	EventBus pubsub.EventBus
}

func NewNotificationHandler(q *sqlcdb.Queries, bus pubsub.EventBus) *NotificationHandler {
	return &NotificationHandler{Q: q, EventBus: bus}
}

func (h *NotificationHandler) HandleList(w http.ResponseWriter, r *http.Request) {
	userID := auth.UserIDFromContext(r.Context())
	rows, err := h.Q.ListNotifications(r.Context(), sqlcdb.ListNotificationsParams{
		UserID: userID,
		Limit:  50,
	})
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to fetch notifications"})
		return
	}

	notifs := make([]service.NotificationRow, 0, len(rows))
	for _, r := range rows {
		notifs = append(notifs, service.NotificationRow{
			ID:          r.ID,
			ForumDomain: r.ForumDomain,
			ForumName:   r.ForumName,
			Type:        r.Type,
			Title:       r.Title,
			Body:        r.Body,
			Link:        r.Link,
			Read:        r.Read,
			CreatedAt:   r.CreatedAt.Format(time.RFC3339),
		})
	}
	if len(notifs) == 0 {
		notifs = []service.NotificationRow{}
	}
	writeJSON(w, http.StatusOK, notifs)
}

func (h *NotificationHandler) HandleUnreadCount(w http.ResponseWriter, r *http.Request) {
	userID := auth.UserIDFromContext(r.Context())
	count, err := h.Q.CountUnreadNotifications(r.Context(), userID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to count unread"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]int{"count": int(count)})
}

func (h *NotificationHandler) HandleMarkRead(w http.ResponseWriter, r *http.Request) {
	userID := auth.UserIDFromContext(r.Context())
	var body struct {
		ID string `json:"id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}
	notifID, err := uuid.Parse(body.ID)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid notification id"})
		return
	}
	if err := h.Q.MarkNotificationRead(r.Context(), sqlcdb.MarkNotificationReadParams{
		ID:     notifID,
		UserID: userID,
	}); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to mark read"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}

func (h *NotificationHandler) HandleMarkAllRead(w http.ResponseWriter, r *http.Request) {
	userID := auth.UserIDFromContext(r.Context())
	if err := h.Q.MarkAllNotificationsRead(r.Context(), userID); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to mark all read"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}

func (h *NotificationHandler) HandleWebhookNotification(w http.ResponseWriter, r *http.Request) {
	if !checkServiceKey(r) {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "invalid authorization"})
		return
	}
	var body struct {
		ForumlineUserID string `json:"forumline_user_id"`
		ForumDomain     string `json:"forum_domain"`
		Type            string `json:"type"`
		Title           string `json:"title"`
		Body            string `json:"body"`
		Link            string `json:"link"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}
	if body.ForumlineUserID == "" || body.Type == "" || body.Title == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "missing required fields"})
		return
	}
	forumName := body.ForumDomain
	if name, err := h.Q.GetForumNameByDomain(r.Context(), body.ForumDomain); err == nil {
		forumName = name
	}
	link := body.Link
	if link == "" {
		link = "/"
	}
	row, err := h.Q.InsertNotification(r.Context(), sqlcdb.InsertNotificationParams{
		UserID:      body.ForumlineUserID,
		ForumDomain: body.ForumDomain,
		ForumName:   forumName,
		Type:        body.Type,
		Title:       body.Title,
		Body:        body.Body,
		Link:        link,
	})
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to create notification"})
		return
	}
	if h.EventBus != nil {
		_ = events.Publish(h.EventBus, r.Context(), "forumline_notification_changes", events.ForumlineNotificationEvent{
			ID:          row.ID,
			UserID:      body.ForumlineUserID,
			ForumDomain: body.ForumDomain,
			ForumName:   forumName,
			Type:        body.Type,
			Title:       body.Title,
			Body:        body.Body,
			Link:        link,
			Read:        false,
			CreatedAt:   row.CreatedAt,
		})
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (h *NotificationHandler) HandleWebhookNotificationBatch(w http.ResponseWriter, r *http.Request) {
	if !checkServiceKey(r) {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "invalid authorization"})
		return
	}
	var body struct {
		ForumDomain string `json:"forum_domain"`
		ForumName   string `json:"forum_name"`
		Items       []struct {
			ForumlineUserID string `json:"forumline_user_id"`
			Type            string `json:"type"`
			Title           string `json:"title"`
			Body            string `json:"body"`
			Link            string `json:"link"`
		} `json:"items"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}
	forumName := body.ForumName
	if forumName == "" {
		if name, err := h.Q.GetForumNameByDomain(r.Context(), body.ForumDomain); err == nil {
			forumName = name
		} else {
			forumName = body.ForumDomain
		}
	}
	inserted := 0
	for _, item := range body.Items {
		if item.ForumlineUserID == "" || item.Type == "" || item.Title == "" {
			continue
		}
		link := item.Link
		if link == "" {
			link = "/"
		}
		row, err := h.Q.InsertNotification(r.Context(), sqlcdb.InsertNotificationParams{
			UserID:      item.ForumlineUserID,
			ForumDomain: body.ForumDomain,
			ForumName:   forumName,
			Type:        item.Type,
			Title:       item.Title,
			Body:        item.Body,
			Link:        link,
		})
		if err != nil {
			log.Printf("[webhook] batch insert error: %v", err)
			continue
		}
		if h.EventBus != nil {
			_ = events.Publish(h.EventBus, r.Context(), "forumline_notification_changes", events.ForumlineNotificationEvent{
				ID:          row.ID,
				UserID:      item.ForumlineUserID,
				ForumDomain: body.ForumDomain,
				ForumName:   forumName,
				Type:        item.Type,
				Title:       item.Title,
				Body:        item.Body,
				Link:        link,
				Read:        false,
				CreatedAt:   row.CreatedAt,
			})
		}
		inserted++
	}
	writeJSON(w, http.StatusOK, map[string]int{"inserted": inserted})
}

func checkServiceKey(r *http.Request) bool {
	authHeader := r.Header.Get("Authorization")
	if !strings.HasPrefix(authHeader, "Bearer ") {
		return false
	}
	token := strings.TrimPrefix(authHeader, "Bearer ")
	serviceKey := os.Getenv("ZITADEL_SERVICE_USER_PAT")
	return serviceKey != "" && token == serviceKey
}
