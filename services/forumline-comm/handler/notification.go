package handler

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"strings"

	"github.com/google/uuid"

	"github.com/forumline/forumline/backend/auth"
	"github.com/forumline/forumline/backend/events"
	"github.com/forumline/forumline/backend/pubsub"
	"github.com/forumline/forumline/services/forumline-comm/store"
)

type NotificationHandler struct {
	Store    *store.Store
	EventBus pubsub.EventBus
}

func NewNotificationHandler(s *store.Store, bus pubsub.EventBus) *NotificationHandler {
	return &NotificationHandler{Store: s, EventBus: bus}
}

func (h *NotificationHandler) HandleList(w http.ResponseWriter, r *http.Request) {
	userID := auth.UserIDFromContext(r.Context())
	notifs, err := h.Store.ListNotifications(r.Context(), userID, 50)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to fetch notifications"})
		return
	}
	writeJSON(w, http.StatusOK, notifs)
}

func (h *NotificationHandler) HandleUnreadCount(w http.ResponseWriter, r *http.Request) {
	userID := auth.UserIDFromContext(r.Context())
	count, err := h.Store.CountUnreadNotifications(r.Context(), userID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to count unread"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]int{"count": count})
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
	if err := h.Store.MarkNotificationRead(r.Context(), notifID, userID); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to mark read"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}

func (h *NotificationHandler) HandleMarkAllRead(w http.ResponseWriter, r *http.Request) {
	userID := auth.UserIDFromContext(r.Context())
	if err := h.Store.MarkAllNotificationsRead(r.Context(), userID); err != nil {
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
	if name, err := h.Store.GetForumNameByDomain(r.Context(), body.ForumDomain); err == nil {
		forumName = name
	}
	link := body.Link
	if link == "" {
		link = "/"
	}
	id, createdAt, err := h.Store.InsertNotification(r.Context(), body.ForumlineUserID, body.ForumDomain, forumName, body.Type, body.Title, body.Body, link)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to create notification"})
		return
	}
	if h.EventBus != nil {
		_ = events.Publish(h.EventBus, r.Context(), "forumline_notification_changes", events.ForumlineNotificationEvent{
			ID:          id,
			UserID:      body.ForumlineUserID,
			ForumDomain: body.ForumDomain,
			ForumName:   forumName,
			Type:        body.Type,
			Title:       body.Title,
			Body:        body.Body,
			Link:        link,
			Read:        false,
			CreatedAt:   createdAt,
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
		if name, err := h.Store.GetForumNameByDomain(r.Context(), body.ForumDomain); err == nil {
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
		id, createdAt, err := h.Store.InsertNotification(r.Context(), item.ForumlineUserID, body.ForumDomain, forumName, item.Type, item.Title, item.Body, link)
		if err != nil {
			log.Printf("[webhook] batch insert error: %v", err)
			continue
		}
		if h.EventBus != nil {
			_ = events.Publish(h.EventBus, r.Context(), "forumline_notification_changes", events.ForumlineNotificationEvent{
				ID:          id,
				UserID:      item.ForumlineUserID,
				ForumDomain: body.ForumDomain,
				ForumName:   forumName,
				Type:        item.Type,
				Title:       item.Title,
				Body:        item.Body,
				Link:        link,
				Read:        false,
				CreatedAt:   createdAt,
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
