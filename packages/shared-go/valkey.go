package shared

import (
	"context"
	"fmt"
	"log/slog"
	"os"

	"github.com/redis/go-redis/v9"
)

// ValkeyPrefix namespaces all Forumline keys in Valkey to avoid collisions.
const ValkeyPrefix = "fl:"

// NewValkeyClient creates a Valkey (Redis-compatible) client from the VALKEY_URL
// environment variable. Returns nil if VALKEY_URL is not set — callers must
// handle nil gracefully (fall back to in-memory).
func NewValkeyClient(ctx context.Context) *redis.Client {
	addr := os.Getenv("VALKEY_URL")
	if addr == "" {
		slog.Info("VALKEY_URL not set, Valkey caching disabled")
		return nil
	}

	client := redis.NewClient(&redis.Options{
		Addr:     addr,
		PoolSize: 10,
	})

	if err := client.Ping(ctx).Err(); err != nil {
		slog.Warn("Valkey ping failed, caching disabled", "addr", addr, "err", err)
		_ = client.Close()
		return nil
	}

	slog.Info("Valkey connected", "addr", addr)
	return client
}

// ValkeyKey builds a namespaced key: "fl:{parts[0]}:{parts[1]}:..."
func ValkeyKey(parts ...string) string {
	key := ValkeyPrefix
	for i, p := range parts {
		if i > 0 {
			key += ":"
		}
		key += p
	}
	return key
}

// ValkeyHealthy returns true if the client is non-nil and responds to PING.
func ValkeyHealthy(ctx context.Context, client *redis.Client) bool {
	if client == nil {
		return false
	}
	return client.Ping(ctx).Err() == nil
}

// CloseValkey safely closes a Valkey client (nil-safe).
func CloseValkey(client *redis.Client) {
	if client != nil {
		if err := client.Close(); err != nil {
			slog.Warn("Valkey close error", "err", err)
		}
	}
}

// ValkeyInfo logs the Valkey server info for diagnostics.
func ValkeyInfo(ctx context.Context, client *redis.Client) {
	if client == nil {
		return
	}
	info, err := client.Info(ctx, "server").Result()
	if err != nil {
		slog.Warn("Valkey INFO failed", "err", err)
		return
	}
	_ = info // logged at debug level if needed
	mem, err := client.Info(ctx, "memory").Result()
	if err == nil {
		_ = mem
	}
	fmt.Fprintf(os.Stderr, "Valkey: connected and healthy\n")
}
