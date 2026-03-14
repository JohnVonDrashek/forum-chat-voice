package main

import (
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"time"

	"github.com/forumline/forumline/services/forumline-api/handler"
	"github.com/forumline/forumline/services/forumline-api/presence"
	"github.com/forumline/forumline/services/forumline-api/service"
	"github.com/forumline/forumline/services/forumline-api/store"
	shared "github.com/forumline/forumline/shared-go"
)

// use applies middleware to a handler, wrapping in right-to-left order.
func use(h http.HandlerFunc, mws ...func(http.Handler) http.Handler) http.Handler {
	var handler http.Handler = h
	for i := len(mws) - 1; i >= 0; i-- {
		handler = mws[i](handler)
	}
	return handler
}

func newRouter(s *store.Store, sseHub *shared.SSEHub) *http.ServeMux {
	mux := http.NewServeMux()

	// Services
	forumSvc := service.NewForumService(s)
	pushSvc := service.NewPushService(s)
	convoSvc := service.NewConversationService(s)
	callSvc := service.NewCallService(s, pushSvc)

	// Handlers
	authH := handler.NewAuthHandler(s)
	oauthH := handler.NewOAuthHandler(s)
	identityH := handler.NewIdentityHandler(s)
	membershipH := handler.NewMembershipHandler(s, forumSvc)
	forumH := handler.NewForumHandler(s, forumSvc)
	convoH := handler.NewConversationHandler(convoSvc, sseHub)
	callH := handler.NewCallHandler(callSvc, sseHub)
	pushH := handler.NewPushHandler(s, pushSvc)
	activityH := handler.NewActivityHandler(s)
	notifH := handler.NewNotificationHandler(s, sseHub)
	presenceH := handler.NewPresenceHandler(s, presence.NewTracker(90*time.Second))

	// Middleware
	auth := shared.AuthMiddleware

	// Rate limiters
	authRL := shared.RateLimitMiddleware(shared.NewRateLimiter(10, time.Minute))
	signupRL := shared.RateLimitMiddleware(shared.NewRateLimiter(5, time.Minute))
	tokenRL := shared.RateLimitMiddleware(shared.NewRateLimiter(10, time.Minute))
	dmRL := shared.RateLimitMiddleware(shared.NewRateLimiter(30, time.Minute))

	// Auth routes
	mux.Handle("POST /api/auth/login", use(authH.HandleLogin, authRL))
	mux.Handle("POST /api/auth/signup", use(authH.HandleSignup, signupRL))
	mux.HandleFunc("POST /api/auth/logout", authH.HandleLogout)
	mux.HandleFunc("GET /api/auth/session", authH.HandleSession)

	// OAuth routes
	mux.HandleFunc("GET /api/oauth/authorize", oauthH.HandleAuthorize)
	mux.HandleFunc("POST /api/oauth/authorize", oauthH.HandleAuthorize)
	mux.Handle("POST /api/oauth/token", use(oauthH.HandleToken, tokenRL))

	// Memberships
	mux.Handle("GET /api/memberships", use(membershipH.HandleGetMemberships, auth))
	mux.Handle("POST /api/memberships", use(membershipH.HandleUpdateAuth, auth))
	mux.Handle("PUT /api/memberships", use(membershipH.HandleToggleMute, auth))
	mux.Handle("POST /api/memberships/join", use(membershipH.HandleJoin, auth))
	mux.Handle("DELETE /api/memberships", use(membershipH.HandleLeave, auth))

	// Conversations / DMs
	mux.HandleFunc("GET /api/conversations/stream", convoH.HandleStream)
	mux.Handle("GET /api/conversations", use(convoH.HandleList, auth))
	mux.Handle("POST /api/conversations", use(convoH.HandleCreateGroup, auth))
	mux.Handle("POST /api/conversations/dm", use(convoH.HandleGetOrCreateDM, auth))
	mux.Handle("GET /api/conversations/{conversationId}", use(convoH.HandleGet, auth))
	mux.Handle("PATCH /api/conversations/{conversationId}", use(convoH.HandleUpdate, auth))
	mux.Handle("GET /api/conversations/{conversationId}/messages", use(convoH.HandleGetMessages, auth))
	mux.Handle("POST /api/conversations/{conversationId}/messages", use(convoH.HandleSendMessage, auth, dmRL))
	mux.Handle("POST /api/conversations/{conversationId}/read", use(convoH.HandleMarkRead, auth))
	mux.Handle("DELETE /api/conversations/{conversationId}/members/me", use(convoH.HandleLeave, auth))

	// Legacy /api/dms/* routes
	mux.Handle("GET /api/dms", use(convoH.HandleList, auth))
	mux.Handle("GET /api/dms/{userId}", use(convoH.HandleLegacyGetMessages, auth))
	mux.Handle("POST /api/dms/{userId}", use(convoH.HandleLegacySendMessage, auth, dmRL))
	mux.Handle("POST /api/dms/{userId}/read", use(convoH.HandleLegacyMarkRead, auth))
	mux.HandleFunc("GET /api/dms/{userId}/stream", convoH.HandleStream)

	// Forums
	mux.HandleFunc("GET /api/forums", forumH.HandleListForums)
	mux.HandleFunc("GET /api/forums/tags", forumH.HandleListTags)
	mux.Handle("GET /api/forums/recommended", use(forumH.HandleRecommended, auth))
	mux.Handle("GET /api/forums/owned", use(forumH.HandleListOwned, auth))
	mux.Handle("POST /api/forums", use(forumH.HandleRegister, auth))
	mux.Handle("DELETE /api/forums", use(forumH.HandleDelete, auth))

	// Forum admin (service key auth)
	mux.HandleFunc("POST /api/forums/ensure-oauth", forumH.HandleEnsureOAuth)
	mux.HandleFunc("PUT /api/forums/screenshot", forumH.HandleUpdateScreenshot)
	mux.HandleFunc("PUT /api/forums/icon", forumH.HandleUpdateIcon)
	mux.HandleFunc("PUT /api/forums/health", forumH.HandleUpdateHealth)
	mux.HandleFunc("GET /api/forums/all", forumH.HandleListAll)

	// Activity feed
	mux.Handle("GET /api/activity", use(activityH.HandleActivity, auth))

	// Notifications (local DB, pushed from forums)
	mux.HandleFunc("GET /api/notifications/stream", notifH.HandleStream)
	mux.Handle("GET /api/notifications", use(notifH.HandleNotifications, auth))
	mux.Handle("GET /api/notifications/unread", use(notifH.HandleUnreadCount, auth))
	mux.Handle("POST /api/notifications/read", use(notifH.HandleMarkRead, auth))
	mux.Handle("POST /api/notifications/read-all", use(notifH.HandleMarkAllRead, auth))

	// Webhook (forum → forumline push)
	webhookH := handler.NewWebhookHandler(s)
	webhookRL := shared.RateLimitMiddleware(shared.NewRateLimiter(100, time.Minute))
	mux.Handle("POST /api/webhooks/notification", use(webhookH.HandleNotification, webhookRL))
	mux.Handle("POST /api/webhooks/notifications", use(webhookH.HandleNotificationBatch, webhookRL))

	// Presence
	mux.Handle("POST /api/presence/heartbeat", use(presenceH.HandleHeartbeat, auth))
	mux.Handle("GET /api/presence/status", use(presenceH.HandleStatus, auth))

	// Identity
	mux.Handle("GET /api/identity", use(identityH.HandleGetIdentity, auth))
	mux.Handle("PUT /api/identity", use(identityH.HandleUpdateIdentity, auth))
	mux.Handle("DELETE /api/identity", use(identityH.HandleDeleteIdentity, auth))

	// Profile search
	mux.Handle("GET /api/profiles/search", use(identityH.HandleSearchProfiles, auth))

	// Calls
	mux.HandleFunc("GET /api/calls/stream", callH.HandleStream)
	mux.Handle("POST /api/calls", use(callH.HandleInitiate, auth))
	mux.Handle("POST /api/calls/{callId}/respond", use(callH.HandleRespond, auth))
	mux.Handle("POST /api/calls/{callId}/end", use(callH.HandleEnd, auth))
	mux.Handle("POST /api/calls/signal", use(callH.HandleSignal, auth))

	// Push notifications
	mux.HandleFunc("POST /api/push", pushH.Handle)

	// GoTrue reverse proxy
	gotrueURL := os.Getenv("GOTRUE_URL")
	if gotrueURL != "" {
		target, _ := url.Parse(gotrueURL)
		proxy := httputil.NewSingleHostReverseProxy(target) // #nosec G704 -- URL from trusted GOTRUE_URL env var
		mux.HandleFunc("/auth/v1/", func(w http.ResponseWriter, r *http.Request) {
			r.URL.Path = r.URL.Path[len("/auth/v1"):]
			r.Host = target.Host
			proxy.ServeHTTP(w, r)
		})
	}

	return mux
}
