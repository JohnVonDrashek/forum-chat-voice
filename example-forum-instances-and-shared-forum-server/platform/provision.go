package platform

import (
	"context"
	_ "embed"
	"fmt"
	"log"
	"regexp"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed schema_template.sql
var schemaTemplateSQL string

var validSlug = regexp.MustCompile(`^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$`)

// reserved slugs that can't be used as forum subdomains
var reservedSlugs = map[string]bool{
	"www": true, "app": true, "api": true, "demo": true,
	"admin": true, "mail": true, "smtp": true, "ftp": true,
	"ssh": true, "ns1": true, "ns2": true, "cdn": true,
	"forum-b": true, "status": true, "docs": true, "blog": true,
}

// ProvisionRequest is the input for creating a new hosted forum.
type ProvisionRequest struct {
	Slug             string // subdomain: "myforum" -> myforum.forumline.net
	Name             string // display name
	Description      string
	OwnerForumlineID string // forumline identity UUID of the creator
	BaseDomain       string // e.g. "forumline.net"
}

// ProvisionResult is returned after a forum is successfully created.
type ProvisionResult struct {
	Tenant *Tenant
	Domain string
}

// Provision creates a new hosted forum:
// 1. Validates the slug
// 2. Creates a PostgreSQL schema with forum tables
// 3. Inserts a row in platform_tenants
// 4. Refreshes the tenant store cache
func Provision(ctx context.Context, pool *pgxpool.Pool, store *TenantStore, req *ProvisionRequest) (*ProvisionResult, error) {
	// Validate slug
	if !validSlug.MatchString(req.Slug) {
		return nil, fmt.Errorf("invalid slug: must be 1-40 lowercase alphanumeric characters or hyphens, cannot start/end with hyphen")
	}
	if reservedSlugs[req.Slug] {
		return nil, fmt.Errorf("slug %q is reserved", req.Slug)
	}
	if store.BySlug(req.Slug) != nil {
		return nil, fmt.Errorf("slug %q is already taken", req.Slug)
	}

	schemaName := "forum_" + strings.ReplaceAll(req.Slug, "-", "_")
	domain := req.Slug + "." + req.BaseDomain

	// Create the schema and tables in a transaction
	tx, err := pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	// Create schema
	sanitized := pgx.Identifier{schemaName}.Sanitize()
	_, err = tx.Exec(ctx, fmt.Sprintf("CREATE SCHEMA %s", sanitized))
	if err != nil {
		return nil, fmt.Errorf("create schema %s: %w", schemaName, err)
	}

	// Set search_path and run the forum tables + triggers template
	_, err = tx.Exec(ctx, fmt.Sprintf("SET LOCAL search_path TO %s, public", sanitized))
	if err != nil {
		return nil, fmt.Errorf("set search_path: %w", err)
	}

	_, err = tx.Exec(ctx, schemaTemplateSQL)
	if err != nil {
		return nil, fmt.Errorf("create forum tables in %s: %w", schemaName, err)
	}

	// Insert tenant record (in public schema)
	_, err = tx.Exec(ctx, "SET LOCAL search_path TO public")
	if err != nil {
		return nil, fmt.Errorf("reset search_path: %w", err)
	}

	var tenantID string
	err = tx.QueryRow(ctx, `
		INSERT INTO platform_tenants (slug, name, schema_name, domain, owner_forumline_id, description)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id
	`, req.Slug, req.Name, schemaName, domain, req.OwnerForumlineID, req.Description).Scan(&tenantID)
	if err != nil {
		return nil, fmt.Errorf("insert tenant: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit: %w", err)
	}

	log.Printf("provisioned forum %q at %s (schema: %s)", req.Name, domain, schemaName)

	// Refresh tenant store so the new forum is immediately routable
	if err := store.refresh(ctx); err != nil {
		log.Printf("warning: tenant refresh after provision failed: %v", err)
	}

	tenant := store.BySlug(req.Slug)
	return &ProvisionResult{
		Tenant: tenant,
		Domain: domain,
	}, nil
}
