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

	"github.com/johnvondrashek/forumline/go-services/internal/forum"
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
	// to support LISTEN/NOTIFY which doesn't work in transaction pooling mode.
	listenDSN := os.Getenv("DATABASE_URL_DIRECT")
	if listenDSN == "" {
		// Fall back to the regular DATABASE_URL (works when not using PgBouncer)
		listenDSN = os.Getenv("DATABASE_URL")
	}
	sseHub := shared.NewSSEHub(listenDSN)
	sseHub.Listen(ctx, "notification_changes")
	sseHub.Listen(ctx, "chat_message_changes")
	sseHub.Listen(ctx, "voice_presence_changes")
	sseHub.Listen(ctx, "post_changes")
	sseHub.StartListening(ctx)

	// Config
	domain := os.Getenv("FORUM_DOMAIN")
	if domain == "" {
		domain = "demo.forumline.net"
	}
	siteURL := os.Getenv("VITE_SITE_URL")
	if siteURL == "" {
		siteURL = "https://" + domain
	}

	cfg := &forum.Config{
		GoTrueURL:         os.Getenv("GOTRUE_URL"),
		ServiceRoleKey:    os.Getenv("SUPABASE_SERVICE_ROLE_KEY"),
		SiteURL:           siteURL,
		Domain:            domain,
		ForumlineURL:            os.Getenv("FORUMLINE_APP_URL"),
		ForumlineClientID:       os.Getenv("FORUMLINE_CLIENT_ID"),
		ForumlineClientSecret:   os.Getenv("FORUMLINE_CLIENT_SECRET"),
		ForumlineJWTSecret:      os.Getenv("FORUMLINE_JWT_SECRET"),
		ForumlineSupabaseURL:    os.Getenv("FORUMLINE_SUPABASE_URL"),
		ForumlineServiceRoleKey: os.Getenv("FORUMLINE_SERVICE_ROLE_KEY"),
		LiveKitURL:        os.Getenv("LIVEKIT_URL"),
		LiveKitAPIKey:     os.Getenv("LIVEKIT_API_KEY"),
		LiveKitAPISecret:  os.Getenv("LIVEKIT_API_SECRET"),
		R2AccountID:       os.Getenv("R2_ACCOUNT_ID"),
		R2AccessKeyID:     os.Getenv("R2_ACCESS_KEY_ID"),
		R2SecretAccessKey: os.Getenv("R2_SECRET_ACCESS_KEY"),
		R2BucketName:      os.Getenv("R2_BUCKET_NAME"),
		R2PublicURL:       os.Getenv("R2_PUBLIC_URL"),
	}

	// Router
	router := forum.NewRouter(pool, sseHub, cfg)

	// Wrap with global middleware
	var handler http.Handler = router
	handler = shared.CORSMiddleware(handler)
	handler = shared.SecurityHeaders(handler)

	// Static file serving (SPA fallback)
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

	log.Printf("forum server listening on http://localhost:%s", port)
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
