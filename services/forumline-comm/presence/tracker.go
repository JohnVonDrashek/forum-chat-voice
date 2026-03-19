package presence

import (
	"context"
	"sync"
	"time"

	"github.com/forumline/forumline/backend/valkey"
	"github.com/redis/go-redis/v9"
)

type Tracker struct {
	valkey *redis.Client
	ttl    time.Duration

	mu       sync.RWMutex
	lastSeen map[string]time.Time
}

func NewTracker(ttl time.Duration, valkey *redis.Client) *Tracker {
	pt := &Tracker{
		valkey:   valkey,
		ttl:      ttl,
		lastSeen: make(map[string]time.Time),
	}
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
		key := valkey.Key("presence", userID)
		if err := pt.valkey.Set(ctx, key, "1", pt.ttl).Err(); err == nil {
			return
		}
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
			cmds[i] = pipe.Exists(ctx, valkey.Key("presence", id))
		}
		if _, err := pipe.Exec(ctx); err == nil {
			for i, id := range userIDs {
				result[id] = cmds[i].Val() > 0
			}
			return result
		}
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
		key := valkey.Key("presence", userID)
		n, err := pt.valkey.Exists(ctx, key).Result()
		if err == nil {
			return n > 0
		}
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
