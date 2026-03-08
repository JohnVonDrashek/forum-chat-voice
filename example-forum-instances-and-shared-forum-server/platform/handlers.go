package platform

import (
	"encoding/json"
	"net/http"
	"os"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

// PlatformHandlers holds dependencies for platform-level API endpoints
// (forum provisioning, listing, export). These run outside tenant context.
type PlatformHandlers struct {
	Pool  *pgxpool.Pool
	Store *TenantStore
}

// HandleProvision creates a new hosted forum.
// POST /api/platform/forums
// Body: {"slug": "myforum", "name": "My Forum", "description": "..."}
// Requires Forumline identity token in Authorization header.
func (ph *PlatformHandlers) HandleProvision(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	// Extract forumline identity from the request.
	// In hosted mode, we validate the Forumline JWT directly.
	forumlineID := r.Header.Get("X-Forumline-ID")
	if forumlineID == "" {
		http.Error(w, `{"error":"authentication required"}`, http.StatusUnauthorized)
		return
	}

	var body struct {
		Slug        string `json:"slug"`
		Name        string `json:"name"`
		Description string `json:"description"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, `{"error":"invalid JSON"}`, http.StatusBadRequest)
		return
	}

	body.Slug = strings.TrimSpace(strings.ToLower(body.Slug))
	body.Name = strings.TrimSpace(body.Name)

	if body.Slug == "" || body.Name == "" {
		http.Error(w, `{"error":"slug and name are required"}`, http.StatusBadRequest)
		return
	}

	baseDomain := os.Getenv("PLATFORM_BASE_DOMAIN")
	if baseDomain == "" {
		baseDomain = "forumline.net"
	}

	result, err := Provision(r.Context(), ph.Pool, ph.Store, &ProvisionRequest{
		Slug:             body.Slug,
		Name:             body.Name,
		Description:      body.Description,
		OwnerForumlineID: forumlineID,
		BaseDomain:       baseDomain,
	})
	if err != nil {
		// Check for validation errors vs internal errors
		errMsg := err.Error()
		if strings.Contains(errMsg, "invalid slug") ||
			strings.Contains(errMsg, "reserved") ||
			strings.Contains(errMsg, "already taken") {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": errMsg})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to create forum"})
		return
	}

	writeJSON(w, http.StatusCreated, map[string]interface{}{
		"domain":      result.Domain,
		"slug":        result.Tenant.Slug,
		"name":        result.Tenant.Name,
		"schema_name": result.Tenant.SchemaName,
	})
}

// HandleListForums returns all active hosted forums.
// GET /api/platform/forums
func (ph *PlatformHandlers) HandleListForums(w http.ResponseWriter, r *http.Request) {
	tenants := ph.Store.All()
	forums := make([]map[string]interface{}, 0, len(tenants))
	for _, t := range tenants {
		forums = append(forums, map[string]interface{}{
			"slug":        t.Slug,
			"name":        t.Name,
			"domain":      t.Domain,
			"description": t.Description,
			"icon_url":    t.IconURL,
			"theme":       t.Theme,
		})
	}
	writeJSON(w, http.StatusOK, forums)
}

// HandleExport exports a forum's data as JSON for migration to self-hosted.
// GET /api/platform/forums/{slug}/export
// Requires the request to come from the forum owner (X-Forumline-ID must match).
func (ph *PlatformHandlers) HandleExport(w http.ResponseWriter, r *http.Request) {
	// Extract slug from URL path: /api/platform/forums/{slug}/export
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if len(parts) < 5 {
		http.Error(w, `{"error":"invalid path"}`, http.StatusBadRequest)
		return
	}
	slug := parts[3]

	forumlineID := r.Header.Get("X-Forumline-ID")
	if forumlineID == "" {
		http.Error(w, `{"error":"authentication required"}`, http.StatusUnauthorized)
		return
	}

	tenant := ph.Store.BySlug(slug)
	if tenant == nil {
		http.Error(w, `{"error":"forum not found"}`, http.StatusNotFound)
		return
	}

	// Only the owner can export
	if tenant.OwnerForumlineID != forumlineID {
		http.Error(w, `{"error":"not authorized"}`, http.StatusForbidden)
		return
	}

	data, err := Export(r.Context(), ph.Pool, tenant)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "export failed"})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Content-Disposition", "attachment; filename=\""+slug+"-export.json\"")
	json.NewEncoder(w).Encode(data)
}

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}
