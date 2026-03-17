package platform

import (
	"context"
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Tenant holds the configuration for a single hosted forum.
type Tenant struct {
	ID               string
	Slug             string
	Name             string
	SchemaName       string
	Domain           string
	OwnerForumlineID string
	Description      string
	IconURL          string
	Theme            string
	Active           bool
	HasCustomSite    bool
	SiteStorageBytes int64
	SiteStorageLimit int64
}

// TenantStore caches tenant configs in memory and refreshes from the database
// periodically. Lookups are by domain (from Host header).
type TenantStore struct {
	pool *pgxpool.Pool

	mu        sync.RWMutex
	byDomain  map[string]*Tenant
	bySlug    map[string]*Tenant
}

func NewTenantStore(pool *pgxpool.Pool) *TenantStore {
	return &TenantStore{
		pool:     pool,
		byDomain: make(map[string]*Tenant),
		bySlug:   make(map[string]*Tenant),
	}
}

// Start loads tenants immediately and refreshes every 30 seconds.
func (ts *TenantStore) Start(ctx context.Context) error {
	if err := ts.refresh(ctx); err != nil {
		return fmt.Errorf("initial tenant load: %w", err)
	}

	go func() {
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if err := ts.refresh(ctx); err != nil {
					log.Printf("tenant refresh error: %v", err)
				}
			}
		}
	}()

	return nil
}

func (ts *TenantStore) refresh(ctx context.Context) error {
	rows, err := ts.pool.Query(ctx, `
		SELECT id, slug, name, schema_name, domain, owner_forumline_id,
		       COALESCE(description, ''), COALESCE(icon_url, ''),
		       theme, active,
		       has_custom_site, site_storage_bytes, site_storage_limit
		FROM platform_tenants
		WHERE active = true
	`)
	if err != nil {
		return err
	}
	defer rows.Close()

	byDomain := make(map[string]*Tenant)
	bySlug := make(map[string]*Tenant)
	for rows.Next() {
		t := &Tenant{}
		if err := rows.Scan(
			&t.ID, &t.Slug, &t.Name, &t.SchemaName, &t.Domain,
			&t.OwnerForumlineID, &t.Description, &t.IconURL,
			&t.Theme, &t.Active,
			&t.HasCustomSite, &t.SiteStorageBytes, &t.SiteStorageLimit,
		); err != nil {
			return fmt.Errorf("scan tenant: %w", err)
		}
		byDomain[t.Domain] = t
		bySlug[t.Slug] = t
	}

	ts.mu.Lock()
	ts.byDomain = byDomain
	ts.bySlug = bySlug
	ts.mu.Unlock()

	log.Printf("tenant store: loaded %d active tenants", len(byDomain))
	return nil
}

// Refresh forces an immediate reload of tenants from the database.
func (ts *TenantStore) Refresh(ctx context.Context) error {
	return ts.refresh(ctx)
}

// ByDomain returns the tenant for the given domain, or nil if not found.
func (ts *TenantStore) ByDomain(domain string) *Tenant {
	ts.mu.RLock()
	defer ts.mu.RUnlock()
	return ts.byDomain[domain]
}

// BySlug returns the tenant for the given slug, or nil if not found.
func (ts *TenantStore) BySlug(slug string) *Tenant {
	ts.mu.RLock()
	defer ts.mu.RUnlock()
	return ts.bySlug[slug]
}

// All returns all active tenants.
func (ts *TenantStore) All() []*Tenant {
	ts.mu.RLock()
	defer ts.mu.RUnlock()
	tenants := make([]*Tenant, 0, len(ts.byDomain))
	for _, t := range ts.byDomain {
		tenants = append(tenants, t)
	}
	return tenants
}
