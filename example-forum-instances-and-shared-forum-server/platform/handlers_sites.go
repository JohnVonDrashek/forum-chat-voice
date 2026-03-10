package platform

import (
	"bytes"
	"context"
	"crypto/md5" // #nosec G501 -- md5 used for content hash (ETags), not security
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"path"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

// SiteHandlers handles the file management API for custom forum frontends.
type SiteHandlers struct {
	Pool       *pgxpool.Pool
	Store      *TenantStore
	R2Account  string
	R2KeyID    string
	R2Secret   string
	R2Bucket   string
	SiteCache  *SiteCache
}

type siteManifest struct {
	Files   map[string]siteFileEntry `json:"files"`
	Updated time.Time                `json:"updated"`
}

type siteFileEntry struct {
	Size        int64  `json:"size"`
	ContentType string `json:"content_type"`
	ETag        string `json:"etag"`
	Updated     string `json:"updated"`
}

var allowedExtensions = map[string]bool{
	".html": true, ".css": true, ".js": true, ".json": true,
	".png": true, ".jpg": true, ".jpeg": true, ".gif": true,
	".svg": true, ".webp": true, ".ico": true,
	".woff": true, ".woff2": true, ".ttf": true,
	".txt": true, ".xml": true,
}

var extToContentType = map[string]string{
	".html":  "text/html; charset=utf-8",
	".css":   "text/css; charset=utf-8",
	".js":    "application/javascript; charset=utf-8",
	".json":  "application/json; charset=utf-8",
	".png":   "image/png",
	".jpg":   "image/jpeg",
	".jpeg":  "image/jpeg",
	".gif":   "image/gif",
	".svg":   "image/svg+xml",
	".webp":  "image/webp",
	".ico":   "image/x-icon",
	".woff":  "font/woff",
	".woff2": "font/woff2",
	".ttf":   "font/ttf",
	".txt":   "text/plain; charset=utf-8",
	".xml":   "application/xml; charset=utf-8",
}

const (
	maxFileSize    = 5 << 20  // 5MB per file
	metaObjectName = "_meta.json"
)

func (sh *SiteHandlers) r2Client() (*minio.Client, error) {
	endpoint := fmt.Sprintf("%s.r2.cloudflarestorage.com", sh.R2Account)
	return minio.New(endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(sh.R2KeyID, sh.R2Secret, ""),
		Secure: true,
	})
}

func (sh *SiteHandlers) authenticateOwner(r *http.Request, slug string) (*Tenant, error) {
	forumlineID := r.Header.Get("X-Forumline-ID")
	if forumlineID == "" {
		return nil, fmt.Errorf("authentication required")
	}
	tenant := sh.Store.BySlug(slug)
	if tenant == nil {
		return nil, fmt.Errorf("forum not found")
	}
	if tenant.OwnerForumlineID != forumlineID {
		return nil, fmt.Errorf("not authorized")
	}
	return tenant, nil
}

// HandleOwnedSites returns the domains and slugs of forums owned by the caller.
func (sh *SiteHandlers) HandleOwnedSites(w http.ResponseWriter, r *http.Request) {
	forumlineID := r.Header.Get("X-Forumline-ID")
	if forumlineID == "" {
		http.Error(w, "authentication required", http.StatusUnauthorized)
		return
	}
	type ownedSite struct {
		Domain string `json:"domain"`
		Slug   string `json:"slug"`
	}
	var sites []ownedSite
	for _, t := range sh.Store.All() {
		if t.OwnerForumlineID == forumlineID {
			sites = append(sites, ownedSite{Domain: t.Domain, Slug: t.Slug})
		}
	}
	if sites == nil {
		sites = []ownedSite{}
	}
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(sites); err != nil {
		log.Printf("json encode error: %v", err)
	}
}

// extractSlugAndPath parses /api/platform/sites/{slug}/files/{path...} or similar.
func extractSlugAndPath(urlPath, prefix string) (slug, filePath string, ok bool) {
	trimmed := strings.TrimPrefix(urlPath, prefix)
	trimmed = strings.TrimPrefix(trimmed, "/")
	parts := strings.SplitN(trimmed, "/", 2)
	if len(parts) == 0 || parts[0] == "" {
		return "", "", false
	}
	slug = parts[0]
	if len(parts) > 1 {
		// Remove "files/" prefix if present
		rest := parts[1]
		rest = strings.TrimPrefix(rest, "files/")
		rest = strings.TrimPrefix(rest, "files")
		filePath = strings.TrimPrefix(rest, "/")
	}
	return slug, filePath, true
}

func sanitizePath(p string) (string, error) {
	p = strings.ToLower(strings.TrimSpace(p))
	if p == "" {
		return "", fmt.Errorf("empty path")
	}
	if strings.Contains(p, "..") {
		return "", fmt.Errorf("path traversal not allowed")
	}
	if strings.HasPrefix(p, "/") {
		return "", fmt.Errorf("absolute paths not allowed")
	}
	// No hidden files
	for _, segment := range strings.Split(p, "/") {
		if strings.HasPrefix(segment, ".") {
			return "", fmt.Errorf("hidden files not allowed")
		}
	}
	// Check extension
	ext := path.Ext(p)
	if ext == "" || !allowedExtensions[ext] {
		return "", fmt.Errorf("file type %q not allowed", ext)
	}
	return path.Clean(p), nil
}

func r2Key(slug, filePath string) string {
	return fmt.Sprintf("sites/%s/files/%s", slug, filePath)
}

func r2MetaKey(slug string) string {
	return fmt.Sprintf("sites/%s/%s", slug, metaObjectName)
}

// loadManifest fetches the manifest from R2.
func (sh *SiteHandlers) loadManifest(ctx context.Context, client *minio.Client, slug string) (*siteManifest, error) {
	obj, err := client.GetObject(ctx, sh.R2Bucket, r2MetaKey(slug), minio.GetObjectOptions{})
	if err != nil {
		return nil, fmt.Errorf("get manifest object: %w", err)
	}
	defer func() { _ = obj.Close() }()
	data, err := io.ReadAll(obj)
	if err != nil {
		// Object doesn't exist yet — return empty manifest (not an error)
		return &siteManifest{Files: make(map[string]siteFileEntry)}, nil
	}
	var m siteManifest
	if err := json.Unmarshal(data, &m); err != nil {
		return nil, fmt.Errorf("unmarshal manifest: %w", err)
	}
	if m.Files == nil {
		m.Files = make(map[string]siteFileEntry)
	}
	return &m, nil
}

// saveManifest writes the manifest to R2.
func (sh *SiteHandlers) saveManifest(ctx context.Context, client *minio.Client, slug string, m *siteManifest) error {
	m.Updated = time.Now().UTC()
	data, err := json.Marshal(m)
	if err != nil {
		return err
	}
	_, err = client.PutObject(ctx, sh.R2Bucket, r2MetaKey(slug), bytes.NewReader(data), int64(len(data)), minio.PutObjectOptions{
		ContentType: "application/json",
	})
	return err
}

// updateSiteState updates has_custom_site and site_storage_bytes in the DB.
func (sh *SiteHandlers) updateSiteState(ctx context.Context, slug string, manifest *siteManifest) error {
	_, hasIndex := manifest.Files["index.html"]
	var totalBytes int64
	for _, f := range manifest.Files {
		totalBytes += f.Size
	}
	_, err := sh.Pool.Exec(ctx,
		`UPDATE platform_tenants SET has_custom_site = $1, site_storage_bytes = $2 WHERE slug = $3`,
		hasIndex, totalBytes, slug)
	if err != nil {
		return err
	}
	return sh.Store.Refresh(ctx)
}

// HandleListFiles returns the manifest for a forum's custom site.
// GET /api/platform/sites/{slug}/files
func (sh *SiteHandlers) HandleListFiles(w http.ResponseWriter, r *http.Request) {
	slug, _, ok := extractSlugAndPath(r.URL.Path, "/api/platform/sites")
	if !ok {
		http.Error(w, `{"error":"invalid path"}`, http.StatusBadRequest)
		return
	}
	if _, err := sh.authenticateOwner(r, slug); err != nil {
		status := http.StatusForbidden
		if err.Error() == "authentication required" {
			status = http.StatusUnauthorized
		} else if err.Error() == "forum not found" {
			status = http.StatusNotFound
		}
		writeJSON(w, status, map[string]string{"error": err.Error()})
		return
	}

	client, err := sh.r2Client()
	if err != nil {
		http.Error(w, `{"error":"storage unavailable"}`, http.StatusInternalServerError)
		return
	}
	manifest, err := sh.loadManifest(r.Context(), client, slug)
	if err != nil {
		http.Error(w, `{"error":"failed to load manifest"}`, http.StatusInternalServerError)
		return
	}

	tenant := sh.Store.BySlug(slug)
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"files":         manifest.Files,
		"updated":       manifest.Updated,
		"storage_bytes": tenant.SiteStorageBytes,
		"storage_limit": tenant.SiteStorageLimit,
	})
}

// HandleGetFile downloads a specific file.
// GET /api/platform/sites/{slug}/files/{path...}
func (sh *SiteHandlers) HandleGetFile(w http.ResponseWriter, r *http.Request) {
	slug, filePath, ok := extractSlugAndPath(r.URL.Path, "/api/platform/sites")
	if !ok || filePath == "" {
		http.Error(w, `{"error":"invalid path"}`, http.StatusBadRequest)
		return
	}
	if _, err := sh.authenticateOwner(r, slug); err != nil {
		status := http.StatusForbidden
		if err.Error() == "authentication required" {
			status = http.StatusUnauthorized
		} else if err.Error() == "forum not found" {
			status = http.StatusNotFound
		}
		writeJSON(w, status, map[string]string{"error": err.Error()})
		return
	}

	filePath, err := sanitizePath(filePath)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}

	client, err := sh.r2Client()
	if err != nil {
		http.Error(w, `{"error":"storage unavailable"}`, http.StatusInternalServerError)
		return
	}
	obj, err := client.GetObject(r.Context(), sh.R2Bucket, r2Key(slug, filePath), minio.GetObjectOptions{})
	if err != nil {
		http.Error(w, `{"error":"file not found"}`, http.StatusNotFound)
		return
	}
	defer func() { _ = obj.Close() }()

	info, err := obj.Stat()
	if err != nil {
		http.Error(w, `{"error":"file not found"}`, http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", info.ContentType)
	w.Header().Set("Content-Length", fmt.Sprintf("%d", info.Size))
	if _, err := io.Copy(w, obj); err != nil {
		log.Printf("error streaming file %s/%s: %v", slug, filePath, err) // #nosec G706 -- slug is validated before use
	}
}

// HandlePutFile creates or updates a file.
// PUT /api/platform/sites/{slug}/files/{path...}
func (sh *SiteHandlers) HandlePutFile(w http.ResponseWriter, r *http.Request) {
	slug, filePath, ok := extractSlugAndPath(r.URL.Path, "/api/platform/sites")
	if !ok || filePath == "" {
		http.Error(w, `{"error":"invalid path"}`, http.StatusBadRequest)
		return
	}
	tenant, err := sh.authenticateOwner(r, slug)
	if err != nil {
		status := http.StatusForbidden
		if err.Error() == "authentication required" {
			status = http.StatusUnauthorized
		} else if err.Error() == "forum not found" {
			status = http.StatusNotFound
		}
		writeJSON(w, status, map[string]string{"error": err.Error()})
		return
	}

	filePath, err = sanitizePath(filePath)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}

	// Read body with size limit
	body := http.MaxBytesReader(w, r.Body, maxFileSize)
	data, err := io.ReadAll(body)
	if err != nil {
		writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{"error": "file too large (max 5MB)"})
		return
	}

	client, err := sh.r2Client()
	if err != nil {
		http.Error(w, `{"error":"storage unavailable"}`, http.StatusInternalServerError)
		return
	}

	// Load manifest and check quota
	manifest, err := sh.loadManifest(r.Context(), client, slug)
	if err != nil {
		http.Error(w, `{"error":"failed to load manifest"}`, http.StatusInternalServerError)
		return
	}

	newSize := int64(len(data))
	currentUsage := tenant.SiteStorageBytes
	// Subtract old file size if replacing
	if old, exists := manifest.Files[filePath]; exists {
		currentUsage -= old.Size
	}
	if currentUsage+newSize > tenant.SiteStorageLimit {
		writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{"error": "storage quota exceeded"})
		return
	}

	// Determine content type
	ext := path.Ext(filePath)
	contentType := extToContentType[ext]
	if contentType == "" {
		contentType = "application/octet-stream"
	}

	// Compute ETag
	hash := md5.Sum(data) // #nosec G401 -- md5 used for content hash (ETags), not security
	etag := hex.EncodeToString(hash[:])

	// Upload to R2
	_, err = client.PutObject(r.Context(), sh.R2Bucket, r2Key(slug, filePath), bytes.NewReader(data), newSize, minio.PutObjectOptions{
		ContentType: contentType,
	})
	if err != nil {
		log.Printf("R2 upload error for %s/%s: %v", slug, filePath, err) // #nosec G706 -- slug is validated before use
		http.Error(w, `{"error":"upload failed"}`, http.StatusInternalServerError)
		return
	}

	// Update manifest
	manifest.Files[filePath] = siteFileEntry{
		Size:        newSize,
		ContentType: contentType,
		ETag:        etag,
		Updated:     time.Now().UTC().Format(time.RFC3339),
	}
	// Update DB first (easier to recover if manifest save fails)
	if err := sh.updateSiteState(r.Context(), slug, manifest); err != nil {
		log.Printf("failed to update site state for %s: %v", slug, err) // #nosec G706 -- slug is validated before use
	}

	if err := sh.saveManifest(r.Context(), client, slug, manifest); err != nil {
		log.Printf("failed to save manifest for %s: %v", slug, err) // #nosec G706 -- slug is validated before use
	}

	// Invalidate cache
	if sh.SiteCache != nil {
		sh.SiteCache.Invalidate(slug, filePath)
	}

	writeJSON(w, http.StatusOK, map[string]string{
		"path": filePath,
		"etag": etag,
		"size": fmt.Sprintf("%d", newSize),
	})
}

// HandleDeleteFile deletes a file from the custom site.
// DELETE /api/platform/sites/{slug}/files/{path...}
func (sh *SiteHandlers) HandleDeleteFile(w http.ResponseWriter, r *http.Request) {
	slug, filePath, ok := extractSlugAndPath(r.URL.Path, "/api/platform/sites")
	if !ok || filePath == "" {
		http.Error(w, `{"error":"invalid path"}`, http.StatusBadRequest)
		return
	}
	if _, err := sh.authenticateOwner(r, slug); err != nil {
		status := http.StatusForbidden
		if err.Error() == "authentication required" {
			status = http.StatusUnauthorized
		} else if err.Error() == "forum not found" {
			status = http.StatusNotFound
		}
		writeJSON(w, status, map[string]string{"error": err.Error()})
		return
	}

	filePath, err := sanitizePath(filePath)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}

	client, err := sh.r2Client()
	if err != nil {
		http.Error(w, `{"error":"storage unavailable"}`, http.StatusInternalServerError)
		return
	}

	// Delete from R2
	if err := client.RemoveObject(r.Context(), sh.R2Bucket, r2Key(slug, filePath), minio.RemoveObjectOptions{}); err != nil {
		log.Printf("R2 delete error for %s/%s: %v", slug, filePath, err) // #nosec G706 -- slug is validated before use
	}

	// Update manifest
	manifest, _ := sh.loadManifest(r.Context(), client, slug)
	delete(manifest.Files, filePath)
	if err := sh.saveManifest(r.Context(), client, slug, manifest); err != nil {
		log.Printf("failed to save manifest for %s: %v", slug, err) // #nosec G706 -- slug is validated before use
	}

	// Update DB state
	if err := sh.updateSiteState(r.Context(), slug, manifest); err != nil {
		log.Printf("failed to update site state for %s: %v", slug, err) // #nosec G706 -- slug is validated before use
	}

	// Invalidate cache
	if sh.SiteCache != nil {
		sh.SiteCache.Invalidate(slug, filePath)
	}

	writeJSON(w, http.StatusOK, map[string]string{"deleted": filePath})
}

// HandleMultipartUpload handles drag-and-drop multipart file uploads.
// POST /api/platform/sites/{slug}/upload
func (sh *SiteHandlers) HandleMultipartUpload(w http.ResponseWriter, r *http.Request) {
	slug, _, ok := extractSlugAndPath(r.URL.Path, "/api/platform/sites")
	if !ok {
		http.Error(w, `{"error":"invalid path"}`, http.StatusBadRequest)
		return
	}
	tenant, err := sh.authenticateOwner(r, slug)
	if err != nil {
		status := http.StatusForbidden
		if err.Error() == "authentication required" {
			status = http.StatusUnauthorized
		} else if err.Error() == "forum not found" {
			status = http.StatusNotFound
		}
		writeJSON(w, status, map[string]string{"error": err.Error()})
		return
	}

	// 10MB in-memory buffer for multipart (individual files capped at 5MB)
	r.Body = http.MaxBytesReader(w, r.Body, 10<<20)
	if err := r.ParseMultipartForm(10 << 20); err != nil {
		writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{"error": "request too large"})
		return
	}

	client, err := sh.r2Client()
	if err != nil {
		http.Error(w, `{"error":"storage unavailable"}`, http.StatusInternalServerError)
		return
	}

	manifest, err := sh.loadManifest(r.Context(), client, slug)
	if err != nil {
		http.Error(w, `{"error":"failed to load manifest"}`, http.StatusInternalServerError)
		return
	}

	currentUsage := tenant.SiteStorageBytes
	var uploaded []string
	var errors []string

	for _, headers := range r.MultipartForm.File {
		for _, header := range headers {
			// Use the "path" form field or fall back to filename
			filePath := header.Filename
			filePath, err := sanitizePath(filePath)
			if err != nil {
				errors = append(errors, fmt.Sprintf("%s: %s", header.Filename, err.Error()))
				continue
			}

			if header.Size > maxFileSize {
				errors = append(errors, fmt.Sprintf("%s: file too large (max 5MB)", filePath))
				continue
			}

			// Check quota
			oldSize := int64(0)
			if old, exists := manifest.Files[filePath]; exists {
				oldSize = old.Size
			}
			if currentUsage-oldSize+header.Size > tenant.SiteStorageLimit {
				errors = append(errors, fmt.Sprintf("%s: storage quota exceeded", filePath))
				continue
			}

			file, err := header.Open()
			if err != nil {
				errors = append(errors, fmt.Sprintf("%s: failed to open", filePath))
				continue
			}

			data, err := io.ReadAll(file)
			_ = file.Close()
			if err != nil {
				errors = append(errors, fmt.Sprintf("%s: failed to read", filePath))
				continue
			}

			ext := path.Ext(filePath)
			contentType := extToContentType[ext]
			if contentType == "" {
				contentType = "application/octet-stream"
			}

			_, err = client.PutObject(r.Context(), sh.R2Bucket, r2Key(slug, filePath), bytes.NewReader(data), int64(len(data)), minio.PutObjectOptions{
				ContentType: contentType,
			})
			if err != nil {
				errors = append(errors, fmt.Sprintf("%s: upload failed", filePath))
				continue
			}

			hash := md5.Sum(data) // #nosec G401 -- md5 used for content hash (ETags), not security
			manifest.Files[filePath] = siteFileEntry{
				Size:        int64(len(data)),
				ContentType: contentType,
				ETag:        hex.EncodeToString(hash[:]),
				Updated:     time.Now().UTC().Format(time.RFC3339),
			}
			currentUsage = currentUsage - oldSize + int64(len(data))
			uploaded = append(uploaded, filePath)

			if sh.SiteCache != nil {
				sh.SiteCache.Invalidate(slug, filePath)
			}
		}
	}

	if err := sh.saveManifest(r.Context(), client, slug, manifest); err != nil {
		log.Printf("failed to save manifest for %s: %v", slug, err) // #nosec G706 -- slug is validated before use
	}
	if err := sh.updateSiteState(r.Context(), slug, manifest); err != nil {
		log.Printf("failed to update site state for %s: %v", slug, err) // #nosec G706 -- slug is validated before use
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"uploaded": uploaded,
		"errors":   errors,
	})
}

// HandleReset deletes all custom files and reverts to default SPA.
// POST /api/platform/sites/{slug}/reset
func (sh *SiteHandlers) HandleReset(w http.ResponseWriter, r *http.Request) {
	slug, _, ok := extractSlugAndPath(r.URL.Path, "/api/platform/sites")
	if !ok {
		http.Error(w, `{"error":"invalid path"}`, http.StatusBadRequest)
		return
	}
	if _, err := sh.authenticateOwner(r, slug); err != nil {
		status := http.StatusForbidden
		if err.Error() == "authentication required" {
			status = http.StatusUnauthorized
		} else if err.Error() == "forum not found" {
			status = http.StatusNotFound
		}
		writeJSON(w, status, map[string]string{"error": err.Error()})
		return
	}

	client, err := sh.r2Client()
	if err != nil {
		http.Error(w, `{"error":"storage unavailable"}`, http.StatusInternalServerError)
		return
	}

	manifest, _ := sh.loadManifest(r.Context(), client, slug)

	// Delete all files from R2
	for filePath := range manifest.Files {
		if err := client.RemoveObject(r.Context(), sh.R2Bucket, r2Key(slug, filePath), minio.RemoveObjectOptions{}); err != nil {
			log.Printf("R2 delete error during reset for %s/%s: %v", slug, filePath, err) // #nosec G706 -- slug is validated before use
		}
		if sh.SiteCache != nil {
			sh.SiteCache.Invalidate(slug, filePath)
		}
	}

	// Delete manifest
	if err := client.RemoveObject(r.Context(), sh.R2Bucket, r2MetaKey(slug), minio.RemoveObjectOptions{}); err != nil {
		log.Printf("R2 delete manifest error for %s: %v", slug, err) // #nosec G706 -- slug is validated before use
	}

	// Update DB
	emptyManifest := &siteManifest{Files: make(map[string]siteFileEntry)}
	if err := sh.updateSiteState(r.Context(), slug, emptyManifest); err != nil {
		log.Printf("failed to update site state for %s: %v", slug, err) // #nosec G706 -- slug is validated before use
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "reset complete"})
}
