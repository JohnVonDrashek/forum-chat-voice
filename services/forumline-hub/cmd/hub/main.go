package main

import (
	"bytes"
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/forumline/forumline/backend/auth"
	"github.com/forumline/forumline/backend/db"
	"github.com/forumline/forumline/backend/httpkit"
	"github.com/forumline/forumline/backend/metrics"
	localdb "github.com/forumline/forumline/services/forumline-hub/db"
	"github.com/forumline/forumline/services/forumline-hub/handler"
	"github.com/forumline/forumline/services/forumline-hub/service"
	"github.com/forumline/forumline/services/forumline-hub/store"
)

func main() {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	auth.MustInitAuth(ctx)

	rawPool, err := db.NewPool(ctx)
	if err != nil {
		log.Fatalf("failed to connect to database: %v", err)
	}
	defer rawPool.Close()
	pool := db.NewObservablePool(rawPool)

	if err := db.RunMigrations(ctx, os.Getenv("DATABASE_URL"), localdb.Migrations); err != nil {
		log.Fatalf("failed to run migrations: %v", err)
	}

	s := store.New(pool)
	forumSvc := service.NewForumService(s)

	forumH := handler.NewForumHandler(s, forumSvc)
	membershipH := handler.NewMembershipHandler(s, forumSvc)
	profileH := handler.NewProfileHandler(s)
	activityH := handler.NewActivityHandler(s)

	r := chi.NewRouter()

	r.Use(httpkit.SecurityHeaders)
	r.Use(httpkit.CORSMiddleware)
	r.Use(metrics.Middleware("forumline_hub"))

	authMW := auth.Middleware

	// Public routes
	r.Get("/api/health", func(w http.ResponseWriter, _ *http.Request) {
		httpkit.WriteJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	r.Get("/metrics", metrics.Handler().ServeHTTP)
	r.Get("/api/forums", forumH.HandleListForums)
	r.Get("/api/forums/tags", forumH.HandleListTags)
	r.Post("/api/auth/logout", profileH.HandleLogout)

	// Authenticated routes
	r.Group(func(r chi.Router) {
		r.Use(authMW)

		r.Get("/api/auth/session", profileH.HandleGetSession)
		r.Get("/api/identity", profileH.HandleGetIdentity)
		r.Put("/api/identity", profileH.HandleUpdateIdentity)
		r.Delete("/api/identity", profileH.HandleDeleteIdentity)
		r.Get("/api/profiles/search", profileH.HandleSearchProfiles)

		r.Get("/api/forums/recommended", forumH.HandleRecommended)
		r.Get("/api/forums/owned", forumH.HandleListOwned)
		r.Post("/api/forums", forumH.HandleRegister)
		r.Delete("/api/forums", forumH.HandleDelete)

		r.Get("/api/memberships", membershipH.HandleList)
		r.Post("/api/memberships", membershipH.HandleUpdateAuth)
		r.Put("/api/memberships", membershipH.HandleToggleMute)
		r.Post("/api/memberships/join", membershipH.HandleJoin)
		r.Delete("/api/memberships", membershipH.HandleLeave)

		r.Get("/api/activity", activityH.HandleGetActivity)
	})

	// Admin endpoints (service key auth inside handler)
	r.Put("/api/forums/screenshot", forumH.HandleUpdateScreenshot)
	r.Put("/api/forums/icon", forumH.HandleUpdateIcon)
	r.Put("/api/forums/health", forumH.HandleUpdateHealth)
	r.Get("/api/forums/all", forumH.HandleListAll)

	// Internal Connect RPC
	handler.MountHubService(r, forumSvc)

	// SPA fallback
	httpHandler := spaHandler(r)

	port := os.Getenv("PORT")
	if port == "" {
		port = "3001"
	}

	srv := &http.Server{
		Addr:              ":" + port,
		Handler:           httpHandler,
		ReadHeaderTimeout: 10 * time.Second,
	}

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
	log.Printf("forumline-hub listening on http://localhost:%s", port)
	if err := srv.ListenAndServe(); err != http.ErrServerClosed {
		log.Fatalf("server error: %v", err)
	}
}

func spaHandler(apiHandler http.Handler) http.Handler {
	distDir := "./dist"
	fileServer := http.FileServer(http.Dir(distDir))
	indexHTML := buildIndexHTML(distDir)

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") || strings.HasPrefix(r.URL.Path, "/forumline.") || r.URL.Path == "/metrics" {
			apiHandler.ServeHTTP(w, r)
			return
		}

		path := filepath.Join(distDir, r.URL.Path)
		if info, err := os.Stat(path); err == nil && !info.IsDir() {
			if strings.HasPrefix(r.URL.Path, "/assets/") {
				w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
			}
			fileServer.ServeHTTP(w, r)
			return
		}

		if ext := filepath.Ext(r.URL.Path); isStaticAssetExt(ext) {
			http.NotFound(w, r)
			return
		}

		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write(indexHTML)
	})
}

func buildIndexHTML(distDir string) []byte {
	raw, err := os.ReadFile(filepath.Join(distDir, "index.html"))
	if err != nil {
		log.Printf("Warning: could not read index.html for config injection: %v", err)
		return raw
	}

	var configs []string
	if v := os.Getenv("ZITADEL_CLIENT_ID"); v != "" {
		configs = append(configs, fmt.Sprintf("window.ZITADEL_CLIENT_ID=%q;", v))
	}
	if v := os.Getenv("GLITCHTIP_DSN"); v != "" {
		configs = append(configs, fmt.Sprintf("window.GLITCHTIP_DSN=%q;", v))
	}
	if len(configs) == 0 {
		return raw
	}

	configScript := "<script>" + strings.Join(configs, "") + "</script>"
	return bytes.Replace(raw, []byte("</head>"), []byte(configScript+"\n</head>"), 1)
}

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
