package presence

import (
	"sync"
	"time"
)

// Tracker tracks which users are online via heartbeats.
type Tracker struct {
	mu       sync.RWMutex
	lastSeen map[string]time.Time
	ttl      time.Duration
}

func NewTracker(ttl time.Duration) *Tracker {
	pt := &Tracker{
		lastSeen: make(map[string]time.Time),
		ttl:      ttl,
	}
	go func() {
		ticker := time.NewTicker(5 * time.Minute)
		defer ticker.Stop()
		for range ticker.C {
			pt.cleanup()
		}
	}()
	return pt
}

func (pt *Tracker) Touch(userID string) {
	pt.mu.Lock()
	pt.lastSeen[userID] = time.Now()
	pt.mu.Unlock()
}

func (pt *Tracker) OnlineStatusBatch(userIDs []string) map[string]bool {
	pt.mu.RLock()
	defer pt.mu.RUnlock()
	now := time.Now()
	result := make(map[string]bool, len(userIDs))
	for _, id := range userIDs {
		t, ok := pt.lastSeen[id]
		result[id] = ok && now.Sub(t) < pt.ttl
	}
	return result
}

func (pt *Tracker) IsOnline(userID string) bool {
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
