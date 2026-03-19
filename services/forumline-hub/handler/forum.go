package handler

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"

	"github.com/google/uuid"

	"github.com/forumline/forumline/backend/auth"
	"github.com/forumline/forumline/backend/httpkit"
	"github.com/forumline/forumline/services/forumline-hub/service"
	"github.com/forumline/forumline/services/forumline-hub/store"
)

type ForumHandler struct {
	store    *store.Store
	forumSvc *service.ForumService
}

func NewForumHandler(s *store.Store, fs *service.ForumService) *ForumHandler {
	return &ForumHandler{store: s, forumSvc: fs}
}

func (h *ForumHandler) HandleListForums(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	search := strings.TrimSpace(q.Get("q"))
	tag := strings.TrimSpace(q.Get("tag"))
	sortOrder := q.Get("sort")
	if sortOrder == "" {
		sortOrder = "popular"
	}
	limit := 50
	offset := 0
	if v := q.Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 100 {
			limit = n
		}
	}
	if v := q.Get("offset"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 0 {
			offset = n
		}
	}

	forums, err := h.store.ListForums(r.Context(), search, tag, sortOrder, limit, offset)
	if err != nil {
		httpkit.WriteError(w, http.StatusInternalServerError, "Failed to fetch forums")
		return
	}
	httpkit.WriteJSON(w, http.StatusOK, forums)
}

func (h *ForumHandler) HandleListTags(w http.ResponseWriter, r *http.Request) {
	tags, err := h.store.ListForumTags(r.Context())
	if err != nil {
		httpkit.WriteError(w, http.StatusInternalServerError, "Failed to fetch tags")
		return
	}
	httpkit.WriteJSON(w, http.StatusOK, tags)
}

func (h *ForumHandler) HandleRecommended(w http.ResponseWriter, r *http.Request) {
	userID := auth.UserIDFromContext(r.Context())
	forums, err := h.store.ListRecommendedForums(r.Context(), userID)
	if err != nil {
		httpkit.WriteError(w, http.StatusInternalServerError, "Failed to fetch recommendations")
		return
	}
	httpkit.WriteJSON(w, http.StatusOK, forums)
}

func (h *ForumHandler) HandleListOwned(w http.ResponseWriter, r *http.Request) {
	userID := auth.UserIDFromContext(r.Context())
	forums, err := h.store.ListOwnedForums(r.Context(), userID)
	if err != nil {
		httpkit.WriteError(w, http.StatusInternalServerError, "Failed to fetch owned forums")
		return
	}
	httpkit.WriteJSON(w, http.StatusOK, forums)
}

func (h *ForumHandler) HandleRegister(w http.ResponseWriter, r *http.Request) {
	userID := auth.UserIDFromContext(r.Context())

	var body struct {
		Domain       string   `json:"domain"`
		Name         string   `json:"name"`
		APIBase      string   `json:"api_base"`
		WebBase      string   `json:"web_base"`
		Capabilities []string `json:"capabilities"`
		Description  *string  `json:"description"`
		Tags         []string `json:"tags"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		httpkit.WriteError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	result, err := h.forumSvc.RegisterForum(r.Context(), userID, service.RegisterForumInput{
		Domain:       body.Domain,
		Name:         body.Name,
		APIBase:      body.APIBase,
		WebBase:      body.WebBase,
		Capabilities: body.Capabilities,
		Description:  body.Description,
		Tags:         body.Tags,
	})
	if err != nil {
		writeServiceError(w, err)
		return
	}

	if strings.HasSuffix(body.Domain, ".forumline.net") {
		slug := strings.TrimSuffix(body.Domain, ".forumline.net")
		desc := ""
		if body.Description != nil {
			desc = *body.Description
		}
		if err := provisionHostedForum(r.Context(), r.Header.Get("Authorization"), userID, slug, body.Name, desc); err != nil {
			log.Printf("[Forums] hosted provisioning failed for %s: %v", body.Domain, err)
		}
	}

	httpkit.WriteJSON(w, http.StatusOK, map[string]interface{}{
		"forum_id": result.ForumID.String(), "approved": result.Approved, "message": result.Message,
	})
}

func (h *ForumHandler) HandleDelete(w http.ResponseWriter, r *http.Request) {
	userID := auth.UserIDFromContext(r.Context())
	ctx := r.Context()

	var body struct {
		ForumDomain string `json:"forum_domain"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.ForumDomain == "" {
		httpkit.WriteError(w, http.StatusBadRequest, "Missing forum_domain")
		return
	}

	forumID := h.store.GetForumIDByDomain(ctx, body.ForumDomain)
	if forumID == uuid.Nil {
		httpkit.WriteError(w, http.StatusNotFound, "Forum not found")
		return
	}
	ownerID, _ := h.store.GetForumOwner(ctx, forumID)
	if ownerID == nil || *ownerID != userID {
		httpkit.WriteError(w, http.StatusForbidden, "You are not the owner of this forum")
		return
	}

	memberCount := h.store.CountForumMembers(ctx, forumID)
	rows, err := h.store.DeleteForum(ctx, forumID, userID)
	if err != nil || rows == 0 {
		httpkit.WriteError(w, http.StatusInternalServerError, "Forum not found or not owned by you")
		return
	}
	log.Printf("[Forums] deleted domain=%s id=%s owner=%s members_removed=%d", body.ForumDomain, forumID, userID, memberCount)
	httpkit.WriteJSON(w, http.StatusOK, map[string]interface{}{"ok": true, "members_removed": memberCount})
}

// --- Admin endpoints (service key auth) ---

func (h *ForumHandler) HandleUpdateScreenshot(w http.ResponseWriter, r *http.Request) {
	if !authenticateServiceKey(w, r) {
		return
	}
	var body struct {
		Domain        string `json:"domain"`
		ScreenshotURL string `json:"screenshot_url"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Domain == "" || body.ScreenshotURL == "" {
		httpkit.WriteError(w, http.StatusBadRequest, "domain and screenshot_url are required")
		return
	}
	rows, err := h.store.UpdateForumScreenshot(r.Context(), body.Domain, body.ScreenshotURL)
	if err != nil {
		httpkit.WriteError(w, http.StatusInternalServerError, "failed to update screenshot")
		return
	}
	if rows == 0 {
		httpkit.WriteError(w, http.StatusNotFound, "forum not found")
		return
	}
	httpkit.WriteJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *ForumHandler) HandleUpdateIcon(w http.ResponseWriter, r *http.Request) {
	if !authenticateServiceKey(w, r) {
		return
	}
	var body struct {
		Domain  string `json:"domain"`
		IconURL string `json:"icon_url"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Domain == "" {
		httpkit.WriteError(w, http.StatusBadRequest, "domain is required")
		return
	}
	rows, err := h.store.UpdateForumIcon(r.Context(), body.Domain, body.IconURL)
	if err != nil {
		httpkit.WriteError(w, http.StatusInternalServerError, "failed to update icon")
		return
	}
	if rows == 0 {
		httpkit.WriteError(w, http.StatusNotFound, "forum not found")
		return
	}
	httpkit.WriteJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *ForumHandler) HandleUpdateHealth(w http.ResponseWriter, r *http.Request) {
	if !authenticateServiceKey(w, r) {
		return
	}
	var body struct {
		Domain  string `json:"domain"`
		Healthy bool   `json:"healthy"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Domain == "" {
		httpkit.WriteError(w, http.StatusBadRequest, "domain is required")
		return
	}
	ctx := r.Context()
	if body.Healthy {
		rows, err := h.store.MarkForumHealthy(ctx, body.Domain)
		if err != nil || rows == 0 {
			httpkit.WriteError(w, http.StatusNotFound, "forum not found")
			return
		}
		httpkit.WriteJSON(w, http.StatusOK, map[string]interface{}{"ok": true, "action": "healthy"})
		return
	}

	failures, ownerID, err := h.store.IncrementForumFailures(ctx, body.Domain)
	if err != nil {
		httpkit.WriteError(w, http.StatusNotFound, "forum not found")
		return
	}
	action := "failure_recorded"
	if failures >= 3 {
		if h.store.DelistForum(ctx, body.Domain) > 0 {
			log.Printf("[Health] Forum delisted: domain=%s failures=%d", body.Domain, failures)
			action = "delisted"
		}
	}
	if failures >= 7 && ownerID == nil {
		if h.store.AutoDeleteUnownedForum(ctx, body.Domain) > 0 {
			log.Printf("[Health] Unowned forum auto-deleted: domain=%s failures=%d", body.Domain, failures)
			action = "auto_deleted"
		}
	}
	httpkit.WriteJSON(w, http.StatusOK, map[string]interface{}{"ok": true, "action": action, "consecutive_failures": failures})
}

func (h *ForumHandler) HandleListAll(w http.ResponseWriter, r *http.Request) {
	if !authenticateServiceKey(w, r) {
		return
	}
	forums, err := h.store.ListAllForums(r.Context())
	if err != nil {
		httpkit.WriteError(w, http.StatusInternalServerError, "Failed to fetch forums")
		return
	}
	httpkit.WriteJSON(w, http.StatusOK, forums)
}

func authenticateServiceKey(w http.ResponseWriter, r *http.Request) bool {
	authHeader := r.Header.Get("Authorization")
	if !strings.HasPrefix(authHeader, "Bearer ") {
		httpkit.WriteError(w, http.StatusUnauthorized, "missing authorization")
		return false
	}
	token := strings.TrimPrefix(authHeader, "Bearer ")
	serviceKey := os.Getenv("ZITADEL_SERVICE_USER_PAT")
	if serviceKey != "" && token == serviceKey {
		return true
	}
	httpkit.WriteError(w, http.StatusUnauthorized, "invalid authorization")
	return false
}
