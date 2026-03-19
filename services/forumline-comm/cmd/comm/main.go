package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/ThreeDotsLabs/watermill"
	wmmetrics "github.com/ThreeDotsLabs/watermill/components/metrics"
	"github.com/ThreeDotsLabs/watermill/message"
	"github.com/ThreeDotsLabs/watermill/message/router/middleware"
	"github.com/go-chi/chi/v5"
	"github.com/prometheus/client_golang/prometheus"

	"github.com/forumline/forumline/backend/auth"
	"github.com/forumline/forumline/backend/db"
	"github.com/forumline/forumline/backend/httpkit"
	"github.com/forumline/forumline/backend/metrics"
	"github.com/forumline/forumline/backend/pubsub"
	"github.com/forumline/forumline/backend/sse"
	"github.com/forumline/forumline/backend/valkey"
	localdb "github.com/forumline/forumline/services/forumline-comm/db"
	"github.com/forumline/forumline/services/forumline-comm/handler"
	"github.com/forumline/forumline/services/forumline-comm/presence"
	"github.com/forumline/forumline/services/forumline-comm/realtime"
	"github.com/forumline/forumline/services/forumline-comm/service"
	"github.com/forumline/forumline/services/forumline-comm/store"
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

	valkeyClient := valkey.NewClient(ctx)
	defer valkey.Close(valkeyClient)

	sseHub := sse.NewHub()

	s := store.New(pool)

	// Clean up stale calls from previous server run
	if tag, err := pool.Exec(ctx,
		`UPDATE forumline_calls SET status = CASE WHEN status = 'ringing' THEN 'missed' ELSE 'completed' END, ended_at = now()
		 WHERE status IN ('ringing', 'active')`); err != nil {
		log.Printf("Warning: failed to clean up stale calls: %v", err)
	} else if tag.RowsAffected() > 0 {
		log.Printf("Cleaned up %d stale call(s) from previous run", tag.RowsAffected())
	}

	pushSvc := service.NewPushService(s)
	pushListener := realtime.NewPushListener(s, pushSvc)

	natsURL := os.Getenv("NATS_URL")
	if natsURL == "" {
		log.Fatal("NATS_URL is required -- realtime events need NATS")
	}

	bus, err := pubsub.NewWatermillBus(natsURL)
	if err != nil {
		log.Fatalf("failed to connect to NATS: %v", err)
	}
	defer bus.Close()
	var eventBus pubsub.EventBus = bus

	wmLogger := watermill.NewStdLogger(false, false)
	wmRouter, err := message.NewRouter(message.RouterConfig{}, wmLogger)
	if err != nil {
		log.Fatalf("failed to create Watermill router: %v", err)
	}
	wmRouter.AddMiddleware(middleware.Recoverer)
	wmRouter.AddMiddleware(middleware.CorrelationID)

	wmMetrics := wmmetrics.NewPrometheusMetricsBuilder(prometheus.DefaultRegisterer, "forumline_comm", "watermill")
	wmMetrics.AddPrometheusRouterMetrics(wmRouter)

	for _, ch := range []string{"dm_changes", "call_signal", "forumline_notification_changes"} {
		ch := ch
		wmRouter.AddConsumerHandler("sse-"+ch, ch, bus.Sub, func(msg *message.Message) error {
			sseHub.Feed(ch, msg.Payload)
			return nil
		})
	}

	retryMw := middleware.Retry{
		MaxRetries:      3,
		InitialInterval: 500 * time.Millisecond,
		MaxInterval:     5 * time.Second,
		Multiplier:      2,
		Logger:          wmLogger,
	}
	pushHandler := wmRouter.AddConsumerHandler("push-dm", "push_dm", bus.Sub, func(msg *message.Message) error {
		return pushListener.HandlePayload(ctx, msg.Payload)
	})
	pushHandler.AddMiddleware(retryMw.Middleware)

	go func() {
		if err := wmRouter.Run(ctx); err != nil {
			log.Printf("Watermill router stopped: %v", err)
		}
	}()

	log.Println("realtime: Watermill event bus active")

	convoSvc := service.NewConversationService(s, eventBus)
	callSvc := service.NewCallService(s, pushSvc, eventBus)
	presenceTracker := presence.NewTracker(90*time.Second, valkeyClient)
	lkCfg := handler.NewLiveKitConfigFromEnv()

	r := newRouter(s, sseHub, valkeyClient, eventBus, convoSvc, callSvc, pushSvc, presenceTracker, lkCfg)

	port := os.Getenv("PORT")
	if port == "" {
		port = "3001"
	}

	srv := &http.Server{
		Addr:              ":" + port,
		Handler:           r,
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
	log.Printf("forumline-comm server listening on http://localhost:%s", port)
	if err := srv.ListenAndServe(); err != http.ErrServerClosed {
		log.Fatalf("server error: %v", err)
	}
}

func newRouter(
	s *store.Store,
	sseHub *sse.Hub,
	valkeyClient interface{}, // *redis.Client but unused directly here
	eventBus pubsub.EventBus,
	convoSvc *service.ConversationService,
	callSvc *service.CallService,
	pushSvc *service.PushService,
	tracker *presence.Tracker,
	lkCfg *handler.LiveKitConfig,
) chi.Router {
	r := chi.NewRouter()

	r.Use(httpkit.SecurityHeaders)
	r.Use(httpkit.CORSMiddleware)
	r.Use(metrics.Middleware("forumline_comm"))

	authMW := auth.Middleware
	webhookRL := httpkit.IPRateLimit(100, time.Minute)

	convoH := handler.NewConversationHandler(convoSvc, s)
	callH := handler.NewCallHandler(callSvc, s, lkCfg)
	notifH := handler.NewNotificationHandler(s, eventBus)
	pushH := handler.NewPushHandler(s, pushSvc)
	eventsH := handler.NewEventsHandler(sseHub)

	// Health
	r.Get("/api/health", func(w http.ResponseWriter, _ *http.Request) {
		httpkit.WriteJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	r.Get("/metrics", metrics.Handler().ServeHTTP)

	// Authenticated routes
	r.Group(func(r chi.Router) {
		r.Use(authMW)

		// Conversations
		r.Get("/api/conversations", convoH.HandleList)
		r.Post("/api/conversations", convoH.HandleCreateGroup)
		r.Post("/api/conversations/dm", convoH.HandleGetOrCreateDM)
		r.Get("/api/conversations/{conversationId}", convoH.HandleGet)
		r.Patch("/api/conversations/{conversationId}", convoH.HandleUpdate)
		r.Get("/api/conversations/{conversationId}/messages", convoH.HandleGetMessages)
		r.With(httpkit.UserRateLimit(30, time.Minute)).Post("/api/conversations/{conversationId}/messages", convoH.HandleSendMessage)
		r.Post("/api/conversations/{conversationId}/read", convoH.HandleMarkRead)
		r.Delete("/api/conversations/{conversationId}/members/me", convoH.HandleLeave)

		// Notifications
		r.Get("/api/notifications", notifH.HandleList)
		r.Get("/api/notifications/unread", notifH.HandleUnreadCount)
		r.Post("/api/notifications/read", notifH.HandleMarkRead)
		r.Post("/api/notifications/read-all", notifH.HandleMarkAllRead)

		// Presence
		r.Post("/api/presence/heartbeat", func(w http.ResponseWriter, req *http.Request) {
			userID := auth.UserIDFromContext(req.Context())
			tracker.Touch(userID)
			httpkit.WriteJSON(w, http.StatusOK, map[string]bool{"ok": true})
		})
		r.Get("/api/presence/status", func(w http.ResponseWriter, req *http.Request) {
			idsParam := req.URL.Query().Get("userIds")
			if idsParam == "" {
				httpkit.WriteJSON(w, http.StatusOK, map[string]bool{})
				return
			}
			userIDs := strings.Split(idsParam, ",")
			if len(userIDs) > 200 {
				userIDs = userIDs[:200]
			}
			status := tracker.OnlineStatusBatch(userIDs)
			prefs, err := s.GetOnlineStatusPreferences(req.Context(), userIDs)
			if err == nil {
				for uid, showOnline := range prefs {
					if !showOnline {
						status[uid] = false
					}
				}
			}
			httpkit.WriteJSON(w, http.StatusOK, status)
		})

		// Calls
		r.Post("/api/calls", callH.HandleInitiate)
		r.Post("/api/calls/{callId}/respond", callH.HandleRespond)
		r.Post("/api/calls/{callId}/end", callH.HandleEnd)
		r.Post("/api/calls/{callId}/token", callH.HandleGetToken)

		// Push subscriptions
		r.Post("/api/push", pushH.HandleSubscribe)
	})

	// Webhooks (rate-limited, service key auth inside handler)
	r.Group(func(r chi.Router) {
		r.Use(webhookRL)
		r.Post("/api/webhooks/notification", notifH.HandleWebhookNotification)
		r.Post("/api/webhooks/notifications", notifH.HandleWebhookNotificationBatch)
	})

	// SSE stream (auth required, direct handler for HTTP flushing)
	r.With(authMW).Get("/api/events/stream", eventsH.HandleStream)

	// Push config (public) and push notify (service key auth)
	r.Get("/api/push/config", pushH.HandleConfig)
	r.Post("/api/push/notify", pushH.HandleNotify)

	// Legacy /api/dms/* routes
	r.Group(func(r chi.Router) {
		r.Use(authMW)
		r.Get("/api/dms", convoH.HandleList)
		r.Get("/api/dms/{userId}", convoH.HandleLegacyGetMessages)
		r.With(httpkit.UserRateLimit(30, time.Minute)).Post("/api/dms/{userId}", convoH.HandleLegacySendMessage)
		r.Post("/api/dms/{userId}/read", convoH.HandleLegacyMarkRead)
	})

	return r
}
