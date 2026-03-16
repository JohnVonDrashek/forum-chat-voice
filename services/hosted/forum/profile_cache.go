package forum

import (
	"context"
	"encoding/json"
	"time"

	"github.com/forumline/forumline/services/hosted/forum/model"
	"github.com/forumline/forumline/services/hosted/forum/store"
	"github.com/redis/go-redis/v9"
	shared "github.com/forumline/forumline/shared-go"
)

// ProfileCache caches forum profile lookups in Valkey to avoid per-event
// database queries in SSE handlers. Falls back to direct DB queries when
// Valkey is nil or unavailable.
type ProfileCache struct {
	client *redis.Client
	db     shared.DB
	ttl    time.Duration
}

// NewProfileCache creates a profile cache. client may be nil for DB-only mode.
func NewProfileCache(client *redis.Client, db shared.DB, ttl time.Duration) *ProfileCache {
	return &ProfileCache{client: client, db: db, ttl: ttl}
}

// Get returns a profile by ID, checking Valkey first. The schema parameter
// is used to namespace cache keys per-tenant (since profiles live in
// tenant-specific schemas).
func (pc *ProfileCache) Get(ctx context.Context, schema, authorID string) (model.Profile, error) {
	if pc.client != nil {
		key := shared.ValkeyKey("profile", schema, authorID)
		data, err := pc.client.Get(ctx, key).Bytes()
		if err == nil {
			var p model.Profile
			if json.Unmarshal(data, &p) == nil {
				return p, nil
			}
		}
		// Cache miss or error — fall through to DB
	}

	// Query from database
	row := pc.db.QueryRow(ctx,
		`SELECT `+store.ProfileColumns()+` FROM profiles WHERE id = $1`, authorID)
	p, err := store.ScanProfile(row.Scan)
	if err != nil {
		return p, err
	}

	// Cache the result in Valkey (best-effort, don't fail if cache write fails)
	if pc.client != nil {
		key := shared.ValkeyKey("profile", schema, authorID)
		if data, err := json.Marshal(p); err == nil {
			pc.client.Set(ctx, key, data, pc.ttl)
		}
	}

	return p, nil
}
