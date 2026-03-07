package shared

import (
	"context"
	"fmt"
	"os"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

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
	config.MaxConns = 5
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
