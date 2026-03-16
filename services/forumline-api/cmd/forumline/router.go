package main

import (
	"net/http"
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
	return shared.Use(h, mws...)
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
	identityH := handler.NewIdentityHandler(s)
	membershipH := handler.NewMembershipHandler(s, forumSvc)
	forumH := handler.NewForumHandler(s, forumSvc)
	convoH := handler.NewConversationHandler(convoSvc, sseHub)
	lkCfg := &handler.LiveKitConfig{
		URL:       os.Getenv("LIVEKIT_URL"),
		APIKey:    os.Getenv("LIVEKIT_API_KEY"),
		APISecret: os.Getenv("LIVEKIT_API_SECRET"),
	}
	callH := handler.NewCallHandler(callSvc, sseHub, lkCfg)
	eventsH := handler.NewEventsHandler(sseHub)
	pushH := handler.NewPushHandler(s, pushSvc)
	activityH := handler.NewActivityHandler(s)
	notifH := handler.NewNotificationHandler(s, sseHub)
	presenceH := handler.NewPresenceHandler(s, presence.NewTracker(90*time.Second))

	// Middleware
	auth := shared.AuthMiddleware

	// Rate limiters
	dmRL := shared.RateLimitMiddleware(shared.NewRateLimiter(30, time.Minute))

	// Auth routes (Zitadel handles login/signup, we just need session + logout)
	mux.Handle("GET /api/auth/session", use(authH.HandleSession, auth))
	mux.HandleFunc("POST /api/auth/logout", authH.HandleLogout)

	// Memberships
	mux.Handle("GET /api/memberships", use(membershipH.HandleGetMemberships, auth))
	mux.Handle("POST /api/memberships", use(membershipH.HandleUpdateAuth, auth))
	mux.Handle("PUT /api/memberships", use(membershipH.HandleToggleMute, auth))
	mux.Handle("POST /api/memberships/join", use(membershipH.HandleJoin, auth))
	mux.Handle("DELETE /api/memberships", use(membershipH.HandleLeave, auth))

	// Conversations / DMs
	mux.Handle("GET /api/conversations/stream", use(convoH.HandleStream, auth))
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
	mux.Handle("GET /api/dms/{userId}/stream", use(convoH.HandleStream, auth))

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
	mux.Handle("GET /api/notifications/stream", use(notifH.HandleStream, auth))
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

	// Unified event stream (DMs + notifications + calls in one SSE connection)
	mux.Handle("GET /api/events/stream", use(eventsH.HandleStream, auth))

	// Calls (lifecycle via SSE, media via LiveKit)
	mux.Handle("GET /api/calls/stream", use(callH.HandleStream, auth))
	mux.Handle("POST /api/calls", use(callH.HandleInitiate, auth))
	mux.Handle("POST /api/calls/{callId}/respond", use(callH.HandleRespond, auth))
	mux.Handle("POST /api/calls/{callId}/end", use(callH.HandleEnd, auth))
	mux.Handle("POST /api/calls/{callId}/token", use(callH.HandleToken, auth))

	// Push notifications
	mux.Handle("POST /api/push", use(pushH.Handle, auth))

	return mux
}
