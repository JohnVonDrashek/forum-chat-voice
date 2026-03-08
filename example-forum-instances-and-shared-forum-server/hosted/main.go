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
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/johnvondrashek/forumline/example-forum-instances-and-shared-forum-server/forum"
	plat "github.com/johnvondrashek/forumline/example-forum-instances-and-shared-forum-server/platform"
	"github.com/johnvondrashek/forumline/example-forum-instances-and-shared-forum-server/shared"
)

func main() {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// In hosted mode, the auth middleware validates JWTs signed with FORUMLINE_JWT_SECRET.
	// Set JWT_SECRET to match so shared.ValidateJWT works transparently.
	if jwtSecret := os.Getenv("FORUMLINE_JWT_SECRET"); jwtSecret != "" {
		if os.Getenv("JWT_SECRET") == "" {
			os.Setenv("JWT_SECRET", jwtSecret)
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
	sseHub.StartListening(ctx)

	// Platform API (provisioning, forum listing) — no tenant context
	platformHandlers := &plat.PlatformHandlers{
		Pool:  pool,
		Store: store,
	}

	// Build the main router.
	// Platform API routes are served on all domains (filtered by path prefix).
	// Forum routes are served with tenant middleware (Host-based routing).
	r := chi.NewRouter()

	// Platform API endpoints (no tenant context needed)
	r.Post("/api/platform/forums", platformHandlers.HandleProvision)
	r.Get("/api/platform/forums", platformHandlers.HandleListForums)
	r.Get("/api/platform/forums/{slug}/export", platformHandlers.HandleExport)

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
	handler = spaHandler(handler)

	port := os.Getenv("PORT")
	if port == "" {
		port = "3000"
	}

	srv := &http.Server{
		Addr:    ":" + port,
		Handler: handler,
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
		srv.Shutdown(shutdownCtx)
	}()

	log.Printf("hosted forum server listening on http://localhost:%s", port)
	log.Printf("tenants loaded: %d", len(store.All()))
	if err := srv.ListenAndServe(); err != http.ErrServerClosed {
		log.Fatalf("server error: %v", err)
	}
}

// spaHandler serves static files from ./dist and falls back to index.html
// for navigation routes (paths without file extensions).
func spaHandler(apiHandler http.Handler) http.Handler {
	distDir := "./dist"
	fileServer := http.FileServer(http.Dir(distDir))

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") || strings.HasPrefix(r.URL.Path, "/auth/") || strings.HasPrefix(r.URL.Path, "/.well-known/") {
			apiHandler.ServeHTTP(w, r)
			return
		}

		path := filepath.Join(distDir, r.URL.Path)
		if info, err := os.Stat(path); err == nil && !info.IsDir() {
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
