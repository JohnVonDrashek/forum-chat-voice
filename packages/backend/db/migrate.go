package db

import (
	"context"
	"database/sql"
	"fmt"
	"io/fs"
	"log"

	"github.com/pressly/goose/v3"

	// database/sql driver for goose (pgx pool uses its own driver,
	// but goose needs the standard database/sql interface)
	_ "github.com/jackc/pgx/v5/stdlib"
)

// RunMigrations applies all pending goose migrations from the embedded filesystem.
// Call this on startup before starting the HTTP server.
//
// dsn is the PostgreSQL connection string (DATABASE_URL).
// migrations is an fs.FS rooted at the directory containing migration SQL files.
func RunMigrations(ctx context.Context, dsn string, migrations fs.FS) error {
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		return fmt.Errorf("open db for migrations: %w", err)
	}
	defer func() { _ = db.Close() }()

	provider, err := goose.NewProvider(goose.DialectPostgres, db, migrations)
	if err != nil {
		return fmt.Errorf("create goose provider: %w", err)
	}

	results, err := provider.Up(ctx)
	if err != nil {
		return fmt.Errorf("run migrations: %w", err)
	}

	if len(results) == 0 {
		log.Println("migrations: already up to date")
	}
	for _, r := range results {
		log.Printf("migrations: applied %s (%s)", r.Source.Path, r.Duration.Round(1e6))
	}

	return nil
}
