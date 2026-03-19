package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"

	"github.com/forumline/forumline/backend/auth"
	"github.com/forumline/forumline/backend/httpkit"
	"github.com/forumline/forumline/services/forumline-hub/service"
	"github.com/forumline/forumline/services/forumline-hub/store"
)

type ProfileHandler struct {
	store *store.Store
}

func NewProfileHandler(s *store.Store) *ProfileHandler {
	return &ProfileHandler{store: s}
}

func (h *ProfileHandler) HandleGetSession(w http.ResponseWriter, r *http.Request) {
	userID := auth.UserIDFromContext(r.Context())
	if userID == "" {
		httpkit.WriteJSON(w, http.StatusUnauthorized, map[string]string{"error": "not authenticated"})
		return
	}
	httpkit.WriteJSON(w, http.StatusOK, map[string]interface{}{
		"user": map[string]string{"id": userID},
	})
}

func (h *ProfileHandler) HandleGetIdentity(w http.ResponseWriter, r *http.Request) {
	userID := auth.UserIDFromContext(r.Context())
	ctx := r.Context()

	p, err := h.store.GetProfile(ctx, userID)
	if err != nil && p == nil {
		httpkit.WriteError(w, http.StatusInternalServerError, fmt.Sprintf("failed to fetch profile: %v", err))
		return
	}
	if p == nil {
		authHeader := r.Header.Get("Authorization")
		p, err = provisionProfileFromZitadel(ctx, h.store, userID, authHeader)
		if err != nil {
			log.Printf("[Identity] auto-provision failed for %s: %v", userID, err)
			httpkit.WriteError(w, http.StatusInternalServerError, "failed to create profile")
			return
		}
	}

	avatarURL := ""
	if p.AvatarURL != nil {
		avatarURL = *p.AvatarURL
	}
	resp := map[string]interface{}{
		"forumline_id":       userID,
		"username":           p.Username,
		"display_name":       p.DisplayName,
		"avatar_url":         avatarURL,
		"status_message":     p.StatusMessage,
		"online_status":      p.OnlineStatus,
		"show_online_status": p.ShowOnlineStatus,
	}
	if p.Bio != nil && *p.Bio != "" {
		resp["bio"] = *p.Bio
	}
	httpkit.WriteJSON(w, http.StatusOK, resp)
}

func (h *ProfileHandler) HandleUpdateIdentity(w http.ResponseWriter, r *http.Request) {
	userID := auth.UserIDFromContext(r.Context())

	var body struct {
		DisplayName  *string `json:"display_name"`
		StatusMessage *string `json:"status_message"`
		OnlineStatus  *string `json:"online_status"`
		ShowOnlineStatus *bool `json:"show_online_status"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		httpkit.WriteJSON(w, http.StatusOK, map[string]string{"status": "ok"})
		return
	}

	sets := make(map[string]interface{})
	if body.DisplayName != nil {
		name := strings.TrimSpace(*body.DisplayName)
		if name == "" || len([]rune(name)) > 50 {
			httpkit.WriteError(w, http.StatusBadRequest, "display name must be 1-50 characters")
			return
		}
		sets["display_name"] = name
	}
	if body.StatusMessage != nil {
		msg := strings.TrimSpace(*body.StatusMessage)
		if len([]rune(msg)) > 100 {
			httpkit.WriteError(w, http.StatusBadRequest, "status message must be 100 characters or fewer")
			return
		}
		sets["status_message"] = msg
	}
	if body.OnlineStatus != nil {
		switch *body.OnlineStatus {
		case "online", "away", "offline":
		default:
			httpkit.WriteError(w, http.StatusBadRequest, "online_status must be online, away, or offline")
			return
		}
		sets["online_status"] = *body.OnlineStatus
	}
	if body.ShowOnlineStatus != nil {
		sets["show_online_status"] = *body.ShowOnlineStatus
	}
	if len(sets) > 0 {
		if err := h.store.UpdateProfile(r.Context(), userID, sets); err != nil {
			httpkit.WriteError(w, http.StatusInternalServerError, fmt.Sprintf("failed to update profile: %v", err))
			return
		}
	}
	httpkit.WriteJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (h *ProfileHandler) HandleDeleteIdentity(w http.ResponseWriter, r *http.Request) {
	userID := auth.UserIDFromContext(r.Context())
	ctx := r.Context()

	if err := h.store.DeleteUser(ctx, userID); err != nil {
		httpkit.WriteError(w, http.StatusInternalServerError, fmt.Sprintf("failed to delete account: %v", err))
		return
	}
	z, err := service.GetZitadelClient(ctx)
	if err == nil {
		if err := z.DeleteUser(ctx, userID); err != nil {
			log.Printf("[Identity] warning: failed to delete Zitadel user %s: %v", userID, err)
		}
	}
	httpkit.WriteJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

func (h *ProfileHandler) HandleSearchProfiles(w http.ResponseWriter, r *http.Request) {
	userID := auth.UserIDFromContext(r.Context())
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if q == "" {
		httpkit.WriteError(w, http.StatusBadRequest, "q parameter is required")
		return
	}
	profiles, err := h.store.SearchProfiles(r.Context(), q, userID)
	if err != nil {
		httpkit.WriteError(w, http.StatusInternalServerError, fmt.Sprintf("failed to search profiles: %v", err))
		return
	}
	httpkit.WriteJSON(w, http.StatusOK, profiles)
}

func (h *ProfileHandler) HandleLogout(w http.ResponseWriter, _ *http.Request) {
	httpkit.WriteJSON(w, http.StatusOK, map[string]string{"ok": "true"})
}

var zitadelUserinfoURL string

func init() {
	if u := os.Getenv("ZITADEL_URL"); u != "" {
		zitadelUserinfoURL = u + "/oidc/v1/userinfo"
	}
}

func provisionProfileFromZitadel(ctx context.Context, s *store.Store, userID, authHeader string) (*store.Profile, error) {
	if zitadelUserinfoURL == "" {
		return nil, fmt.Errorf("ZITADEL_URL not set")
	}
	req, err := http.NewRequestWithContext(ctx, "GET", zitadelUserinfoURL, nil)
	if err != nil {
		return nil, err
	}
	if authHeader != "" {
		req.Header.Set("Authorization", authHeader)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("userinfo request failed: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("userinfo returned %d", resp.StatusCode)
	}
	var info struct {
		Sub               string `json:"sub"`
		PreferredUsername string `json:"preferred_username"`
		Name              string `json:"name"`
		GivenName         string `json:"given_name"`
		FamilyName        string `json:"family_name"`
		Picture           string `json:"picture"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&info); err != nil {
		return nil, fmt.Errorf("decode userinfo: %w", err)
	}
	username := info.PreferredUsername
	if username == "" {
		username = "user_" + userID[len(userID)-6:]
	}
	displayName := info.Name
	if displayName == "" {
		displayName = strings.TrimSpace(info.GivenName + " " + info.FamilyName)
	}
	if displayName == "" {
		displayName = username
	}
	if exists, _ := s.UsernameExists(ctx, username); exists {
		username = username + "_" + userID[len(userID)-4:]
	}
	if err := s.CreateProfile(ctx, userID, username, displayName, info.Picture); err != nil {
		return nil, fmt.Errorf("create profile: %w", err)
	}
	return &store.Profile{
		ID: userID, Username: username, DisplayName: displayName,
		StatusMessage: "", OnlineStatus: "online", ShowOnlineStatus: true,
	}, nil
}
