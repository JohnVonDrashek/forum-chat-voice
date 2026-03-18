package main

import (
	"net/http"
	"os"
	"time"

	"github.com/forumline/forumline/backend/auth"
	"github.com/forumline/forumline/backend/httpkit"
	"github.com/forumline/forumline/backend/pubsub"
	"github.com/forumline/forumline/backend/sse"
	"github.com/forumline/forumline/services/forumline-api/handler"
	"github.com/forumline/forumline/services/forumline-api/oapi"
	"github.com/forumline/forumline/services/forumline-api/presence"
	"github.com/forumline/forumline/services/forumline-api/service"
	"github.com/forumline/forumline/services/forumline-api/store"
	"github.com/redis/go-redis/v9"
)

// use applies middleware to a handler, wrapping in right-to-left order.
func use(h http.HandlerFunc, mws ...func(http.Handler) http.Handler) http.Handler {
	return httpkit.Use(h, mws...)
}

func newRouter(s *store.Store, sseHub *sse.Hub, valkey *redis.Client, bus pubsub.EventBus) *http.ServeMux {
	mux := http.NewServeMux()

	// Services
	forumSvc := service.NewForumService(s)
	pushSvc := service.NewPushService(s)
	convoSvc := service.NewConversationService(s, bus)
	callSvc := service.NewCallService(s, pushSvc, bus)
	presenceTracker := presence.NewTracker(90*time.Second, valkey)

	// Rate limiter for DMs — per-user, 30 msgs/minute
	dmRL := httpkit.NewValkeyRateLimiter(valkey, 30, time.Minute)

	// Strict server — implements all spec endpoints
	ss := &StrictServer{
		store:    s,
		convoSvc: convoSvc,
		forumSvc: forumSvc,
		callSvc:  callSvc,
		pushSvc:  pushSvc,
		lkCfg: &lkConfig{
			URL:       os.Getenv("LIVEKIT_URL"),
			APIKey:    os.Getenv("LIVEKIT_API_KEY"),
			APISecret: os.Getenv("LIVEKIT_API_SECRET"),
		},
		dmRL:     dmRL,
		sseHub:   sseHub,
		tracker:  presenceTracker,
		eventBus: bus,
	}

	// Build the strict ServerInterface and wrapper.
	// The wrapper's methods are proper http.HandlerFunc that extract path/query params.
	si := oapi.NewStrictHandlerWithOptions(ss, nil, oapi.StrictHTTPServerOptions{
		ResponseErrorHandlerFunc: strictErrorHandler,
	})
	w := &oapi.ServerInterfaceWrapper{
		Handler: si,
		ErrorHandlerFunc: func(rw http.ResponseWriter, r *http.Request, err error) {
			http.Error(rw, err.Error(), http.StatusBadRequest)
		},
	}

	// Middleware
	authMW := auth.Middleware

	// Rate limiter middleware for webhook endpoints (per-IP, 100 req/min)
	webhookRL := httpkit.RateLimitMiddleware(httpkit.NewValkeyRateLimiter(valkey, 100, time.Minute))

	// withReq injects the *http.Request into the context for service-key auth endpoints.
	withReq := withHTTPRequest

	// --- Spec routes via StrictServer ---

	// Health check (no auth)
	mux.Handle("GET /api/health", withReq(http.HandlerFunc(w.GetHealth)))

	// Auth routes
	mux.Handle("GET /api/auth/session", withReq(use(w.GetSession, authMW)))
	mux.Handle("POST /api/auth/logout", withReq(http.HandlerFunc(w.Logout)))

	// Identity
	mux.Handle("GET /api/identity", withReq(use(w.GetIdentity, authMW)))
	mux.Handle("PUT /api/identity", withReq(use(w.UpdateIdentity, authMW)))
	mux.Handle("DELETE /api/identity", withReq(use(w.DeleteIdentity, authMW)))
	mux.Handle("GET /api/profiles/search", withReq(use(w.SearchProfiles, authMW)))

	// Conversations
	mux.Handle("GET /api/conversations", withReq(use(w.ListConversations, authMW)))
	mux.Handle("POST /api/conversations", withReq(use(w.CreateGroupConversation, authMW)))
	mux.Handle("POST /api/conversations/dm", withReq(use(w.GetOrCreateDM, authMW)))
	mux.Handle("GET /api/conversations/{conversationId}", withReq(use(w.GetConversation, authMW)))
	mux.Handle("PATCH /api/conversations/{conversationId}", withReq(use(w.UpdateConversation, authMW)))
	mux.Handle("GET /api/conversations/{conversationId}/messages", withReq(use(w.GetMessages, authMW)))
	mux.Handle("POST /api/conversations/{conversationId}/messages", withReq(use(w.SendMessage, authMW)))
	mux.Handle("POST /api/conversations/{conversationId}/read", withReq(use(w.MarkConversationRead, authMW)))
	mux.Handle("DELETE /api/conversations/{conversationId}/members/me", withReq(use(w.LeaveConversation, authMW)))

	// Forums
	mux.Handle("GET /api/forums", withReq(http.HandlerFunc(w.ListForums)))
	mux.Handle("GET /api/forums/tags", withReq(http.HandlerFunc(w.ListForumTags)))
	mux.Handle("GET /api/forums/recommended", withReq(use(w.GetRecommendedForums, authMW)))
	mux.Handle("GET /api/forums/owned", withReq(use(w.GetOwnedForums, authMW)))
	mux.Handle("POST /api/forums", withReq(use(w.RegisterForum, authMW)))
	mux.Handle("DELETE /api/forums", withReq(use(w.DeleteForum, authMW)))

	// Memberships
	mux.Handle("GET /api/memberships", withReq(use(w.GetMemberships, authMW)))
	mux.Handle("POST /api/memberships", withReq(use(w.UpdateMembershipAuth, authMW)))
	mux.Handle("PUT /api/memberships", withReq(use(w.ToggleMembershipMute, authMW)))
	mux.Handle("POST /api/memberships/join", withReq(use(w.JoinForum, authMW)))
	mux.Handle("DELETE /api/memberships", withReq(use(w.LeaveForum, authMW)))

	// Notifications
	mux.Handle("GET /api/notifications", withReq(use(w.GetNotifications, authMW)))
	mux.Handle("GET /api/notifications/unread", withReq(use(w.GetUnreadCount, authMW)))
	mux.Handle("POST /api/notifications/read", withReq(use(w.MarkNotificationRead, authMW)))
	mux.Handle("POST /api/notifications/read-all", withReq(use(w.MarkAllNotificationsRead, authMW)))

	// Activity
	mux.Handle("GET /api/activity", withReq(use(w.GetActivity, authMW)))

	// Presence
	mux.Handle("POST /api/presence/heartbeat", withReq(use(w.PresenceHeartbeat, authMW)))
	mux.Handle("GET /api/presence/status", withReq(use(w.GetPresenceStatus, authMW)))

	// Calls
	mux.Handle("POST /api/calls", withReq(use(w.InitiateCall, authMW)))
	mux.Handle("POST /api/calls/{callId}/respond", withReq(use(w.RespondToCall, authMW)))
	mux.Handle("POST /api/calls/{callId}/end", withReq(use(w.EndCall, authMW)))
	mux.Handle("POST /api/calls/{callId}/token", withReq(use(w.GetCallToken, authMW)))

	// Push subscriptions (subscribe/unsubscribe)
	mux.Handle("POST /api/push", withReq(use(w.ManagePushSubscription, authMW)))

	// Webhooks (service key auth checked inside StrictServer, rate-limited)
	mux.Handle("POST /api/webhooks/notification", withReq(use(w.WebhookNotification, webhookRL)))
	mux.Handle("POST /api/webhooks/notifications", withReq(use(w.WebhookNotificationBatch, webhookRL)))

	// --- Routes NOT in the spec ---

	// Events stream (SSE — direct handler, bypasses strict server for HTTP flushing)
	eventsH := handler.NewEventsHandler(sseHub)
	mux.Handle("GET /api/events/stream", use(eventsH.HandleStream, authMW))

	// Forum admin (service key auth, not in spec)
	forumH := handler.NewForumHandler(s, forumSvc)
	mux.HandleFunc("PUT /api/forums/screenshot", forumH.HandleUpdateScreenshot)
	mux.HandleFunc("PUT /api/forums/icon", forumH.HandleUpdateIcon)
	mux.HandleFunc("PUT /api/forums/health", forumH.HandleUpdateHealth)
	mux.HandleFunc("GET /api/forums/all", forumH.HandleListAll)

	// Push notify (service key auth, not in spec — separate from subscribe/unsubscribe)
	pushH := handler.NewPushHandler(s, pushSvc)
	mux.HandleFunc("POST /api/push/notify", pushH.HandleNotify)

	// Legacy /api/dms/* routes (backward compatibility)
	convoH := handler.NewConversationHandler(convoSvc, s)
	mux.Handle("GET /api/dms", use(convoH.HandleList, authMW))
	mux.Handle("GET /api/dms/{userId}", use(convoH.HandleLegacyGetMessages, authMW))
	mux.Handle("POST /api/dms/{userId}", use(convoH.HandleLegacySendMessage, authMW,
		httpkit.UserRateLimitMiddleware(dmRL)))
	mux.Handle("POST /api/dms/{userId}/read", use(convoH.HandleLegacyMarkRead, authMW))

	// Internal Connect RPC services (service-to-service, not browser-facing)
	mountHubService(mux, forumSvc)

	return mux
}
