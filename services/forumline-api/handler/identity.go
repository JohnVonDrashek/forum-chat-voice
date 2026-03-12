package handler

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/forumline/forumline/services/forumline-api/store"
	shared "github.com/forumline/forumline/shared-go"
)

type IdentityHandler struct {
	Store *store.Store
}

func NewIdentityHandler(s *store.Store) *IdentityHandler {
	return &IdentityHandler{Store: s}
}

func (h *IdentityHandler) HandleGetIdentity(w http.ResponseWriter, r *http.Request) {
	userID := shared.UserIDFromContext(r.Context())
	p, err := h.Store.GetProfile(r.Context(), userID)
	if err != nil || p == nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Profile not found"})
		return
	}

	avatarURL := ""
	if p.AvatarURL != nil {
		avatarURL = *p.AvatarURL
	}
	result := map[string]interface{}{
		"forumline_id": userID, "username": p.Username, "display_name": p.DisplayName,
		"avatar_url": avatarURL, "status_message": p.StatusMessage,
		"online_status": p.OnlineStatus, "show_online_status": p.ShowOnlineStatus,
	}
	if p.Bio != nil && *p.Bio != "" {
		result["bio"] = *p.Bio
	}
	writeJSON(w, http.StatusOK, result)
}

func (h *IdentityHandler) HandleUpdateIdentity(w http.ResponseWriter, r *http.Request) {
	userID := shared.UserIDFromContext(r.Context())

	var body struct {
		Username         *string `json:"username"`
		StatusMessage    *string `json:"status_message"`
		OnlineStatus     *string `json:"online_status"`
		ShowOnlineStatus *bool   `json:"show_online_status"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
		return
	}

	sets := make(map[string]interface{})

	if body.Username != nil {
		name := strings.TrimSpace(*body.Username)
		if name == "" || utf8.RuneCountInString(name) > 50 {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Display name must be 1-50 characters"})
			return
		}
		sets["display_name"] = name
	}
	if body.StatusMessage != nil {
		msg := strings.TrimSpace(*body.StatusMessage)
		if utf8.RuneCountInString(msg) > 100 {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Status message must be 100 characters or fewer"})
			return
		}
		sets["status_message"] = msg
	}
	if body.OnlineStatus != nil {
		switch *body.OnlineStatus {
		case "online", "away", "offline":
		default:
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "online_status must be online, away, or offline"})
			return
		}
		sets["online_status"] = *body.OnlineStatus
	}
	if body.ShowOnlineStatus != nil {
		sets["show_online_status"] = *body.ShowOnlineStatus
	}

	if len(sets) == 0 {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
		return
	}

	if err := h.Store.UpdateProfile(r.Context(), userID, sets); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to update profile"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (h *IdentityHandler) HandleDeleteIdentity(w http.ResponseWriter, r *http.Request) {
	userID := shared.UserIDFromContext(r.Context())
	if err := h.Store.DeleteUser(r.Context(), userID); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to delete account"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

func (h *IdentityHandler) HandleSearchProfiles(w http.ResponseWriter, r *http.Request) {
	userID := shared.UserIDFromContext(r.Context())
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if q == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "q parameter is required"})
		return
	}

	profiles, err := h.Store.SearchProfiles(r.Context(), q, userID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to search profiles"})
		return
	}
	writeJSON(w, http.StatusOK, profiles)
	_ = fmt.Sprintf // suppress unused import if needed
}
