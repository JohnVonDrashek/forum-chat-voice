package db

import (
	"embed"
	"io/fs"
	"log"
)

//go:embed migrations/*.sql
var embedFS embed.FS

//go:embed tenant_migrations/*.sql
var tenantEmbedFS embed.FS

// Migrations is an fs.FS for platform schema migrations (public schema).
var Migrations fs.FS

// TenantMigrations is an fs.FS for per-tenant schema migrations.
var TenantMigrations fs.FS

func init() {
	var err error
	Migrations, err = fs.Sub(embedFS, "migrations")
	if err != nil {
		log.Fatalf("failed to create migrations sub-FS: %v", err)
	}
	TenantMigrations, err = fs.Sub(tenantEmbedFS, "tenant_migrations")
	if err != nil {
		log.Fatalf("failed to create tenant migrations sub-FS: %v", err)
	}
}
