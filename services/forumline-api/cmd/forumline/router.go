package main

import (
	"net/http"
	"os"
	"time"

	"github.com/forumline/forumline/backend/auth"
	"github.com/forumline/forumline/backend/httpkit"
	"github.com/forumline/forumline/backend/sse"
	"github.com/forumline/forumline/services/forumline-api/handler"
	"github.com/forumline/forumline/services/forumline-api/presence"
	"github.com/forumline/forumline/services/forumline-api/service"
	"github.com/forumline/forumline/services/forumline-api/store"
	"github.com/redis/go-redis/v9"
)

// use applies middleware to a handler, wrapping in right-to-left order.
func use(h http.HandlerFunc, mws ...func(http.Handler) http.Handler) http.Handler {
	return httpkit.Use(h, mws...)
}

func newRouter(s *store.Store, sseHub *sse.Hub, valkey *redis.Client) *http.ServeMux {
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
	convoH := handler.NewConversationHandler(convoSvc)
	lkCfg := &handler.LiveKitConfig{
		URL:       os.Getenv("LIVEKIT_URL"),
		APIKey:    os.Getenv("LIVEKIT_API_KEY"),
		APISecret: os.Getenv("LIVEKIT_API_SECRET"),
	}
	callH := handler.NewCallHandler(callSvc, lkCfg)
	eventsH := handler.NewEventsHandler(sseHub)
	pushH := handler.NewPushHandler(s, pushSvc)
	activityH := handler.NewActivityHandler(s)
	notifH := handler.NewNotificationHandler(s)
	presenceH := handler.NewPresenceHandler(s, presence.NewTracker(90*time.Second, valkey))

	// Middleware
	authMW := auth.Middleware

	// Rate limiters — use Valkey when available, in-memory fallback otherwise
	// DMs are per-user (authenticated), webhooks are per-IP (service keys)
	dmRL := httpkit.UserRateLimitMiddleware(httpkit.NewValkeyRateLimiter(valkey, 30, time.Minute))

	// Auth routes (Zitadel handles login/signup, we just need session + logout)
	mux.Handle("GET /api/auth/session", use(authH.HandleSession, authMW))
	mux.HandleFunc("POST /api/auth/logout", authH.HandleLogout)

	// Memberships
	mux.Handle("GET /api/memberships", use(membershipH.HandleGetMemberships, authMW))
	mux.Handle("POST /api/memberships", use(membershipH.HandleUpdateAuth, authMW))
	mux.Handle("PUT /api/memberships", use(membershipH.HandleToggleMute, authMW))
	mux.Handle("POST /api/memberships/join", use(membershipH.HandleJoin, authMW))
	mux.Handle("DELETE /api/memberships", use(membershipH.HandleLeave, authMW))

	// Conversations / DMs
	mux.Handle("GET /api/conversations", use(convoH.HandleList, authMW))
	mux.Handle("POST /api/conversations", use(convoH.HandleCreateGroup, authMW))
	mux.Handle("POST /api/conversations/dm", use(convoH.HandleGetOrCreateDM, authMW))
	mux.Handle("GET /api/conversations/{conversationId}", use(convoH.HandleGet, authMW))
	mux.Handle("PATCH /api/conversations/{conversationId}", use(convoH.HandleUpdate, authMW))
	mux.Handle("GET /api/conversations/{conversationId}/messages", use(convoH.HandleGetMessages, authMW))
	mux.Handle("POST /api/conversations/{conversationId}/messages", use(convoH.HandleSendMessage, authMW, dmRL))
	mux.Handle("POST /api/conversations/{conversationId}/read", use(convoH.HandleMarkRead, authMW))
	mux.Handle("DELETE /api/conversations/{conversationId}/members/me", use(convoH.HandleLeave, authMW))

	// Legacy /api/dms/* routes
	mux.Handle("GET /api/dms", use(convoH.HandleList, authMW))
	mux.Handle("GET /api/dms/{userId}", use(convoH.HandleLegacyGetMessages, authMW))
	mux.Handle("POST /api/dms/{userId}", use(convoH.HandleLegacySendMessage, authMW, dmRL))
	mux.Handle("POST /api/dms/{userId}/read", use(convoH.HandleLegacyMarkRead, authMW))


	// Forums
	mux.HandleFunc("GET /api/forums", forumH.HandleListForums)
	mux.HandleFunc("GET /api/forums/tags", forumH.HandleListTags)
	mux.Handle("GET /api/forums/recommended", use(forumH.HandleRecommended, authMW))
	mux.Handle("GET /api/forums/owned", use(forumH.HandleListOwned, authMW))
	mux.Handle("POST /api/forums", use(forumH.HandleRegister, authMW))
	mux.Handle("DELETE /api/forums", use(forumH.HandleDelete, authMW))

	// Forum admin (service key auth)
	mux.HandleFunc("PUT /api/forums/screenshot", forumH.HandleUpdateScreenshot)
	mux.HandleFunc("PUT /api/forums/icon", forumH.HandleUpdateIcon)
	mux.HandleFunc("PUT /api/forums/health", forumH.HandleUpdateHealth)
	mux.HandleFunc("GET /api/forums/all", forumH.HandleListAll)

	// Activity feed
	mux.Handle("GET /api/activity", use(activityH.HandleActivity, authMW))

	// Notifications (local DB, pushed from forums)
	mux.Handle("GET /api/notifications", use(notifH.HandleNotifications, authMW))
	mux.Handle("GET /api/notifications/unread", use(notifH.HandleUnreadCount, authMW))
	mux.Handle("POST /api/notifications/read", use(notifH.HandleMarkRead, authMW))
	mux.Handle("POST /api/notifications/read-all", use(notifH.HandleMarkAllRead, authMW))

	// Webhook (forum → forumline push)
	webhookH := handler.NewWebhookHandler(s)
	webhookRL := httpkit.RateLimitMiddleware(httpkit.NewValkeyRateLimiter(valkey, 100, time.Minute))
	mux.Handle("POST /api/webhooks/notification", use(webhookH.HandleNotification, webhookRL))
	mux.Handle("POST /api/webhooks/notifications", use(webhookH.HandleNotificationBatch, webhookRL))

	// Presence
	mux.Handle("POST /api/presence/heartbeat", use(presenceH.HandleHeartbeat, authMW))
	mux.Handle("GET /api/presence/status", use(presenceH.HandleStatus, authMW))

	// Identity
	mux.Handle("GET /api/identity", use(identityH.HandleGetIdentity, authMW))
	mux.Handle("PUT /api/identity", use(identityH.HandleUpdateIdentity, authMW))
	mux.Handle("DELETE /api/identity", use(identityH.HandleDeleteIdentity, authMW))

	// Profile search
	mux.Handle("GET /api/profiles/search", use(identityH.HandleSearchProfiles, authMW))

	// Unified event stream (DMs + notifications + calls in one SSE connection)
	mux.Handle("GET /api/events/stream", use(eventsH.HandleStream, authMW))

	// Calls (media via LiveKit)
	mux.Handle("POST /api/calls", use(callH.HandleInitiate, authMW))
	mux.Handle("POST /api/calls/{callId}/respond", use(callH.HandleRespond, authMW))
	mux.Handle("POST /api/calls/{callId}/end", use(callH.HandleEnd, authMW))
	mux.Handle("POST /api/calls/{callId}/token", use(callH.HandleToken, authMW))

	// Push notifications
	mux.Handle("POST /api/push", use(pushH.Handle, authMW))

	return mux
}
