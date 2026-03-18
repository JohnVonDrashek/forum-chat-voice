package forum

import (
	"net/http"
	"time"

	"github.com/forumline/forumline/forum/oapi"
	"github.com/forumline/forumline/forum/service"
	"github.com/forumline/forumline/forum/store"
)

// NewRouter creates the forum HTTP router with all endpoints wired up.
// The Config must have Auth, Storage, DB, and SSEHub set.
// ValkeyClient may be nil (rate limiting falls back to in-memory).
func NewRouter(cfg *Config) *http.ServeMux {
	// Create layers
	s := store.New(cfg.DB)

	notifSvc := service.NewNotificationService(s, &service.NotificationConfig{
		ForumlineURL: cfg.ForumlineURL,
		ServiceKey:   cfg.ForumlineServiceKey,
	}, cfg.EventBus, cfg.Schema)
	threadSvc := service.NewThreadService(s)
	postSvc := service.NewPostService(s, notifSvc, cfg.EventBus, cfg.Schema)
	profileSvc := service.NewProfileService(s)
	chatSvc := service.NewChatService(s, cfg.EventBus, cfg.Schema)
	adminSvc := service.NewAdminService(s)

	h := &Handlers{
		SSEHub:          cfg.SSEHub,
		Config:          cfg,
		Store:           s,
		ThreadSvc:       threadSvc,
		PostSvc:         postSvc,
		ProfileSvc:      profileSvc,
		ChatSvc:         chatSvc,
		AdminSvc:        adminSvc,
		NotificationSvc: notifSvc,
		ProfileCache:    NewProfileCache(cfg.ValkeyClient, cfg.DB, 30*time.Second),
	}

	// Build per-operation middleware (auth, rate limiting)
	opMiddleware := BuildOperationMiddleware(cfg)

	// Use oapi-codegen strict handler so the generated layer handles param
	// binding/decoding. We inject the raw *http.Request into context via
	// withHTTPRequest so auth-delegate handlers can call Auth.*(w, r).
	mux := http.NewServeMux()
	strictHandler := oapi.NewStrictHandler(h, nil)
	oapi.HandlerWithOptions(strictHandler, oapi.StdHTTPServerOptions{
		BaseRouter: mux,
		Middlewares: []oapi.MiddlewareFunc{
			withHTTPRequest,
			NewPerOperationMiddleware(opMiddleware),
		},
	})

	return mux
}
