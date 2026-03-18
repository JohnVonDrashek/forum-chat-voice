package forum

import (
	"github.com/forumline/forumline/backend/db"
	"github.com/forumline/forumline/backend/pubsub"
	"github.com/forumline/forumline/backend/sse"
	"github.com/redis/go-redis/v9"
)

// Config holds everything the forum engine needs to run.
// Both hosted (multi-tenant) and standalone (single-tenant) modes
// provide a Config — only the injected dependencies differ.
type Config struct {
	// --- Forum identity ---

	// SiteURL is the full public URL of this forum (e.g. "https://myforum.forumline.net").
	SiteURL string

	// Domain is the bare domain (e.g. "myforum.forumline.net").
	Domain string

	// ForumName is the display name shown in the UI and manifest.
	ForumName string

	// IconURL is the forum's icon/logo URL (optional).
	IconURL string

	// HostedMode is true when this forum runs as part of the Forumline
	// hosted platform. Affects the /api/config response and enables
	// Forumline-specific UI features in the frontend.
	HostedMode bool

	// Schema is the PostgreSQL schema name for this tenant (e.g. "forum_testforum").
	// Used to tag event payloads in multi-tenant mode. Empty for standalone.
	Schema string

	// --- Injected dependencies ---

	// Auth handles authentication and session management.
	// Hosted: ForumlineAuthProvider (via id.forumline.net)
	// Standalone: OIDCAuthProvider (direct OIDC with any provider)
	Auth AuthProvider

	// Storage handles file uploads (avatars, thread images).
	// Hosted: R2Storage (Cloudflare R2)
	// Standalone: LocalStorage, S3Storage, or NoopStorage
	Storage FileStorage

	// DB is the database connection. In single-tenant mode this is a
	// *pgxpool.Pool; in multi-tenant mode this is a TenantPool that
	// sets search_path per-request. The forum doesn't know or care.
	DB db.DB

	// SSEHub is the Server-Sent Events hub backed by Postgres LISTEN/NOTIFY.
	SSEHub *sse.Hub

	// ValkeyClient is the Redis-compatible client for rate limiting and caching.
	// If nil, rate limiting falls back to in-memory and caching is disabled.
	ValkeyClient *redis.Client

	// EventBus is the optional pub/sub bus for realtime events.
	// When set, events are published directly to NATS after successful DB
	// operations. When nil, PG LISTEN/NOTIFY triggers handle event delivery
	// (local dev fallback).
	EventBus pubsub.EventBus

	// --- Optional features ---

	// LiveKit holds voice room configuration. If nil, voice features are disabled.
	LiveKit *LiveKitConfig

	// --- Forumline network integration (optional) ---

	// ForumlineURL is the Forumline app URL for push notifications
	// (e.g. "https://app.forumline.net"). Empty disables notification push.
	ForumlineURL string

	// ForumlineServiceKey is the bearer token for authenticating webhook
	// pushes to the Forumline app. Empty disables notification push.
	ForumlineServiceKey string
}

// LiveKitConfig holds LiveKit server credentials for voice rooms.
type LiveKitConfig struct {
	URL       string
	APIKey    string
	APISecret string
}
