package presence

import (
	"context"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
	shared "github.com/forumline/forumline/shared-go"
)

// Tracker tracks which users are online via heartbeats.
// When a Valkey client is provided, presence state survives restarts and
// works across multiple server instances. Falls back to in-memory when
// Valkey is nil or unavailable.
type Tracker struct {
	valkey *redis.Client
	ttl    time.Duration

	// In-memory fallback (used when valkey is nil or on error)
	mu       sync.RWMutex
	lastSeen map[string]time.Time
}

func NewTracker(ttl time.Duration, valkey *redis.Client) *Tracker {
	pt := &Tracker{
		valkey:   valkey,
		ttl:      ttl,
		lastSeen: make(map[string]time.Time),
	}
	// Only run cleanup goroutine for in-memory mode
	if valkey == nil {
		go func() {
			ticker := time.NewTicker(5 * time.Minute)
			defer ticker.Stop()
			for range ticker.C {
				pt.cleanup()
			}
		}()
	}
	return pt
}

func (pt *Tracker) Touch(userID string) {
	if pt.valkey != nil {
		ctx := context.Background()
		key := shared.ValkeyKey("presence", userID)
		if err := pt.valkey.Set(ctx, key, "1", pt.ttl).Err(); err == nil {
			return
		}
		// Fall through to in-memory on error
	}
	pt.mu.Lock()
	pt.lastSeen[userID] = time.Now()
	pt.mu.Unlock()
}

func (pt *Tracker) OnlineStatusBatch(userIDs []string) map[string]bool {
	result := make(map[string]bool, len(userIDs))

	if pt.valkey != nil {
		ctx := context.Background()
		pipe := pt.valkey.Pipeline()
		cmds := make([]*redis.IntCmd, len(userIDs))
		for i, id := range userIDs {
			cmds[i] = pipe.Exists(ctx, shared.ValkeyKey("presence", id))
		}
		if _, err := pipe.Exec(ctx); err == nil {
			for i, id := range userIDs {
				result[id] = cmds[i].Val() > 0
			}
			return result
		}
		// Fall through to in-memory on error
	}

	pt.mu.RLock()
	defer pt.mu.RUnlock()
	now := time.Now()
	for _, id := range userIDs {
		t, ok := pt.lastSeen[id]
		result[id] = ok && now.Sub(t) < pt.ttl
	}
	return result
}

func (pt *Tracker) IsOnline(userID string) bool {
	if pt.valkey != nil {
		ctx := context.Background()
		key := shared.ValkeyKey("presence", userID)
		n, err := pt.valkey.Exists(ctx, key).Result()
		if err == nil {
			return n > 0
		}
		// Fall through to in-memory on error
	}
	pt.mu.RLock()
	defer pt.mu.RUnlock()
	t, ok := pt.lastSeen[userID]
	return ok && time.Since(t) < pt.ttl
}

func (pt *Tracker) cleanup() {
	pt.mu.Lock()
	defer pt.mu.Unlock()
	now := time.Now()
	for id, t := range pt.lastSeen {
		if now.Sub(t) >= pt.ttl {
			delete(pt.lastSeen, id)
		}
	}
}
