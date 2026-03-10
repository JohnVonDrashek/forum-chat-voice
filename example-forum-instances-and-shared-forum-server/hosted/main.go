// Hosted multi-tenant forum server.
//
// This serves all hosted forums (*.forumline.net) from a single Go process.
// Each forum has its own PostgreSQL schema; the tenant middleware resolves
// the Host header to the correct schema and sets search_path per-request.
//
// Forum handlers are identical to single-tenant mode — the TenantPool
// transparently routes queries to the right schema.
//
// Platform API endpoints (forum provisioning, listing) are served on the
// platform domain and operate outside tenant context.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/johnvondrashek/forumline/example-forum-instances-and-shared-forum-server/forum"
	plat "github.com/johnvondrashek/forumline/example-forum-instances-and-shared-forum-server/platform"
	"github.com/johnvondrashek/forumline/example-forum-instances-and-shared-forum-server/shared"
	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

func main() {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// In hosted mode, the auth middleware validates JWTs signed with FORUMLINE_JWT_SECRET.
	// Set JWT_SECRET to match so shared.ValidateJWT works transparently.
	if jwtSecret := os.Getenv("FORUMLINE_JWT_SECRET"); jwtSecret != "" {
		if os.Getenv("JWT_SECRET") == "" {
			if err := os.Setenv("JWT_SECRET", jwtSecret); err != nil {
			log.Fatalf("failed to set JWT_SECRET: %v", err)
		}
		}
	}

	// Database pool (shared across all tenants)
	pool, err := shared.NewDBPool(ctx)
	if err != nil {
		log.Fatalf("failed to connect to database: %v", err)
	}
	defer pool.Close()

	// Tenant store — loads and caches tenant configs from platform_tenants table
	store := plat.NewTenantStore(pool)
	if err := store.Start(ctx); err != nil {
		log.Fatalf("failed to start tenant store: %v", err)
	}

	// Tenant-aware pool wrapper
	tp := &plat.TenantPool{Pool: pool}

	// SSE hub — shared across all tenants, schema filtering via payload
	listenDSN := os.Getenv("DATABASE_URL_DIRECT")
	if listenDSN == "" {
		listenDSN = os.Getenv("DATABASE_URL")
	}
	sseHub := shared.NewSSEHub(listenDSN)
	sseHub.Listen(ctx, "notification_changes")
	sseHub.Listen(ctx, "chat_message_changes")
	sseHub.Listen(ctx, "voice_presence_changes")
	sseHub.Listen(ctx, "post_changes")
	sseHub.Listen(ctx, "voice_signal_changes")
	sseHub.StartListening(ctx)

	// Site cache for custom frontends (256MB, 5-minute TTL)
	siteCache := plat.NewSiteCache(256, 5*time.Minute)

	// Platform API (provisioning, forum listing) — no tenant context
	platformHandlers := &plat.PlatformHandlers{
		Pool:  pool,
		Store: store,
	}

	// Site management API (custom frontend file CRUD)
	siteHandlers := &plat.SiteHandlers{
		Pool:      pool,
		Store:     store,
		R2Account: os.Getenv("R2_ACCOUNT_ID"),
		R2KeyID:   os.Getenv("R2_ACCESS_KEY_ID"),
		R2Secret:  os.Getenv("R2_SECRET_ACCESS_KEY"),
		R2Bucket:  os.Getenv("R2_BUCKET_NAME"),
		SiteCache: siteCache,
	}

	// Build the main router.
	// Platform API routes are served on all domains (filtered by path prefix).
	// Forum routes are served with tenant middleware (Host-based routing).
	r := chi.NewRouter()

	// Platform API endpoints (no tenant context needed)
	r.Post("/api/platform/forums", platformHandlers.HandleProvision)
	r.Get("/api/platform/forums", platformHandlers.HandleListForums)
	r.Get("/api/platform/forums/{slug}/export", platformHandlers.HandleExport)

	// Site management API (custom frontend files)
	r.Get("/api/platform/owned-sites", siteHandlers.HandleOwnedSites)
	r.Get("/api/platform/sites/{slug}/files", siteHandlers.HandleListFiles)
	r.Get("/api/platform/sites/{slug}/files/*", siteHandlers.HandleGetFile)
	r.Put("/api/platform/sites/{slug}/files/*", siteHandlers.HandlePutFile)
	r.Delete("/api/platform/sites/{slug}/files/*", siteHandlers.HandleDeleteFile)
	r.Post("/api/platform/sites/{slug}/upload", siteHandlers.HandleMultipartUpload)
	r.Post("/api/platform/sites/{slug}/reset", siteHandlers.HandleReset)

	// Forum routes — wrapped with tenant middleware.
	// The tenant middleware resolves Host -> schema and sets search_path.
	// Forum config and router are built once per tenant and cached.
	tenantMw := plat.TenantMiddleware(store, tp)

	var routerMu sync.RWMutex
	routerCache := make(map[string]http.Handler) // domain -> cached router

	getForumRouter := func(tenant *plat.Tenant) http.Handler {
		routerMu.RLock()
		cached, ok := routerCache[tenant.Domain]
		routerMu.RUnlock()
		if ok {
			return cached
		}

		cfg := &forum.Config{
			// No GoTrue in multi-tenant mode — auth is via Forumline identity
			GoTrueURL:              "",
			GoTrueServiceRoleKey:   "",
			SiteURL:                "https://" + tenant.Domain,
			Domain:                 tenant.Domain,
			ForumName:              tenant.Name,
			ForumlineURL:           os.Getenv("FORUMLINE_APP_URL"),
			ForumlineClientID:      tenant.ForumlineClientID,
			ForumlineClientSecret:  tenant.ForumlineClientSecret,
			ForumlineJWTSecret:     os.Getenv("FORUMLINE_JWT_SECRET"),
			ForumlineGoTrueURL:     os.Getenv("FORUMLINE_GOTRUE_URL"),
			ForumlineServiceRoleKey: os.Getenv("FORUMLINE_SERVICE_ROLE_KEY"),
			LiveKitURL:             os.Getenv("LIVEKIT_URL"),
			LiveKitAPIKey:          os.Getenv("LIVEKIT_API_KEY"),
			LiveKitAPISecret:       os.Getenv("LIVEKIT_API_SECRET"),
			R2AccountID:            os.Getenv("R2_ACCOUNT_ID"),
			R2AccessKeyID:          os.Getenv("R2_ACCESS_KEY_ID"),
			R2SecretAccessKey:      os.Getenv("R2_SECRET_ACCESS_KEY"),
			R2BucketName:           os.Getenv("R2_BUCKET_NAME"),
			R2PublicURL:            os.Getenv("R2_PUBLIC_URL"),
		}

		forumRouter := forum.NewRouter(tp, sseHub, cfg)

		routerMu.Lock()
		routerCache[tenant.Domain] = forumRouter
		routerMu.Unlock()

		return forumRouter
	}

	r.Group(func(r chi.Router) {
		r.Use(tenantMw)
		r.HandleFunc("/*", func(w http.ResponseWriter, r *http.Request) {
			tenant := plat.TenantFromContext(r.Context())
			if tenant == nil {
				http.Error(w, `{"error":"no tenant"}`, http.StatusInternalServerError)
				return
			}
			getForumRouter(tenant).ServeHTTP(w, r)
		})
	})

	// Global middleware
	var handler http.Handler = r
	handler = shared.CORSMiddleware(handler)
	handler = shared.SecurityHeaders(handler)
	handler = spaHandler(handler, store, siteCache)

	port := os.Getenv("PORT")
	if port == "" {
		port = "3000"
	}

	srv := &http.Server{
		Addr:              ":" + port,
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
	}

	// Graceful shutdown
	go func() {
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
		<-sigCh
		log.Println("shutting down...")
		cancel()
		shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer shutdownCancel()
		if err := srv.Shutdown(shutdownCtx); err != nil {
			log.Printf("shutdown error: %v", err)
		}
	}()

	// #nosec G706 -- port is from trusted env var
	log.Printf("hosted forum server listening on http://localhost:%s", port)
	log.Printf("tenants loaded: %d", len(store.All()))
	if err := srv.ListenAndServe(); err != http.ErrServerClosed {
		log.Fatalf("server error: %v", err)
	}
}

// spaHandler serves static files for tenant domains.
// If a tenant has a custom site (HasCustomSite), files are served from R2
// with an in-memory LRU cache. Otherwise, the default SPA from ./dist/ is served.
func spaHandler(apiHandler http.Handler, store *plat.TenantStore, cache *plat.SiteCache) http.Handler {
	distDir := "./dist"
	fileServer := http.FileServer(http.Dir(distDir))

	r2AccountID := os.Getenv("R2_ACCOUNT_ID")
	r2Bucket := os.Getenv("R2_BUCKET_NAME")

	// Create a shared minio client for serving custom sites (reused across requests)
	var r2Client *minio.Client
	if r2AccountID != "" {
		endpoint := fmt.Sprintf("%s.r2.cloudflarestorage.com", r2AccountID)
		c, err := minio.New(endpoint, &minio.Options{
			Creds:  credentials.NewStaticV4(os.Getenv("R2_ACCESS_KEY_ID"), os.Getenv("R2_SECRET_ACCESS_KEY"), ""),
			Secure: true,
		})
		if err != nil {
			log.Printf("warning: failed to create R2 client for custom site serving: %v", err)
		} else {
			r2Client = c
		}
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") || strings.HasPrefix(r.URL.Path, "/auth/") || strings.HasPrefix(r.URL.Path, "/.well-known/") {
			apiHandler.ServeHTTP(w, r)
			return
		}

		// Only serve for known tenant domains, not the platform domain
		host := strings.Split(r.Host, ":")[0]
		tenant := store.ByDomain(host)
		if tenant == nil {
			http.NotFound(w, r)
			return
		}

		// Custom site path: serve from R2 with caching
		if tenant.HasCustomSite {
			if r2Client == nil {
				http.Error(w, "Storage not configured", http.StatusInternalServerError)
				return
			}
			serveCustomSite(w, r, tenant, cache, r2Client, r2Bucket)
			return
		}

		// Default SPA path: serve from ./dist/
		localPath := filepath.Join(distDir, r.URL.Path)
		if info, err := os.Stat(localPath); err == nil && !info.IsDir() { // #nosec G703 -- path is cleaned by http.Dir
			if filepath.Base(r.URL.Path) == "index.html" {
				w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
			}
			fileServer.ServeHTTP(w, r)
			return
		}

		if filepath.Ext(r.URL.Path) != "" {
			http.NotFound(w, r)
			return
		}

		w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
		http.ServeFile(w, r, filepath.Join(distDir, "index.html"))
	})
}

// serveCustomSite serves files from R2 for tenants with custom frontends.
// Uses the manifest to determine which files exist, and falls back to
// serving index.html for SPA-style routing (paths without extensions).
func serveCustomSite(w http.ResponseWriter, r *http.Request, tenant *plat.Tenant, cache *plat.SiteCache, client *minio.Client, r2Bucket string) {
	reqPath := strings.TrimPrefix(r.URL.Path, "/")
	if reqPath == "" {
		reqPath = "index.html"
	}

	// SPA fallback: if path has no extension, serve index.html
	if path.Ext(reqPath) == "" {
		reqPath = "index.html"
	}

	// Try cache first
	if data, contentType, etag, ok := cache.Get(tenant.Slug, reqPath); ok {
		if match := r.Header.Get("If-None-Match"); match == etag {
			w.WriteHeader(http.StatusNotModified)
			return
		}
		setCacheHeaders(w, reqPath, etag)
		w.Header().Set("Content-Type", contentType)
		if _, err := w.Write(data); err != nil { // #nosec G705 -- data is from R2 static file storage
			log.Printf("write cached response error: %v", err)
		}
		return
	}

	// Cache miss: fetch from R2
	key := fmt.Sprintf("sites/%s/files/%s", tenant.Slug, reqPath)
	obj, err := client.GetObject(r.Context(), r2Bucket, key, minio.GetObjectOptions{})
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer func() { _ = obj.Close() }()

	data, err := io.ReadAll(obj)
	if err != nil {
		http.NotFound(w, r)
		return
	}

	// Detect content type from manifest or extension
	info, err := obj.Stat()
	contentType := "application/octet-stream"
	etag := ""
	if err == nil {
		contentType = info.ContentType
		etag = info.ETag
	}
	if contentType == "" || contentType == "application/octet-stream" {
		if ct, ok := extContentType(reqPath); ok {
			contentType = ct
		}
	}

	// Try to get etag from manifest if not from R2 headers
	if etag == "" {
		if manifest := loadManifestCached(r.Context(), client, r2Bucket, tenant.Slug); manifest != nil {
			if entry, ok := manifest.Files[reqPath]; ok {
				etag = entry.ETag
			}
		}
	}

	// Store in cache
	cache.Put(tenant.Slug, reqPath, data, contentType, etag)

	if match := r.Header.Get("If-None-Match"); match != "" && match == etag {
		w.WriteHeader(http.StatusNotModified)
		return
	}

	setCacheHeaders(w, reqPath, etag)
	w.Header().Set("Content-Type", contentType)
	if _, err := w.Write(data); err != nil { // #nosec G705 -- data is from R2 static file storage
		log.Printf("write response error: %v", err)
	}
}

func setCacheHeaders(w http.ResponseWriter, filePath, etag string) {
	if filePath == "index.html" {
		w.Header().Set("Cache-Control", "no-cache")
	} else {
		w.Header().Set("Cache-Control", "public, max-age=3600")
	}
	if etag != "" {
		w.Header().Set("ETag", etag)
	}
}

func extContentType(filePath string) (string, bool) {
	types := map[string]string{
		".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
		".js": "application/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
		".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
		".gif": "image/gif", ".svg": "image/svg+xml", ".webp": "image/webp",
		".ico": "image/x-icon", ".woff": "font/woff", ".woff2": "font/woff2",
		".ttf": "font/ttf", ".txt": "text/plain; charset=utf-8", ".xml": "application/xml; charset=utf-8",
	}
	ct, ok := types[path.Ext(filePath)]
	return ct, ok
}

type manifestCache struct {
	Files map[string]struct {
		ETag string `json:"etag"`
	} `json:"files"`
}

func loadManifestCached(ctx context.Context, client *minio.Client, bucket, slug string) *manifestCache {
	key := fmt.Sprintf("sites/%s/_meta.json", slug)
	obj, err := client.GetObject(ctx, bucket, key, minio.GetObjectOptions{})
	if err != nil {
		return nil
	}
	defer func() { _ = obj.Close() }()
	data, err := io.ReadAll(obj)
	if err != nil {
		return nil
	}
	var m manifestCache
	if json.Unmarshal(data, &m) != nil {
		return nil
	}
	return &m
}
