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

	forumlineapp "github.com/johnvondrashek/forumline/go-services/internal/forumline"
	"github.com/johnvondrashek/forumline/go-services/internal/shared"
)

func main() {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Database
	pool, err := shared.NewDBPool(ctx)
	if err != nil {
		log.Fatalf("failed to connect to database: %v", err)
	}
	defer pool.Close()

	// SSE hub for LISTEN/NOTIFY — uses direct connection (bypasses PgBouncer)
	listenDSN := os.Getenv("DATABASE_URL_DIRECT")
	if listenDSN == "" {
		listenDSN = os.Getenv("DATABASE_URL")
	}
	sseHub := shared.NewSSEHub(listenDSN)
	sseHub.Listen(ctx, "dm_changes")
	sseHub.Listen(ctx, "push_dm")
	sseHub.StartListening(ctx)

	// Push notification listener
	pushListener := forumlineapp.NewPushListener(pool, sseHub)
	go pushListener.Start(ctx)

	// Router
	router := forumlineapp.NewRouter(pool, sseHub)

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

	log.Printf("central-services server listening on http://localhost:%s", port)
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
		if info, err := os.Stat(path); err == nil && !info.IsDir() {
			fileServer.ServeHTTP(w, r)
			return
		}

		// If path has a file extension, it's a missing static file — 404
		if filepath.Ext(r.URL.Path) != "" {
			http.NotFound(w, r)
			return
		}

		// SPA fallback — serve index.html
		http.ServeFile(w, r, filepath.Join(distDir, "index.html"))
	})
}

