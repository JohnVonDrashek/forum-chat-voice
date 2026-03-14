package handler

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"

	"github.com/golang-jwt/jwt/v5"
	"github.com/forumline/forumline/services/forumline-api/service"
	"github.com/forumline/forumline/services/forumline-api/store"
	shared "github.com/forumline/forumline/shared-go"
)

type ForumHandler struct {
	Store        *store.Store
	ForumService *service.ForumService
}

func NewForumHandler(s *store.Store, fs *service.ForumService) *ForumHandler {
	return &ForumHandler{Store: s, ForumService: fs}
}

func (h *ForumHandler) HandleListForums(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	search := strings.TrimSpace(q.Get("q"))
	tag := strings.TrimSpace(q.Get("tag"))
	sort := q.Get("sort")
	if sort == "" {
		sort = "popular"
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

	forums, err := h.Store.ListForums(r.Context(), search, tag, sort, limit, offset)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to fetch forums"})
		return
	}
	writeJSON(w, http.StatusOK, forums)
}

func (h *ForumHandler) HandleListTags(w http.ResponseWriter, r *http.Request) {
	tags, err := h.Store.ListForumTags(r.Context())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to fetch tags"})
		return
	}
	writeJSON(w, http.StatusOK, tags)
}

func (h *ForumHandler) HandleRecommended(w http.ResponseWriter, r *http.Request) {
	userID := shared.UserIDFromContext(r.Context())
	forums, err := h.Store.ListRecommendedForums(r.Context(), userID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to fetch recommendations"})
		return
	}
	writeJSON(w, http.StatusOK, forums)
}

func (h *ForumHandler) HandleRegister(w http.ResponseWriter, r *http.Request) {
	userID := shared.UserIDFromContext(r.Context())

	var body struct {
		Domain       string   `json:"domain"`
		Name         string   `json:"name"`
		APIBase      string   `json:"api_base"`
		WebBase      string   `json:"web_base"`
		Capabilities []string `json:"capabilities"`
		Description  *string  `json:"description"`
		Tags         []string `json:"tags"`
		RedirectURIs []string `json:"redirect_uris"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}

	result, err := h.ForumService.RegisterForum(r.Context(), userID, service.RegisterForumInput{
		Domain:       body.Domain,
		Name:         body.Name,
		APIBase:      body.APIBase,
		WebBase:      body.WebBase,
		Capabilities: body.Capabilities,
		Description:  body.Description,
		Tags:         body.Tags,
		RedirectURIs: body.RedirectURIs,
	})
	if err != nil {
		writeServiceError(w, err)
		return
	}

	status := http.StatusCreated
	if result.Approved {
		status = http.StatusOK
	}
	writeJSON(w, status, map[string]interface{}{
		"forum_id": result.ForumID, "client_id": result.ClientID, "client_secret": result.ClientSecret,
		"approved": result.Approved, "message": result.Message,
	})
}

func (h *ForumHandler) HandleListOwned(w http.ResponseWriter, r *http.Request) {
	userID := shared.UserIDFromContext(r.Context())
	forums, err := h.Store.ListOwnedForums(r.Context(), userID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to fetch owned forums"})
		return
	}
	writeJSON(w, http.StatusOK, forums)
}

func (h *ForumHandler) HandleDelete(w http.ResponseWriter, r *http.Request) {
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
	ownerID, _ := h.Store.GetForumOwner(ctx, forumID)
	if ownerID == nil || *ownerID != userID {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "You are not the owner of this forum"})
		return
	}

	memberCount := h.Store.CountForumMembers(ctx, forumID)
	rows, err := h.Store.DeleteForum(ctx, forumID, userID)
	if err != nil || rows == 0 {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Forum not found or not owned by you"})
		return
	}
	log.Printf("[Forums] Forum deleted: domain=%s id=%s owner=%s members_removed=%d", body.ForumDomain, forumID, userID, memberCount)
	writeJSON(w, http.StatusOK, map[string]interface{}{"ok": true, "members_removed": memberCount})
}

// --- Admin endpoints (service key auth) ---

func (h *ForumHandler) HandleUpdateScreenshot(w http.ResponseWriter, r *http.Request) {
	if !h.authenticateServiceKey(w, r) {
		return
	}
	var body struct {
		Domain        string `json:"domain"`
		ScreenshotURL string `json:"screenshot_url"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Domain == "" || body.ScreenshotURL == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "domain and screenshot_url are required"})
		return
	}
	rows, err := h.Store.UpdateForumScreenshot(r.Context(), body.Domain, body.ScreenshotURL)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to update screenshot"})
		return
	}
	if rows == 0 {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "forum not found"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *ForumHandler) HandleUpdateIcon(w http.ResponseWriter, r *http.Request) {
	if !h.authenticateServiceKey(w, r) {
		return
	}
	var body struct {
		Domain  string `json:"domain"`
		IconURL string `json:"icon_url"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Domain == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "domain is required"})
		return
	}
	rows, err := h.Store.UpdateForumIcon(r.Context(), body.Domain, body.IconURL)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to update icon"})
		return
	}
	if rows == 0 {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "forum not found"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *ForumHandler) HandleUpdateHealth(w http.ResponseWriter, r *http.Request) {
	if !h.authenticateServiceKey(w, r) {
		return
	}
	var body struct {
		Domain  string `json:"domain"`
		Healthy bool   `json:"healthy"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Domain == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "domain is required"})
		return
	}
	ctx := r.Context()
	if body.Healthy {
		rows, err := h.Store.MarkForumHealthy(ctx, body.Domain)
		if err != nil || rows == 0 {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "forum not found"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]interface{}{"ok": true, "action": "healthy"})
		return
	}

	failures, ownerID, err := h.Store.IncrementForumFailures(ctx, body.Domain)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "forum not found"})
		return
	}
	action := "failure_recorded"
	if failures >= 3 {
		if h.Store.DelistForum(ctx, body.Domain) > 0 {
			log.Printf("[Health] Forum delisted: domain=%s failures=%d", body.Domain, failures)
			action = "delisted"
		}
	}
	if failures >= 7 && ownerID == nil {
		if h.Store.AutoDeleteUnownedForum(ctx, body.Domain) > 0 {
			log.Printf("[Health] Unowned forum auto-deleted: domain=%s failures=%d", body.Domain, failures)
			action = "auto_deleted"
		}
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"ok": true, "action": action, "consecutive_failures": failures})
}

func (h *ForumHandler) HandleListAll(w http.ResponseWriter, r *http.Request) {
	if !h.authenticateServiceKey(w, r) {
		return
	}
	forums, err := h.Store.ListAllForums(r.Context())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to fetch forums"})
		return
	}
	writeJSON(w, http.StatusOK, forums)
}

// HandleEnsureOAuth creates OAuth credentials for an existing forum that doesn't have them.
// Requires service role key authentication.
// POST /api/forums/ensure-oauth
// Body: {"domain": "example.forumline.net"}
func (h *ForumHandler) HandleEnsureOAuth(w http.ResponseWriter, r *http.Request) {
	if !h.authenticateServiceKey(w, r) {
		return
	}

	var body struct {
		Domain string `json:"domain"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Domain == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "domain is required"})
		return
	}

	creds, err := h.ForumService.EnsureOAuth(r.Context(), body.Domain)
	if err != nil {
		writeServiceError(w, err)
		return
	}

	log.Printf("ensure-oauth: created OAuth for %s: client_id=%s", body.Domain, creds.ClientID)
	writeJSON(w, http.StatusCreated, map[string]interface{}{
		"client_id": creds.ClientID, "client_secret": creds.ClientSecret,
	})
}

func (h *ForumHandler) authenticateServiceKey(w http.ResponseWriter, r *http.Request) bool {
	auth := r.Header.Get("Authorization")
	if !strings.HasPrefix(auth, "Bearer ") {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "missing authorization"})
		return false
	}
	token := strings.TrimPrefix(auth, "Bearer ")

	// Check explicit service key env var first
	serviceKey := os.Getenv("FORUMLINE_SERVICE_ROLE_KEY")
	if serviceKey != "" && token == serviceKey {
		return true
	}

	// Fall back to validating as a JWT with service_role
	jwtSecret := os.Getenv("JWT_SECRET")
	if jwtSecret != "" {
		mapClaims := jwt.MapClaims{}
		parsed, err := jwt.ParseWithClaims(token, mapClaims, func(t *jwt.Token) (interface{}, error) {
			return []byte(jwtSecret), nil
		})
		if err == nil && parsed.Valid {
			if role, ok := mapClaims["role"].(string); ok && role == "service_role" {
				return true
			}
		}
	}
	writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid authorization"})
	return false
}
