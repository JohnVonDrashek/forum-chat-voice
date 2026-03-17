-- +goose Up
-- Baseline schema: represents the complete hosted platform schema.
-- On existing databases this is a no-op thanks to IF NOT EXISTS / IF EXISTS guards.
--
-- NOTE: Citus extension setup (CREATE EXTENSION, ALTER SYSTEM) requires
-- superuser and is handled by init-platform.sql via Docker entrypoint.
-- Goose only manages the table schema.

-- Platform metadata for multi-tenant hosted forums
CREATE TABLE IF NOT EXISTS platform_tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  schema_name TEXT NOT NULL UNIQUE,
  domain TEXT NOT NULL UNIQUE,
  owner_forumline_id TEXT NOT NULL,
  description TEXT,
  icon_url TEXT,
  theme TEXT NOT NULL DEFAULT 'default',
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
ALTER TABLE platform_tenants ADD COLUMN IF NOT EXISTS site_storage_limit BIGINT NOT NULL DEFAULT 52428800;

-- Drop legacy auth columns (safe: nullable and unused)
ALTER TABLE platform_tenants DROP COLUMN IF EXISTS forumline_client_id;
ALTER TABLE platform_tenants DROP COLUMN IF EXISTS forumline_client_secret;
ALTER TABLE platform_tenants DROP COLUMN IF EXISTS zitadel_client_id;
ALTER TABLE platform_tenants DROP COLUMN IF EXISTS zitadel_client_secret;

-- +goose Down
-- Intentionally empty: dropping platform tables requires manual intervention.
