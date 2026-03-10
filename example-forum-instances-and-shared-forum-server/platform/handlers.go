package platform

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
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

	// Register with Forumline identity API to get OAuth credentials.
	// Use the caller's Forumline access token (from Authorization header).
	authHeader := r.Header.Get("Authorization")
	oauthCreds, err := registerForumWithForumline(r.Context(), result.Domain, body.Name, authHeader)
	if err != nil {
		log.Printf("warning: forum provisioned but OAuth registration failed: %v", err)
		// Still return success — the forum exists, just without OAuth yet
	} else {
		// Store the OAuth credentials in platform_tenants
		_, err = ph.Pool.Exec(r.Context(),
			`UPDATE platform_tenants SET forumline_client_id = $1, forumline_client_secret = $2 WHERE slug = $3`,
			oauthCreds.ClientID, oauthCreds.ClientSecret, body.Slug)
		if err != nil {
			log.Printf("warning: failed to store OAuth credentials for %s: %v", body.Slug, err)
		} else {
			// Refresh tenant store so the credentials are available immediately
			if err := ph.Store.Refresh(r.Context()); err != nil {
				log.Printf("tenant store refresh failed: %v", err)
			}
		}
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
	if err := json.NewEncoder(w).Encode(data); err != nil {
		log.Printf("json encode error: %v", err)
	}
}

type oauthCredentials struct {
	ClientID     string
	ClientSecret string
}

// registerForumWithForumline calls POST /api/forums on the Forumline identity API
// to register the new forum and obtain OAuth client credentials.
func registerForumWithForumline(ctx context.Context, domain, name, authHeader string) (*oauthCredentials, error) {
	forumlineURL := os.Getenv("FORUMLINE_APP_URL")
	if forumlineURL == "" {
		return nil, fmt.Errorf("FORUMLINE_APP_URL not set")
	}

	siteURL := "https://" + domain
	body := map[string]interface{}{
		"domain":       domain,
		"name":         name,
		"api_base":     siteURL + "/api/forumline",
		"web_base":     siteURL,
		"capabilities": []string{"threads", "chat", "voice", "notifications"},
		"redirect_uris": []string{siteURL + "/api/forumline/auth/callback"},
	}
	bodyJSON, _ := json.Marshal(body)

	// #nosec G704 -- URL from trusted FORUMLINE_URL config
	req, err := http.NewRequestWithContext(ctx, "POST", forumlineURL+"/api/forums", bytes.NewReader(bodyJSON))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	if authHeader != "" {
		req.Header.Set("Authorization", authHeader)
	}

	resp, err := http.DefaultClient.Do(req) // #nosec G704 -- URL from trusted FORUMLINE_URL config
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		return nil, fmt.Errorf("identity API returned %d: %s", resp.StatusCode, string(respBody))
	}

	var result struct {
		ClientID     string `json:"client_id"`
		ClientSecret string `json:"client_secret"`
	}
	if err := json.Unmarshal(respBody, &result); err != nil {
		return nil, fmt.Errorf("parse response: %w", err)
	}

	if result.ClientID == "" || result.ClientSecret == "" {
		return nil, fmt.Errorf("identity API did not return credentials")
	}

	log.Printf("registered forum %s with Forumline: client_id=%s", domain, result.ClientID)
	return &oauthCredentials{ClientID: result.ClientID, ClientSecret: result.ClientSecret}, nil
}

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		log.Printf("json encode error: %v", err)
	}
}
