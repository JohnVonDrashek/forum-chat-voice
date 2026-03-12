package handler

import (
	"net/http"
	"strings"

	"github.com/forumline/forumline/services/forumline-api/presence"
	"github.com/forumline/forumline/services/forumline-api/store"
	shared "github.com/forumline/forumline/shared-go"
)

type PresenceHandler struct {
	Store    *store.Store
	Tracker  *presence.Tracker
}

func NewPresenceHandler(s *store.Store, t *presence.Tracker) *PresenceHandler {
	return &PresenceHandler{Store: s, Tracker: t}
}

func (h *PresenceHandler) HandleHeartbeat(w http.ResponseWriter, r *http.Request) {
	userID := shared.UserIDFromContext(r.Context())
	h.Tracker.Touch(userID)
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *PresenceHandler) HandleStatus(w http.ResponseWriter, r *http.Request) {
	idsParam := r.URL.Query().Get("userIds")
	if idsParam == "" {
		writeJSON(w, http.StatusOK, map[string]bool{})
		return
	}

	userIDs := strings.Split(idsParam, ",")
	if len(userIDs) > 200 {
		userIDs = userIDs[:200]
	}

	status := h.Tracker.OnlineStatusBatch(userIDs)

	prefs, err := h.Store.GetOnlineStatusPreferences(r.Context(), userIDs)
	if err == nil {
		for uid, showOnline := range prefs {
			if !showOnline {
				status[uid] = false
			}
		}
	}

	writeJSON(w, http.StatusOK, status)
}
