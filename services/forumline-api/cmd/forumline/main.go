package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/forumline/forumline/services/forumline-api/realtime"
	"github.com/forumline/forumline/services/forumline-api/service"
	"github.com/forumline/forumline/services/forumline-api/store"
	shared "github.com/forumline/forumline/shared-go"
)

func main() {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Database
	rawPool, err := shared.NewDBPool(ctx)
	if err != nil {
		log.Fatalf("failed to connect to database: %v", err)
	}
	defer rawPool.Close()
	pool := shared.NewObservablePool(rawPool)

	// SSE hub for LISTEN/NOTIFY — uses direct connection (bypasses PgBouncer)
	listenDSN := os.Getenv("DATABASE_URL_DIRECT")
	if listenDSN == "" {
		listenDSN = os.Getenv("DATABASE_URL")
	}
	sseHub := shared.NewSSEHub(listenDSN)
	sseHub.Listen(ctx, "dm_changes")
	sseHub.Listen(ctx, "push_dm")
	sseHub.Listen(ctx, "call_signal")
	sseHub.Listen(ctx, "forumline_notification_changes")
	sseHub.StartListening(ctx)

	// Store + services
	s := store.New(pool)

	// Clean up stale calls from previous server run (SSE drops on restart
	// leave calls stuck in ringing/active state, blocking new calls).
	if tag, err := pool.Exec(ctx,
		`UPDATE forumline_calls SET status = CASE WHEN status = 'ringing' THEN 'missed' ELSE 'completed' END, ended_at = now()
		 WHERE status IN ('ringing', 'active')`); err != nil {
		log.Printf("Warning: failed to clean up stale calls: %v", err)
	} else if tag.RowsAffected() > 0 {
		log.Printf("Cleaned up %d stale call(s) from previous run", tag.RowsAffected())
	}

	// Push notification listener
	pushSvc := service.NewPushService(s)
	pushListener := realtime.NewPushListener(rawPool, s, pushSvc)
	go pushListener.Start(ctx)

	// Router
	router := newRouter(s, sseHub)

	// Wrap with global middleware
	var handler http.Handler = router
	handler = shared.CORSMiddleware(handler)
	handler = shared.SecurityHeaders(handler)

	// Static file serving (SPA fallback)
	handler = spaHandler(handler)

	port := os.Getenv("PORT")
	if port == "" {
		port = "3001"
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
		_ = srv.Shutdown(shutdownCtx)
	}()

	// #nosec G706 -- port is from trusted env var
	log.Printf("forumline server listening on http://localhost:%s", port)
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
		// API and auth proxy routes go to the router
		if strings.HasPrefix(r.URL.Path, "/api/") || strings.HasPrefix(r.URL.Path, "/auth/") {
			apiHandler.ServeHTTP(w, r)
			return
		}

		// Try to serve the static file
		path := filepath.Join(distDir, r.URL.Path)
		if info, err := os.Stat(path); err == nil && !info.IsDir() { // #nosec G703 -- path is cleaned by http.Dir
			// Hashed assets (Vite output) are immutable — cache forever
			if strings.HasPrefix(r.URL.Path, "/assets/") {
				w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
			}
			fileServer.ServeHTTP(w, r)
			return
		}

		// If path looks like a missing static asset, return 404.
		// Only check known asset extensions — domain-like paths (e.g.
		// /forum/forumline.net) must fall through to the SPA.
		if ext := filepath.Ext(r.URL.Path); isStaticAssetExt(ext) {
			http.NotFound(w, r)
			return
		}

		// SPA fallback — serve index.html (always revalidate so deploys take effect)
		w.Header().Set("Cache-Control", "no-cache")
		http.ServeFile(w, r, filepath.Join(distDir, "index.html"))
	})
}

// isStaticAssetExt returns true for file extensions that are expected static
// assets (JS, CSS, images, fonts, etc.). This avoids treating domain-like URL
// segments (e.g. "forumline.net") as missing files.
func isStaticAssetExt(ext string) bool {
	switch strings.ToLower(ext) {
	case ".js", ".mjs", ".css", ".html",
		".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico", ".webp", ".avif",
		".woff", ".woff2", ".ttf", ".eot",
		".json", ".map", ".webmanifest",
		".wasm", ".txt", ".xml":
		return true
	}
	return false
}
