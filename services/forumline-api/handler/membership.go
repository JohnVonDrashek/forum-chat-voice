package handler

import (
	"encoding/json"
	"net/http"

	"github.com/forumline/forumline/services/forumline-api/service"
	"github.com/forumline/forumline/services/forumline-api/store"
	shared "github.com/forumline/forumline/shared-go"
)

type MembershipHandler struct {
	Store        *store.Store
	ForumService *service.ForumService
}

func NewMembershipHandler(s *store.Store, fs *service.ForumService) *MembershipHandler {
	return &MembershipHandler{Store: s, ForumService: fs}
}

func (h *MembershipHandler) HandleGetMemberships(w http.ResponseWriter, r *http.Request) {
	userID := shared.UserIDFromContext(r.Context())
	memberships, err := h.Store.ListMemberships(r.Context(), userID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to fetch memberships"})
		return
	}
	writeJSON(w, http.StatusOK, memberships)
}

func (h *MembershipHandler) HandleUpdateAuth(w http.ResponseWriter, r *http.Request) {
	userID := shared.UserIDFromContext(r.Context())
	ctx := r.Context()

	var body struct {
		ForumDomain string `json:"forum_domain"`
		Authed      *bool  `json:"authed"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}
	if body.ForumDomain == "" || body.Authed == nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Missing forum_domain or authed"})
		return
	}

	forumID := h.Store.GetForumIDByDomain(ctx, body.ForumDomain)
	if forumID == "" {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Forum not found"})
		return
	}
	if err := h.Store.UpdateMembershipAuth(ctx, userID, forumID, *body.Authed); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to update auth state"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *MembershipHandler) HandleToggleMute(w http.ResponseWriter, r *http.Request) {
	userID := shared.UserIDFromContext(r.Context())
	ctx := r.Context()

	var body struct {
		ForumDomain string `json:"forum_domain"`
		Muted       *bool  `json:"muted"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}
	if body.ForumDomain == "" || body.Muted == nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Missing forum_domain or muted"})
		return
	}

	forumID := h.Store.GetForumIDByDomain(ctx, body.ForumDomain)
	if forumID == "" {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Forum not found"})
		return
	}
	if err := h.Store.UpdateMembershipMute(ctx, userID, forumID, *body.Muted); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to update mute state"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *MembershipHandler) HandleJoin(w http.ResponseWriter, r *http.Request) {
	userID := shared.UserIDFromContext(r.Context())
	ctx := r.Context()

	var body struct {
		ForumDomain string `json:"forum_domain"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.ForumDomain == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Missing forum_domain"})
		return
	}

	forumID, err := h.ForumService.ResolveOrDiscoverForum(ctx, body.ForumDomain)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Forum not found and manifest fetch failed"})
		return
	}

	if err := h.Store.UpsertMembership(ctx, userID, forumID); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to join forum"})
		return
	}

	details, err := h.Store.GetMembershipJoinDetails(ctx, forumID, userID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to fetch forum details"})
		return
	}
	writeJSON(w, http.StatusOK, details)
}

func (h *MembershipHandler) HandleLeave(w http.ResponseWriter, r *http.Request) {
	userID := shared.UserIDFromContext(r.Context())
	ctx := r.Context()

	var body struct {
		ForumDomain string `json:"forum_domain"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.ForumDomain == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Missing forum_domain"})
		return
	}

	forumID := h.Store.GetForumIDByDomain(ctx, body.ForumDomain)
	if forumID == "" {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Forum not found"})
		return
	}
	if err := h.Store.DeleteMembership(ctx, userID, forumID); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to leave forum"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
