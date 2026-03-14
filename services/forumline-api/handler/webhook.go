package handler

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/forumline/forumline/services/forumline-api/store"
)

type WebhookHandler struct {
	Store *store.Store
}

func NewWebhookHandler(s *store.Store) *WebhookHandler {
	return &WebhookHandler{Store: s}
}

// HandleNotification handles POST /api/webhooks/notification.
// Forums call this to push notifications to forumline when they are created.
// Auth: Bearer JWT signed with FORUMLINE_JWT_SECRET, sub=forum_domain, iss="forum".
func (h *WebhookHandler) HandleNotification(w http.ResponseWriter, r *http.Request) {
	forumDomain, err := h.authenticateForumWebhook(r)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Unauthorized"})
		return
	}

	var body struct {
		ForumlineUserID string `json:"forumline_user_id"`
		Type            string `json:"type"`
		Title           string `json:"title"`
		Body            string `json:"body"`
		Link            string `json:"link"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid JSON"})
		return
	}
	if body.ForumlineUserID == "" || body.Type == "" || body.Title == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "forumline_user_id, type, and title are required"})
		return
	}

	ctx := r.Context()

	// Verify user exists
	exists, err := h.Store.UserExists(ctx, body.ForumlineUserID)
	if err != nil || !exists {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "User not found"})
		return
	}

	// Check if muted
	muted, _ := h.Store.IsNotificationsMutedByDomain(ctx, body.ForumlineUserID, forumDomain)
	if muted {
		writeJSON(w, http.StatusOK, map[string]string{"status": "muted"})
		return
	}

	// Look up forum name
	forumName, err := h.Store.GetForumNameByDomain(ctx, forumDomain)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Forum not registered"})
		return
	}

	link := body.Link
	if link == "" {
		link = "/"
	}

	if err := h.Store.InsertNotification(ctx, body.ForumlineUserID, forumDomain, forumName, body.Type, body.Title, body.Body, link); err != nil {
		log.Printf("[webhook] failed to insert notification: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to store notification"})
		return
	}

	writeJSON(w, http.StatusCreated, map[string]string{"status": "ok"})
}

// HandleNotificationBatch handles POST /api/webhooks/notifications (plural).
// Accepts an array of notifications from a single forum.
func (h *WebhookHandler) HandleNotificationBatch(w http.ResponseWriter, r *http.Request) {
	forumDomain, err := h.authenticateForumWebhook(r)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Unauthorized"})
		return
	}

	var items []struct {
		ForumlineUserID string `json:"forumline_user_id"`
		Type            string `json:"type"`
		Title           string `json:"title"`
		Body            string `json:"body"`
		Link            string `json:"link"`
	}
	if err := json.NewDecoder(r.Body).Decode(&items); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid JSON"})
		return
	}

	ctx := r.Context()
	forumName, err := h.Store.GetForumNameByDomain(ctx, forumDomain)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Forum not registered"})
		return
	}

	inserted := 0
	for _, item := range items {
		if item.ForumlineUserID == "" || item.Type == "" || item.Title == "" {
			continue
		}
		exists, err := h.Store.UserExists(ctx, item.ForumlineUserID)
		if err != nil || !exists {
			continue
		}
		muted, _ := h.Store.IsNotificationsMutedByDomain(ctx, item.ForumlineUserID, forumDomain)
		if muted {
			continue
		}
		link := item.Link
		if link == "" {
			link = "/"
		}
		if err := h.Store.InsertNotification(ctx, item.ForumlineUserID, forumDomain, forumName, item.Type, item.Title, item.Body, link); err != nil {
			log.Printf("[webhook] batch insert error: %v", err)
			continue
		}
		inserted++
	}

	writeJSON(w, http.StatusCreated, map[string]int{"inserted": inserted})
}

// authenticateForumWebhook validates a forum-signed JWT and returns the forum domain.
func (h *WebhookHandler) authenticateForumWebhook(r *http.Request) (string, error) {
	secret := os.Getenv("FORUMLINE_JWT_SECRET")
	if secret == "" {
		return "", fmt.Errorf("FORUMLINE_JWT_SECRET not set")
	}

	auth := r.Header.Get("Authorization")
	if len(auth) < 8 || auth[:7] != "Bearer " {
		return "", fmt.Errorf("missing or invalid authorization header")
	}
	tokenStr := auth[7:]

	parsed, err := jwt.ParseWithClaims(tokenStr, &jwt.RegisteredClaims{}, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method")
		}
		return []byte(secret), nil
	})
	if err != nil {
		return "", err
	}
	if !parsed.Valid {
		return "", fmt.Errorf("invalid token")
	}

	claims, ok := parsed.Claims.(*jwt.RegisteredClaims)
	if !ok || claims.Subject == "" {
		return "", fmt.Errorf("missing subject")
	}
	if claims.Issuer != "forum" {
		return "", fmt.Errorf("invalid issuer: %s", claims.Issuer)
	}

	// Verify expiry (jwt library handles this, but be explicit)
	if claims.ExpiresAt != nil && claims.ExpiresAt.Before(time.Now()) {
		return "", fmt.Errorf("token expired")
	}

	return claims.Subject, nil
}
