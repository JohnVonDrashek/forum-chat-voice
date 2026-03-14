package shared

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// DB is the interface that both *pgxpool.Pool and TenantPool satisfy.
// Handlers use this instead of *pgxpool.Pool directly so they work in
// both single-tenant and multi-tenant modes without code changes.
type DB interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
}

func NewDBPool(ctx context.Context) (*pgxpool.Pool, error) {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		return nil, fmt.Errorf("DATABASE_URL is not set")
	}

	config, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		return nil, fmt.Errorf("parse DATABASE_URL: %w", err)
	}

	// Keep one connection alive to avoid cold-start latency
	config.MinConns = 1
	// LISTEN connections use direct pgx.Conn (not from pool), so pool
	// only needs enough connections for concurrent API queries.
	// In multi-tenant hosted mode, SSE streams may briefly acquire
	// connections for per-event queries, so allow headroom.
	maxConns := int32(20)
	if v := os.Getenv("DB_MAX_CONNS"); v != "" {
		if n, err := fmt.Sscanf(v, "%d", &maxConns); n == 1 && err == nil && maxConns > 0 {
			// use parsed value
		} else {
			maxConns = 5
		}
	}
	config.MaxConns = maxConns
	// Recycle connections before Fly's proxy can kill them
	config.MaxConnLifetime = 10 * time.Minute
	config.MaxConnIdleTime = 2 * time.Minute
	// Frequent health checks to detect dead connections quickly
	config.HealthCheckPeriod = 15 * time.Second

	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		return nil, fmt.Errorf("connect to database: %w", err)
	}

	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping database: %w", err)
	}

	return pool, nil
}

// LogIfErr executes fn and logs any error. Use for non-blocking side effects
// that shouldn't fail the HTTP response but must be observable.
func LogIfErr(ctx context.Context, label string, fn func() error) {
	if err := fn(); err != nil {
		slog.ErrorContext(ctx, label, "err", err)
	}
}
