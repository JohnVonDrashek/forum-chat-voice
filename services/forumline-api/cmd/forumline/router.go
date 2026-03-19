package main

import (
	"net/http"
	"os"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/forumline/forumline/backend/auth"
	"github.com/forumline/forumline/backend/httpkit"
	"github.com/forumline/forumline/backend/metrics"
	"github.com/forumline/forumline/backend/pubsub"
	"github.com/forumline/forumline/backend/sse"
	"github.com/forumline/forumline/services/forumline-api/handler"
	"github.com/forumline/forumline/services/forumline-api/oapi"
	"github.com/forumline/forumline/services/forumline-api/presence"
	"github.com/forumline/forumline/services/forumline-api/service"
	"github.com/forumline/forumline/services/forumline-api/store"
	"github.com/redis/go-redis/v9"
)

func newRouter(s *store.Store, sseHub *sse.Hub, valkey *redis.Client, bus pubsub.EventBus) chi.Router {
	r := chi.NewRouter()

	// Global middleware (must be before any route registration)
	r.Use(httpkit.SecurityHeaders)
	r.Use(httpkit.CORSMiddleware)
	r.Use(metrics.Middleware("forumline_api"))

	// Inject *http.Request into context for all requests — strict server
	// methods need it for service-key auth and Zitadel header forwarding.
	r.Use(withHTTPRequest)

	// Services
	forumSvc := service.NewForumService(s)
	pushSvc := service.NewPushService(s)
	callSvc := service.NewCallService(s, pushSvc, bus)
	presenceTracker := presence.NewTracker(90*time.Second, valkey)

	// GraphQL proxy for direct Hasura access
	graphqlProxy := handler.NewGraphQLProxy(
		os.Getenv("HASURA_GRAPHQL_ENDPOINT"),
		os.Getenv("HASURA_GRAPHQL_ADMIN_SECRET"),
	)

	// Strict server — implements spec endpoints
	ss := &StrictServer{
		store:    s,
		forumSvc: forumSvc,
		callSvc:  callSvc,
		pushSvc:  pushSvc,
		hasura:   nil, // No longer used — use /graphql endpoint
		lkCfg: &lkConfig{
			URL:       os.Getenv("LIVEKIT_URL"),
			APIKey:    os.Getenv("LIVEKIT_API_KEY"),
			APISecret: os.Getenv("LIVEKIT_API_SECRET"),
		},
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

	authMW := auth.Middleware
	webhookRL := httpkit.IPRateLimit(100, time.Minute)

	// ── Public routes (no auth) ──────────────────────────────────────────

	r.Get("/api/health", w.GetHealth)
	r.Get("/metrics", metrics.Handler().ServeHTTP)
	r.Get("/api/forums", w.ListForums)
	r.Get("/api/forums/tags", w.ListForumTags)
	r.Post("/api/auth/logout", w.Logout)

	// ── Authenticated routes ─────────────────────────────────────────────

	r.Group(func(r chi.Router) {
		r.Use(authMW)

		// GraphQL — direct Hasura access (eliminates REST API boilerplate)
		r.Post("/graphql", graphqlProxy.Handler)

		// Auth & Identity
		r.Get("/api/auth/session", w.GetSession)
		r.Get("/api/identity", w.GetIdentity)
		r.Put("/api/identity", w.UpdateIdentity)
		r.Delete("/api/identity", w.DeleteIdentity)
		r.Get("/api/profiles/search", w.SearchProfiles)

		// Conversations
		r.Get("/api/conversations", w.ListConversations)
		r.Post("/api/conversations", w.CreateGroupConversation)
		r.Post("/api/conversations/dm", w.GetOrCreateDM)
		r.Get("/api/conversations/{conversationId}", w.GetConversation)
		r.Patch("/api/conversations/{conversationId}", w.UpdateConversation)
		r.Get("/api/conversations/{conversationId}/messages", w.GetMessages)
		r.With(httpkit.UserRateLimit(30, time.Minute)).Post("/api/conversations/{conversationId}/messages", w.SendMessage)
		r.Post("/api/conversations/{conversationId}/read", w.MarkConversationRead)
		r.Delete("/api/conversations/{conversationId}/members/me", w.LeaveConversation)

		// Forums (auth-required)
		r.Get("/api/forums/recommended", w.GetRecommendedForums)
		r.Get("/api/forums/owned", w.GetOwnedForums)
		r.Post("/api/forums", w.RegisterForum)
		r.Delete("/api/forums", w.DeleteForum)

		// Memberships
		r.Get("/api/memberships", w.GetMemberships)
		r.Post("/api/memberships", w.UpdateMembershipAuth)
		r.Put("/api/memberships", w.ToggleMembershipMute)
		r.Post("/api/memberships/join", w.JoinForum)
		r.Delete("/api/memberships", w.LeaveForum)

		// Notifications
		r.Get("/api/notifications", w.GetNotifications)
		r.Get("/api/notifications/unread", w.GetUnreadCount)
		r.Post("/api/notifications/read", w.MarkNotificationRead)
		r.Post("/api/notifications/read-all", w.MarkAllNotificationsRead)

		// Activity
		r.Get("/api/activity", w.GetActivity)

		// Presence
		r.Post("/api/presence/heartbeat", w.PresenceHeartbeat)
		r.Get("/api/presence/status", w.GetPresenceStatus)

		// Calls
		r.Post("/api/calls", w.InitiateCall)
		r.Post("/api/calls/{callId}/respond", w.RespondToCall)
		r.Post("/api/calls/{callId}/end", w.EndCall)
		r.Post("/api/calls/{callId}/token", w.GetCallToken)

		// Push subscriptions
		r.Post("/api/push", w.ManagePushSubscription)
	})

	// ── Webhooks (rate-limited, service key auth inside handler) ─────────

	r.Group(func(r chi.Router) {
		r.Use(webhookRL)
		r.Post("/api/webhooks/notification", w.WebhookNotification)
		r.Post("/api/webhooks/notifications", w.WebhookNotificationBatch)
	})

	// ── SSE stream (auth, direct handler — bypasses strict server for HTTP flushing) ──

	eventsH := handler.NewEventsHandler(sseHub)
	r.With(authMW).Get("/api/events/stream", eventsH.HandleStream)

	// ── Forum admin (service key auth, not in spec) ─────────────────────

	forumH := handler.NewForumHandler(s, forumSvc)
	r.Put("/api/forums/screenshot", forumH.HandleUpdateScreenshot)
	r.Put("/api/forums/icon", forumH.HandleUpdateIcon)
	r.Put("/api/forums/health", forumH.HandleUpdateHealth)
	r.Get("/api/forums/all", forumH.HandleListAll)

	// ── Push (not in spec — config is public, notify uses service key auth) ──

	pushH := handler.NewPushHandler(s, pushSvc)
	r.Get("/api/push/config", pushH.HandleConfig)
	r.Post("/api/push/notify", pushH.HandleNotify)

	// ── Legacy /api/dms/* routes (removed — use POST /graphql instead) ───────────────
	// Clients should use GraphQL queries/mutations for conversations:
	// POST /graphql with conversations queries (ListConversations, GetMessages, etc.)

	// ── Internal Connect RPC services (service-to-service, not browser-facing) ──

	mountHubService(r, forumSvc)

	return r
}
