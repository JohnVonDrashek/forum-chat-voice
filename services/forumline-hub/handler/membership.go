package handler

import (
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/google/uuid"

	"github.com/forumline/forumline/backend/auth"
	"github.com/forumline/forumline/backend/httpkit"
	"github.com/forumline/forumline/services/forumline-hub/service"
	"github.com/forumline/forumline/services/forumline-hub/store"
)

type MembershipHandler struct {
	store    *store.Store
	forumSvc *service.ForumService
}

func NewMembershipHandler(s *store.Store, fs *service.ForumService) *MembershipHandler {
	return &MembershipHandler{store: s, forumSvc: fs}
}

func (h *MembershipHandler) HandleList(w http.ResponseWriter, r *http.Request) {
	userID := auth.UserIDFromContext(r.Context())
	memberships, err := h.store.ListMemberships(r.Context(), userID)
	if err != nil {
		httpkit.WriteError(w, http.StatusInternalServerError, "failed to fetch memberships")
		return
	}
	httpkit.WriteJSON(w, http.StatusOK, memberships)
}

func (h *MembershipHandler) HandleUpdateAuth(w http.ResponseWriter, r *http.Request) {
	userID := auth.UserIDFromContext(r.Context())
	var body struct {
		ForumDomain string `json:"forum_domain"`
		Authed      bool   `json:"authed"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		httpkit.WriteError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	forumID := h.store.GetForumIDByDomain(r.Context(), body.ForumDomain)
	if forumID == uuid.Nil {
		httpkit.WriteError(w, http.StatusNotFound, "forum not found")
		return
	}
	if err := h.store.UpdateMembershipAuth(r.Context(), userID, forumID, body.Authed); err != nil {
		httpkit.WriteError(w, http.StatusInternalServerError, fmt.Sprintf("failed to update auth state: %v", err))
		return
	}
	httpkit.WriteJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *MembershipHandler) HandleToggleMute(w http.ResponseWriter, r *http.Request) {
	userID := auth.UserIDFromContext(r.Context())
	var body struct {
		ForumDomain string `json:"forum_domain"`
		Muted       bool   `json:"muted"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		httpkit.WriteError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	forumID := h.store.GetForumIDByDomain(r.Context(), body.ForumDomain)
	if forumID == uuid.Nil {
		httpkit.WriteError(w, http.StatusNotFound, "forum not found")
		return
	}
	if err := h.store.UpdateMembershipMute(r.Context(), userID, forumID, body.Muted); err != nil {
		httpkit.WriteError(w, http.StatusInternalServerError, fmt.Sprintf("failed to update mute state: %v", err))
		return
	}
	httpkit.WriteJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *MembershipHandler) HandleJoin(w http.ResponseWriter, r *http.Request) {
	userID := auth.UserIDFromContext(r.Context())
	var body struct {
		ForumDomain string `json:"forum_domain"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.ForumDomain == "" {
		httpkit.WriteError(w, http.StatusBadRequest, "forum_domain is required")
		return
	}
	ctx := r.Context()
	forumID, err := h.forumSvc.ResolveOrDiscoverForum(ctx, body.ForumDomain)
	if err != nil {
		httpkit.WriteError(w, http.StatusNotFound, "forum not found and manifest fetch failed")
		return
	}
	if err := h.store.UpsertMembership(ctx, userID, forumID); err != nil {
		httpkit.WriteError(w, http.StatusInternalServerError, fmt.Sprintf("failed to join forum: %v", err))
		return
	}
	details, err := h.store.GetMembershipJoinDetails(ctx, forumID, userID)
	if err != nil {
		httpkit.WriteError(w, http.StatusInternalServerError, fmt.Sprintf("failed to fetch forum details: %v", err))
		return
	}
	httpkit.WriteJSON(w, http.StatusOK, details)
}

func (h *MembershipHandler) HandleLeave(w http.ResponseWriter, r *http.Request) {
	userID := auth.UserIDFromContext(r.Context())
	var body struct {
		ForumDomain string `json:"forum_domain"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.ForumDomain == "" {
		httpkit.WriteError(w, http.StatusBadRequest, "forum_domain is required")
		return
	}
	forumID := h.store.GetForumIDByDomain(r.Context(), body.ForumDomain)
	if forumID == uuid.Nil {
		httpkit.WriteError(w, http.StatusNotFound, "forum not found")
		return
	}
	if err := h.store.DeleteMembership(r.Context(), userID, forumID); err != nil {
		httpkit.WriteError(w, http.StatusInternalServerError, fmt.Sprintf("failed to leave forum: %v", err))
		return
	}
	httpkit.WriteJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
