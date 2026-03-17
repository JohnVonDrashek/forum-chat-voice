package db

import (
	"context"
	"database/sql"
	"fmt"
	"io/fs"
	"log"
	"net/url"

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

// RunTenantMigrations applies goose migrations to every tenant schema.
// Each tenant gets its own goose_db_version table inside its schema.
//
// schemas is the list of PostgreSQL schema names (e.g. "forum_testforum").
// The DSN is modified per-tenant to set search_path so goose operates
// within the correct schema.
func RunTenantMigrations(ctx context.Context, dsn string, migrations fs.FS, schemas []string) error {
	if len(schemas) == 0 {
		log.Println("tenant migrations: no tenants to migrate")
		return nil
	}

	var applied, upToDate int
	for _, schema := range schemas {
		tenantDSN, err := dsnWithSearchPath(dsn, schema)
		if err != nil {
			return fmt.Errorf("build DSN for schema %s: %w", schema, err)
		}

		db, err := sql.Open("pgx", tenantDSN)
		if err != nil {
			return fmt.Errorf("open db for schema %s: %w", schema, err)
		}

		provider, err := goose.NewProvider(goose.DialectPostgres, db, migrations)
		if err != nil {
			_ = db.Close()
			return fmt.Errorf("create goose provider for schema %s: %w", schema, err)
		}

		results, err := provider.Up(ctx)
		_ = db.Close()
		if err != nil {
			return fmt.Errorf("run migrations for schema %s: %w", schema, err)
		}

		if len(results) == 0 {
			upToDate++
		}
		for _, r := range results {
			applied++
			log.Printf("tenant migrations [%s]: applied %s (%s)", schema, r.Source.Path, r.Duration.Round(1e6))
		}
	}

	if applied == 0 {
		log.Printf("tenant migrations: all %d tenants up to date", upToDate)
	} else {
		log.Printf("tenant migrations: applied %d migration(s) across %d tenant(s)", applied, len(schemas)-upToDate)
	}

	return nil
}

// RunTenantMigration runs goose migrations for a single tenant schema.
// Used after provisioning a new tenant to immediately apply any migrations.
func RunTenantMigration(ctx context.Context, dsn string, migrations fs.FS, schema string) error {
	return RunTenantMigrations(ctx, dsn, migrations, []string{schema})
}

// dsnWithSearchPath modifies a PostgreSQL DSN to set the search_path
// connection parameter, so all queries (including goose's version table)
// operate within the specified schema.
func dsnWithSearchPath(dsn, schema string) (string, error) {
	u, err := url.Parse(dsn)
	if err != nil {
		return "", fmt.Errorf("parse DSN: %w", err)
	}
	q := u.Query()
	q.Set("search_path", schema+",public")
	u.RawQuery = q.Encode()
	return u.String(), nil
}
