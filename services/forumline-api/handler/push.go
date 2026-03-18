package handler

import (
	"encoding/json"
	"net/http"
	"os"
	"strings"

	"github.com/google/uuid"

	"github.com/forumline/forumline/backend/auth"
	"github.com/forumline/forumline/services/forumline-api/service"
	"github.com/forumline/forumline/services/forumline-api/store"
)

type PushHandler struct {
	Store       *store.Store
	PushService *service.PushService
}

func NewPushHandler(s *store.Store, ps *service.PushService) *PushHandler {
	return &PushHandler{Store: s, PushService: ps}
}

// HandleConfig returns the VAPID public key so the frontend can subscribe to web push.
func (h *PushHandler) HandleConfig(w http.ResponseWriter, r *http.Request) {
	vapidKey := os.Getenv("VAPID_PUBLIC_KEY")
	if vapidKey == "" {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "push not configured"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"vapid_public_key": vapidKey})
}

func (h *PushHandler) Handle(w http.ResponseWriter, r *http.Request) {
	action := r.URL.Query().Get("action")
	if action == "notify" && r.Method == http.MethodPost {
		h.HandleNotify(w, r)
		return
	}
	if action == "subscribe" {
		h.handleSubscribe(w, r)
		return
	}
	writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Missing or invalid action query param"})
}

func (h *PushHandler) handleSubscribe(w http.ResponseWriter, r *http.Request) {
	userID := auth.UserIDFromContext(r.Context())
	ctx := r.Context()

	if r.Method == http.MethodPost {
		var body struct {
			Endpoint string `json:"endpoint"`
			Keys     struct {
				P256dh string `json:"p256dh"`
				Auth   string `json:"auth"`
			} `json:"keys"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
			return
		}
		if body.Endpoint == "" || body.Keys.P256dh == "" || body.Keys.Auth == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Missing subscription fields"})
			return
		}
		if err := h.Store.UpsertPushSubscription(ctx, userID, body.Endpoint, body.Keys.P256dh, body.Keys.Auth); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
		return
	}

	if r.Method == http.MethodDelete {
		var body struct {
			Endpoint string `json:"endpoint"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Endpoint == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Missing endpoint"})
			return
		}
		_ = h.Store.DeletePushSubscription(ctx, userID, body.Endpoint)
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
		return
	}

	writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "Method not allowed"})
}

// HandleNotify handles POST /api/push?action=notify (service key auth).
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
		exists, _ := h.Store.ProfileExists(r.Context(), body.ForumlineID)
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

	// Check mute
	if body.ForumDomain != "" {
		forumID := h.Store.GetForumIDByDomain(ctx, body.ForumDomain)
		if forumID != uuid.Nil {
			muted, err := h.Store.IsNotificationsMuted(ctx, targetUserID, forumID)
			if err != nil {
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
