package handler

import (
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/forumline/forumline/services/forumline-api/store"
	shared "github.com/forumline/forumline/shared-go"
)

type NotificationHandler struct {
	Store  *store.Store
	SSEHub *shared.SSEHub
}

func NewNotificationHandler(s *store.Store, hub *shared.SSEHub) *NotificationHandler {
	return &NotificationHandler{Store: s, SSEHub: hub}
}

type notificationResponse struct {
	ID          string `json:"id"`
	Type        string `json:"type"`
	Title       string `json:"title"`
	Body        string `json:"body"`
	Link        string `json:"link"`
	Read        bool   `json:"read"`
	Timestamp   string `json:"timestamp"`
	ForumDomain string `json:"forum_domain"`
	ForumName   string `json:"forum_name"`
}

// HandleNotifications handles GET /api/notifications — reads from local DB.
func (h *NotificationHandler) HandleNotifications(w http.ResponseWriter, r *http.Request) {
	userID := shared.UserIDFromContext(r.Context())

	notifs, err := h.Store.ListNotifications(r.Context(), userID, 50)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to fetch notifications"})
		return
	}

	items := make([]notificationResponse, len(notifs))
	for i, n := range notifs {
		items[i] = notificationResponse{
			ID:          n.ID,
			Type:        n.Type,
			Title:       n.Title,
			Body:        n.Body,
			Link:        n.Link,
			Read:        n.Read,
			Timestamp:   n.CreatedAt,
			ForumDomain: n.ForumDomain,
			ForumName:   n.ForumName,
		}
	}

	writeJSON(w, http.StatusOK, items)
}

// HandleMarkRead handles POST /api/notifications/read.
func (h *NotificationHandler) HandleMarkRead(w http.ResponseWriter, r *http.Request) {
	userID := shared.UserIDFromContext(r.Context())

	var body struct {
		ID string `json:"id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.ID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "id is required"})
		return
	}

	if err := h.Store.MarkNotificationRead(r.Context(), body.ID, userID); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to mark read"})
		return
	}

	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}

// HandleMarkAllRead handles POST /api/notifications/read-all.
func (h *NotificationHandler) HandleMarkAllRead(w http.ResponseWriter, r *http.Request) {
	userID := shared.UserIDFromContext(r.Context())

	if err := h.Store.MarkAllNotificationsRead(r.Context(), userID); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to mark all read"})
		return
	}

	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}

// HandleUnreadCount handles GET /api/notifications/unread.
func (h *NotificationHandler) HandleUnreadCount(w http.ResponseWriter, r *http.Request) {
	userID := shared.UserIDFromContext(r.Context())

	count, err := h.Store.CountUnreadNotifications(r.Context(), userID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to count unread"})
		return
	}

	writeJSON(w, http.StatusOK, map[string]int{"count": count})
}

// HandleStream handles GET /api/notifications/stream (SSE).
// Pushes new notifications in real-time via pg_notify.
func (h *NotificationHandler) HandleStream(w http.ResponseWriter, r *http.Request) {
	tokenStr := r.URL.Query().Get("access_token")
	if tokenStr == "" {
		tokenStr = extractTokenFromRequest(r)
	}
	if tokenStr == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "missing authorization"})
		return
	}
	claims, err := shared.ValidateJWT(tokenStr)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid token"})
		return
	}
	userID := claims.Subject

	client := &shared.SSEClient{
		Channel: "forumline_notification_changes",
		FilterFunc: func(data map[string]interface{}) bool {
			return fmt.Sprintf("%v", data["user_id"]) == userID
		},
		Send: make(chan []byte, 32),
		Done: make(chan struct{}),
	}

	h.SSEHub.Register(client)
	defer func() {
		h.SSEHub.Unregister(client)
		close(client.Done)
	}()

	shared.ServeSSE(w, r, client)
}
