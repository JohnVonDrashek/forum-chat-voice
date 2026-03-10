package forumline

import (
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"time"

	"github.com/johnvondrashek/forumline/forumline-identity-and-federation-api/internal/shared"
)

// use applies middleware to a handler, wrapping in right-to-left order.
func use(h http.HandlerFunc, mws ...func(http.Handler) http.Handler) http.Handler {
	var handler http.Handler = h
	for i := len(mws) - 1; i >= 0; i-- {
		handler = mws[i](handler)
	}
	return handler
}

func NewRouter(pool *shared.ObservablePool, sseHub *shared.SSEHub) *http.ServeMux {
	mux := http.NewServeMux()

	h := &Handlers{
		Pool:   pool,
		SSEHub: sseHub,
	}

	auth := shared.AuthMiddleware

	// Rate limiters
	authRL := shared.RateLimitMiddleware(shared.NewRateLimiter(10, time.Minute))
	signupRL := shared.RateLimitMiddleware(shared.NewRateLimiter(5, time.Minute))
	tokenRL := shared.RateLimitMiddleware(shared.NewRateLimiter(10, time.Minute))
	dmRL := shared.RateLimitMiddleware(shared.NewRateLimiter(30, time.Minute))

	// Auth routes (delegate to GoTrue + custom logic)
	mux.Handle("POST /api/auth/login", use(h.HandleLogin, authRL))
	mux.Handle("POST /api/auth/signup", use(h.HandleSignup, signupRL))
	mux.HandleFunc("POST /api/auth/logout", h.HandleLogout)
	mux.HandleFunc("GET /api/auth/session", h.HandleSession)

	// OAuth routes (Forumline federation)
	mux.HandleFunc("GET /api/oauth/authorize", h.HandleOAuthAuthorize)
	mux.HandleFunc("POST /api/oauth/authorize", h.HandleOAuthAuthorize)
	mux.Handle("POST /api/oauth/token", use(h.HandleOAuthToken, tokenRL))

	// Memberships (authenticated)
	mux.Handle("GET /api/memberships", use(h.HandleGetMemberships, auth))
	mux.Handle("POST /api/memberships", use(h.HandleUpdateMembershipAuth, auth))
	mux.Handle("PUT /api/memberships", use(h.HandleToggleMembershipMute, auth))
	mux.Handle("POST /api/memberships/join", use(h.HandleJoinForum, auth))
	mux.Handle("DELETE /api/memberships", use(h.HandleLeaveForum, auth))

	// Conversations / DMs
	// NOTE: stream is NOT behind AuthMiddleware (EventSource can't set headers;
	// auth is handled via query param inside the handler).
	mux.HandleFunc("GET /api/conversations/stream", h.HandleDMStream)
	mux.Handle("GET /api/conversations", use(h.HandleListConversations, auth))
	mux.Handle("POST /api/conversations", use(h.HandleCreateConversation, auth))
	mux.Handle("POST /api/conversations/dm", use(h.HandleGetOrCreateDM, auth))
	mux.Handle("GET /api/conversations/{conversationId}", use(h.HandleGetConversation, auth))
	mux.Handle("PATCH /api/conversations/{conversationId}", use(h.HandleUpdateConversation, auth))
	mux.Handle("GET /api/conversations/{conversationId}/messages", use(h.HandleGetMessages, auth))
	mux.Handle("POST /api/conversations/{conversationId}/messages", use(h.HandleSendMessage, auth, dmRL))
	mux.Handle("POST /api/conversations/{conversationId}/read", use(h.HandleMarkRead, auth))
	mux.Handle("DELETE /api/conversations/{conversationId}/members/me", use(h.HandleLeaveConversation, auth))

	// Legacy /api/dms/* routes — backwards compat for cached frontends.
	// These resolve a userId to a conversation ID and forward to the new handlers.
	mux.Handle("GET /api/dms", use(h.HandleListConversations, auth))
	mux.Handle("GET /api/dms/{userId}", use(h.HandleLegacyGetMessages, auth))
	mux.Handle("POST /api/dms/{userId}", use(h.HandleLegacySendMessage, auth, dmRL))
	mux.Handle("POST /api/dms/{userId}/read", use(h.HandleLegacyMarkRead, auth))
	mux.HandleFunc("GET /api/dms/{userId}/stream", h.HandleDMStream)

	// Forums (public GET, authenticated POST)
	mux.HandleFunc("GET /api/forums", h.HandleListForums)
	mux.Handle("POST /api/forums", use(h.HandleRegisterForum, auth))

	// Screenshot update (service key auth)
	mux.HandleFunc("PUT /api/forums/screenshot", h.HandleUpdateScreenshot)

	// Identity (authenticated)
	mux.Handle("GET /api/identity", use(h.HandleGetIdentity, auth))

	// Profile search (authenticated)
	mux.Handle("GET /api/profiles/search", use(h.HandleSearchProfiles, auth))

	// Calls (1:1 voice)
	mux.HandleFunc("GET /api/calls/stream", h.HandleCallSignalStream)
	mux.Handle("POST /api/calls", use(h.HandleInitiateCall, auth))
	mux.Handle("POST /api/calls/{callId}/respond", use(h.HandleRespondToCall, auth))
	mux.Handle("POST /api/calls/{callId}/end", use(h.HandleEndCall, auth))
	mux.Handle("POST /api/calls/signal", use(h.HandleCallSignal, auth))

	// Push notifications
	mux.HandleFunc("POST /api/push", h.HandlePush)

	// GoTrue reverse proxy — allows frontend to call /auth/v1/* same-origin
	gotrueURL := os.Getenv("GOTRUE_URL")
	if gotrueURL != "" {
		target, _ := url.Parse(gotrueURL)
		proxy := httputil.NewSingleHostReverseProxy(target) // #nosec G704 -- URL from trusted GOTRUE_URL env var
		mux.HandleFunc("/auth/v1/", func(w http.ResponseWriter, r *http.Request) {
			// Strip /auth/v1 prefix — GoTrue expects /signup, /token, etc. at root
			r.URL.Path = r.URL.Path[len("/auth/v1"):]
			r.Host = target.Host
			proxy.ServeHTTP(w, r)
		})
	}

	return mux
}
