package forumline

import (
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/johnvondrashek/forumline/go-services/internal/shared"
)

func NewRouter(pool *pgxpool.Pool, sseHub *shared.SSEHub) *chi.Mux {
	r := chi.NewRouter()

	h := &Handlers{
		Pool:   pool,
		SSEHub: sseHub,
	}

	// Rate limiters
	authRL := shared.RateLimitMiddleware(shared.NewRateLimiter(10, time.Minute))
	signupRL := shared.RateLimitMiddleware(shared.NewRateLimiter(5, time.Minute))
	tokenRL := shared.RateLimitMiddleware(shared.NewRateLimiter(10, time.Minute))
	dmRL := shared.RateLimitMiddleware(shared.NewRateLimiter(30, time.Minute))

	// Auth routes (delegate to GoTrue + custom logic)
	r.With(authRL).Post("/api/auth/login", h.HandleLogin)
	r.With(signupRL).Post("/api/auth/signup", h.HandleSignup)
	r.Post("/api/auth/logout", h.HandleLogout)
	r.Get("/api/auth/session", h.HandleSession)

	// OAuth routes (Forumline federation)
	r.Get("/api/oauth/authorize", h.HandleOAuthAuthorize)
	r.Post("/api/oauth/authorize", h.HandleOAuthAuthorize)
	r.With(tokenRL).Post("/api/oauth/token", h.HandleOAuthToken)

	// Memberships (authenticated)
	r.Group(func(r chi.Router) {
		r.Use(shared.AuthMiddleware)
		r.Get("/api/memberships", h.HandleGetMemberships)
		r.Post("/api/memberships", h.HandleUpdateMembershipAuth)
		r.Put("/api/memberships", h.HandleToggleMembershipMute)
	})

	// DMs (authenticated)
	r.Group(func(r chi.Router) {
		r.Use(shared.AuthMiddleware)
		r.Get("/api/dms", h.HandleListConversations)
		r.Get("/api/dms/{userId}", h.HandleGetMessages)
		r.With(dmRL).Post("/api/dms/{userId}", h.HandleSendMessage)
		r.Post("/api/dms/{userId}/read", h.HandleMarkRead)
	})

	// DM stream (authenticated via query param for EventSource)
	r.Get("/api/dms/{userId}/stream", h.HandleDMStream)

	// Forums (public GET, authenticated POST)
	r.Get("/api/forums", h.HandleListForums)
	r.With(shared.AuthMiddleware).Post("/api/forums", h.HandleRegisterForum)

	// Identity (authenticated)
	r.With(shared.AuthMiddleware).Get("/api/identity", h.HandleGetIdentity)

	// Profile search (authenticated)
	r.With(shared.AuthMiddleware).Get("/api/profiles/search", h.HandleSearchProfiles)

	// Push notifications
	r.Post("/api/push", h.HandlePush)

	// GoTrue reverse proxy — allows supabase-js to call /auth/v1/* same-origin
	gotrueURL := os.Getenv("GOTRUE_URL")
	if gotrueURL != "" {
		target, _ := url.Parse(gotrueURL)
		proxy := httputil.NewSingleHostReverseProxy(target)
		r.HandleFunc("/auth/v1/*", func(w http.ResponseWriter, r *http.Request) {
			// Strip /auth/v1 prefix — GoTrue expects /signup, /token, etc. at root
			r.URL.Path = r.URL.Path[len("/auth/v1"):]
			r.Host = target.Host
			proxy.ServeHTTP(w, r)
		})
	}

	return r
}
