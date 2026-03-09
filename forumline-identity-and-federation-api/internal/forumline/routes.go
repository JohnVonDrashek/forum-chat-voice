package forumline

import (
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/johnvondrashek/forumline/forumline-identity-and-federation-api/internal/shared"
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
		r.Post("/api/memberships/join", h.HandleJoinForum)
		r.Delete("/api/memberships", h.HandleLeaveForum)
	})

	// Conversations / DMs
	// NOTE: stream is NOT behind AuthMiddleware (EventSource can't set headers;
	// auth is handled via query param inside the handler). All other routes use
	// AuthMiddleware. They must be registered in the same r.Route block so that
	// chi's trie correctly handles both the literal "stream" and the wildcard
	// "{conversationId}" under the same /api/conversations prefix.
	r.Route("/api/conversations", func(r chi.Router) {
		r.Get("/stream", h.HandleDMStream)
		r.Group(func(r chi.Router) {
			r.Use(shared.AuthMiddleware)
			r.Get("/", h.HandleListConversations)
			r.Post("/", h.HandleCreateConversation)
			r.Post("/dm", h.HandleGetOrCreateDM)
			r.Get("/{conversationId}", h.HandleGetConversation)
			r.Patch("/{conversationId}", h.HandleUpdateConversation)
			r.Get("/{conversationId}/messages", h.HandleGetMessages)
			r.With(dmRL).Post("/{conversationId}/messages", h.HandleSendMessage)
			r.Post("/{conversationId}/read", h.HandleMarkRead)
			r.Delete("/{conversationId}/members/me", h.HandleLeaveConversation)
		})
	})

	// Legacy /api/dms/* routes — backwards compat for cached frontends / Tauri app.
	// These resolve a userId to a conversation ID and forward to the new handlers.
	r.Group(func(r chi.Router) {
		r.Use(shared.AuthMiddleware)
		r.Get("/api/dms", h.HandleListConversations)
		r.Get("/api/dms/{userId}", h.HandleLegacyGetMessages)
		r.With(dmRL).Post("/api/dms/{userId}", h.HandleLegacySendMessage)
		r.Post("/api/dms/{userId}/read", h.HandleLegacyMarkRead)
	})
	r.Get("/api/dms/{userId}/stream", h.HandleDMStream)

	// Forums (public GET, authenticated POST)
	r.Get("/api/forums", h.HandleListForums)
	r.With(shared.AuthMiddleware).Post("/api/forums", h.HandleRegisterForum)

	// Screenshot update (service key auth)
	r.Put("/api/forums/screenshot", h.HandleUpdateScreenshot)

	// Identity (authenticated)
	r.With(shared.AuthMiddleware).Get("/api/identity", h.HandleGetIdentity)

	// Profile search (authenticated)
	r.With(shared.AuthMiddleware).Get("/api/profiles/search", h.HandleSearchProfiles)

	// Calls (1:1 voice)
	r.Route("/api/calls", func(r chi.Router) {
		r.Get("/stream", h.HandleCallSignalStream)
		r.Group(func(r chi.Router) {
			r.Use(shared.AuthMiddleware)
			r.Post("/", h.HandleInitiateCall)
			r.Post("/{callId}/respond", h.HandleRespondToCall)
			r.Post("/{callId}/end", h.HandleEndCall)
			r.Post("/signal", h.HandleCallSignal)
		})
	})

	// Push notifications
	r.Post("/api/push", h.HandlePush)

	// GoTrue reverse proxy — allows frontend to call /auth/v1/* same-origin
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
