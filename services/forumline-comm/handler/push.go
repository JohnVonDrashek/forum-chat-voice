package handler

import (
	"encoding/json"
	"net/http"
	"os"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/forumline/forumline/backend/auth"
	"github.com/forumline/forumline/services/forumline-comm/service"
	"github.com/forumline/forumline/services/forumline-comm/sqlcdb"
)

type PushHandler struct {
	Q           *sqlcdb.Queries
	PushService *service.PushService
}

func NewPushHandler(q *sqlcdb.Queries, ps *service.PushService) *PushHandler {
	return &PushHandler{Q: q, PushService: ps}
}

func (h *PushHandler) HandleConfig(w http.ResponseWriter, _ *http.Request) {
	vapidKey := os.Getenv("VAPID_PUBLIC_KEY")
	if vapidKey == "" {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "push not configured"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"vapid_public_key": vapidKey})
}

func (h *PushHandler) HandleSubscribe(w http.ResponseWriter, r *http.Request) {
	userID := auth.UserIDFromContext(r.Context())
	action := r.URL.Query().Get("action")

	var body struct {
		Endpoint string `json:"endpoint"`
		Keys     *struct {
			P256dh string `json:"p256dh"`
			Auth   string `json:"auth"`
		} `json:"keys"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}
	if body.Endpoint == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "endpoint is required"})
		return
	}

	if action == "subscribe" {
		if body.Keys == nil || body.Keys.P256dh == "" || body.Keys.Auth == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "keys.p256dh and keys.auth are required for subscribe"})
			return
		}
		if err := h.Q.UpsertPushSubscription(r.Context(), sqlcdb.UpsertPushSubscriptionParams{
			UserID:   userID,
			Endpoint: body.Endpoint,
			P256dh:   body.Keys.P256dh,
			Auth:     body.Keys.Auth,
		}); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to save subscription"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
		return
	}

	// unsubscribe
	_ = h.Q.DeletePushSubscription(r.Context(), sqlcdb.DeletePushSubscriptionParams{
		UserID:   userID,
		Endpoint: body.Endpoint,
	})
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *PushHandler) HandleNotify(w http.ResponseWriter, r *http.Request) {
	authHeader := r.Header.Get("Authorization")
	if !strings.HasPrefix(authHeader, "Bearer ") {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Missing authorization"})
		return
	}
	token := strings.TrimPrefix(authHeader, "Bearer ")
	serviceKey := os.Getenv("ZITADEL_SERVICE_USER_PAT")
	if serviceKey == "" || token != serviceKey {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Invalid authorization"})
		return
	}

	var body struct {
		ForumlineID string `json:"forumline_id"`
		UserID      string `json:"user_id"`
		Title       string `json:"title"`
		Body        string `json:"body"`
		Link        string `json:"link"`
		ForumDomain string `json:"forum_domain"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}
	if body.Title == "" || body.Body == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Missing title or body"})
		return
	}

	ctx := r.Context()
	targetUserID := body.UserID
	if targetUserID == "" && body.ForumlineID != "" {
		exists, _ := h.Q.ProfileExists(r.Context(), body.ForumlineID)
		if !exists {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "User not found"})
			return
		}
		targetUserID = body.ForumlineID
	}
	if targetUserID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Missing user_id or forumline_id"})
		return
	}

	if body.ForumDomain != "" {
		forumID, err := h.Q.GetForumIDByDomain(ctx, body.ForumDomain)
		if err == nil && forumID != uuid.Nil {
			muted, err := h.Q.IsNotificationsMuted(ctx, sqlcdb.IsNotificationsMutedParams{
				UserID:  targetUserID,
				ForumID: forumID,
			})
			if err != nil && err != pgx.ErrNoRows {
				writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to check mute status"})
				return
			}
			if muted {
				writeJSON(w, http.StatusOK, map[string]interface{}{"ok": true, "skipped": "forum_muted"})
				return
			}
		}
	}

	sent := h.PushService.SendToUser(ctx, targetUserID, body.Title, body.Body, body.Link, body.ForumDomain)
	writeJSON(w, http.StatusOK, map[string]interface{}{"ok": true, "sent": sent})
}
