package forum

import (
	"net/http"
	"time"

	fauth "github.com/forumline/forumline/backend/auth"
	"github.com/forumline/forumline/backend/db"
	"github.com/forumline/forumline/backend/httpkit"
	"github.com/forumline/forumline/backend/sse"
	"github.com/forumline/forumline/services/hosted/forum/service"
	"github.com/forumline/forumline/services/hosted/forum/store"
	"github.com/redis/go-redis/v9"
)

func NewRouter(pool db.DB, sseHub *sse.Hub, cfg *Config, valkeyClient *redis.Client) *http.ServeMux {
	mux := http.NewServeMux()

	auth := fauth.Middleware

	// Create layers
	s := store.New(pool)

	notifSvc := service.NewNotificationService(s, &service.NotificationConfig{
		ForumlineURL: cfg.ForumlineURL,
	})
	threadSvc := service.NewThreadService(s)
	postSvc := service.NewPostService(s, notifSvc)
	profileSvc := service.NewProfileService(s)
	chatSvc := service.NewChatService(s)
	adminSvc := service.NewAdminService(s)

	h := &Handlers{
		SSEHub:          sseHub,
		Config:          cfg,
		Store:           s,
		ThreadSvc:       threadSvc,
		PostSvc:         postSvc,
		ProfileSvc:      profileSvc,
		ChatSvc:         chatSvc,
		AdminSvc:        adminSvc,
		NotificationSvc: notifSvc,
		ProfileCache:    NewProfileCache(valkeyClient, pool, 30*time.Second),
	}

	// Rate limiters (per-user for authenticated, per-IP for public/auth)
	chatRL := httpkit.UserRateLimitMiddleware(httpkit.NewValkeyRateLimiter(valkeyClient, 60, time.Minute))   // 60 msgs/min
	writeRL := httpkit.UserRateLimitMiddleware(httpkit.NewValkeyRateLimiter(valkeyClient, 20, time.Minute))  // 20 creates/min
	uploadRL := httpkit.UserRateLimitMiddleware(httpkit.NewValkeyRateLimiter(valkeyClient, 5, time.Minute))  // 5 uploads/min
	importRL := httpkit.UserRateLimitMiddleware(httpkit.NewValkeyRateLimiter(valkeyClient, 3, time.Minute))  // 3 imports/min
	authRL := httpkit.RateLimitMiddleware(httpkit.NewValkeyRateLimiter(valkeyClient, 20, time.Minute))       // 20 auth attempts/min per IP

	// Channel follows (authenticated)
	mux.Handle("GET /api/channel-follows", httpkit.Use(h.HandleChannelFollows, auth))
	mux.Handle("POST /api/channel-follows", httpkit.Use(h.HandleChannelFollows, auth))
	mux.Handle("DELETE /api/channel-follows", httpkit.Use(h.HandleChannelFollows, auth))

	// Notification preferences (authenticated)
	mux.Handle("GET /api/notification-preferences", httpkit.Use(h.HandleNotificationPreferences, auth))
	mux.Handle("PUT /api/notification-preferences", httpkit.Use(h.HandleNotificationPreferences, auth))

	// Forumline auth (IP-based rate limit on auth endpoints)
	mux.Handle("GET /api/forumline/auth", httpkit.Use(h.HandleForumlineAuth, authRL))
	mux.Handle("GET /api/forumline/auth/callback", httpkit.Use(h.HandleForumlineCallback, authRL))
	mux.Handle("POST /api/forumline/auth/token-exchange", httpkit.Use(h.HandleTokenExchange, authRL))
	mux.Handle("GET /api/forumline/auth/forumline-token", httpkit.Use(h.HandleForumlineToken, authRL))
	mux.HandleFunc("GET /api/forumline/auth/session", h.HandleForumlineSession)
	mux.HandleFunc("DELETE /api/forumline/auth/session", h.HandleForumlineSession)

	// Forumline notifications (authenticated)
	mux.Handle("GET /api/forumline/notifications", httpkit.Use(h.HandleNotifications, auth))
	mux.Handle("POST /api/forumline/notifications/read", httpkit.Use(h.HandleNotificationRead, auth))
	mux.Handle("GET /api/forumline/unread", httpkit.Use(h.HandleUnread, auth))
	mux.Handle("GET /api/forumline/notifications/stream", httpkit.Use(h.HandleNotificationStream, auth))

	// LiveKit (authenticated)
	mux.Handle("POST /api/livekit", httpkit.Use(h.HandleLiveKitToken, auth))
	mux.Handle("GET /api/livekit", httpkit.Use(h.HandleLiveKitParticipants, auth))

	// ================================================================
	// Data endpoints (Phase B)
	// ================================================================

	// Forum config (public)
	mux.HandleFunc("GET /api/config", h.HandleConfig)

	// Static/config (public)
	mux.HandleFunc("GET /api/categories", h.HandleCategories)
	mux.HandleFunc("GET /api/categories/{slug}", h.HandleCategoryBySlug)
	mux.HandleFunc("GET /api/channels", h.HandleChannels)
	mux.HandleFunc("GET /api/voice-rooms", h.HandleVoiceRooms)

	// Threads (public reads)
	mux.HandleFunc("GET /api/threads", h.HandleThreads)
	mux.HandleFunc("GET /api/threads/{id}", h.HandleThread)
	mux.HandleFunc("GET /api/categories/{slug}/threads", h.HandleThreadsByCategory)
	mux.HandleFunc("GET /api/users/{id}/threads", h.HandleUserThreads)
	mux.HandleFunc("GET /api/search/threads", h.HandleSearchThreads)

	// Posts (public reads + stream)
	mux.HandleFunc("GET /api/threads/{id}/posts", h.HandlePosts)
	mux.Handle("GET /api/threads/{id}/stream", httpkit.Use(h.HandlePostStream, auth))
	mux.HandleFunc("GET /api/users/{id}/posts", h.HandleUserPosts)
	mux.HandleFunc("GET /api/search/posts", h.HandleSearchPosts)

	// Profiles (public reads)
	mux.HandleFunc("GET /api/profiles/batch", h.HandleProfilesBatch)
	mux.HandleFunc("GET /api/profiles/by-username/{username}", h.HandleProfileByUsername)
	mux.HandleFunc("GET /api/profiles/{id}", h.HandleProfile)

	// Chat messages (public read)
	mux.HandleFunc("GET /api/channels/{slug}/messages", h.HandleChatMessages)

	// Voice presence (public read)
	mux.HandleFunc("GET /api/voice-presence", h.HandleVoicePresence)

	// Authenticated data endpoints (rate-limited writes)
	mux.Handle("POST /api/threads", httpkit.Use(h.HandleCreateThread, auth, writeRL))
	mux.Handle("PATCH /api/threads/{id}", httpkit.Use(h.HandleUpdateThread, auth, writeRL))
	mux.Handle("POST /api/posts", httpkit.Use(h.HandleCreatePost, auth, writeRL))
	mux.Handle("POST /api/channels/{slug}/messages", httpkit.Use(h.HandleSendChatMessage, auth, chatRL))
	mux.Handle("POST /api/channels/_by-id/{id}/messages", httpkit.Use(h.HandleSendChatMessageByID, auth, chatRL))
	mux.Handle("GET /api/channels/{slug}/stream", httpkit.Use(h.HandleChatStream, auth))
	mux.Handle("GET /api/bookmarks", httpkit.Use(h.HandleBookmarks, auth))
	mux.Handle("GET /api/bookmarks/{threadId}/status", httpkit.Use(h.HandleBookmarkStatus, auth))
	mux.Handle("POST /api/bookmarks", httpkit.Use(h.HandleAddBookmark, auth, writeRL))
	mux.Handle("DELETE /api/bookmarks/{threadId}", httpkit.Use(h.HandleRemoveBookmark, auth))
	mux.Handle("DELETE /api/bookmarks/by-id/{id}", httpkit.Use(h.HandleRemoveBookmarkByID, auth))
	mux.Handle("GET /api/notifications", httpkit.Use(h.HandleNotificationsData, auth))
	mux.Handle("POST /api/notifications/read-all", httpkit.Use(h.HandleMarkAllNotificationsRead, auth))
	mux.Handle("PUT /api/profiles/{id}", httpkit.Use(h.HandleUpsertProfile, auth, writeRL))
	mux.Handle("DELETE /api/profiles/{id}/forumline-id", httpkit.Use(h.HandleClearForumlineID, auth))
	mux.Handle("PUT /api/voice-presence", httpkit.Use(h.HandleSetVoicePresence, auth))
	mux.Handle("DELETE /api/voice-presence", httpkit.Use(h.HandleClearVoicePresence, auth))
	mux.Handle("GET /api/voice-presence/stream", httpkit.Use(h.HandleVoicePresenceStream, auth))
	mux.Handle("POST /api/avatars/upload", httpkit.Use(h.HandleAvatarUpload, auth, uploadRL))
	mux.Handle("GET /api/admin/stats", httpkit.Use(h.HandleAdminStats, auth))
	mux.Handle("GET /api/admin/users", httpkit.Use(h.HandleAdminUsers, auth))
	mux.Handle("POST /api/admin/import", httpkit.Use(h.HandleImport, auth, importRL))

	// Forumline manifest (discovery)
	mux.HandleFunc("GET /.well-known/forumline-manifest.json", h.HandleManifest)

	return mux
}
