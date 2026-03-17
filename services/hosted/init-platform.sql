-- Citus extension — enables distributed PostgreSQL for horizontal scaling.
-- Schema-based sharding distributes tenant schemas across worker nodes
-- transparently; all existing queries, search_path routing, and triggers
-- continue to work unchanged.
CREATE EXTENSION IF NOT EXISTS citus;

-- Enable schema-based sharding persistently (writes to postgresql.auto.conf).
-- New schemas are automatically distributed across Citus worker nodes.
ALTER SYSTEM SET citus.enable_schema_based_sharding = on;
SELECT pg_reload_conf();

-- Platform metadata for multi-tenant hosted forums.
-- This schema lives in the 'public' search_path of the shared database.
-- Each hosted forum gets its own schema (forum_{slug}) with the standard
-- forum tables (see init-forum-tables.sql).

CREATE TABLE IF NOT EXISTS platform_tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,             -- subdomain: "myforum" -> myforum.forumline.net
  name TEXT NOT NULL,                    -- display name
  schema_name TEXT NOT NULL UNIQUE,      -- postgres schema: "forum_myforum"
  domain TEXT NOT NULL UNIQUE,           -- full domain: "myforum.forumline.net"
  owner_forumline_id TEXT NOT NULL,      -- forumline identity UUID of the creator
  description TEXT,
  icon_url TEXT,
  theme TEXT NOT NULL DEFAULT 'default', -- frontend theme
  -- forumline federation credentials (returned from central identity service)
  forumline_client_id TEXT,
  forumline_client_secret TEXT,
  -- status
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_tenants_domain ON platform_tenants(domain);
CREATE INDEX IF NOT EXISTS idx_platform_tenants_slug ON platform_tenants(slug);
CREATE INDEX IF NOT EXISTS idx_platform_tenants_owner ON platform_tenants(owner_forumline_id);
CREATE INDEX IF NOT EXISTS idx_platform_tenants_active ON platform_tenants(active) WHERE active = true;

-- Custom frontend storage
ALTER TABLE platform_tenants ADD COLUMN IF NOT EXISTS has_custom_site BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE platform_tenants ADD COLUMN IF NOT EXISTS site_storage_bytes BIGINT NOT NULL DEFAULT 0;
ALTER TABLE platform_tenants ADD COLUMN IF NOT EXISTS site_storage_limit BIGINT NOT NULL DEFAULT 52428800; -- 50MB

-- Auth is now handled by id.forumline.net — per-forum OAuth credentials are no longer needed.
-- Drop the legacy columns (safe: they were nullable and are no longer read by the app).
ALTER TABLE platform_tenants DROP COLUMN IF EXISTS forumline_client_id;
ALTER TABLE platform_tenants DROP COLUMN IF EXISTS forumline_client_secret;

SELECT 'Platform tables created!' AS status;
