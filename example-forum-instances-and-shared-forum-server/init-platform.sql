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

SELECT 'Platform tables created!' AS status;
