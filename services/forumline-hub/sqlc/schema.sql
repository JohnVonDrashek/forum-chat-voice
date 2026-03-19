-- sqlc schema: hub tables only (profiles, forums, memberships)
-- This file is the source of truth for sqlc code generation.

CREATE TABLE IF NOT EXISTS forumline_profiles (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  avatar_url TEXT,
  bio TEXT,
  status_message TEXT DEFAULT '' NOT NULL,
  online_status TEXT DEFAULT 'online' NOT NULL,
  show_online_status BOOLEAN DEFAULT true NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS forumline_forums (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  icon_url TEXT,
  api_base TEXT NOT NULL,
  web_base TEXT NOT NULL,
  capabilities TEXT[] DEFAULT '{}',
  description TEXT,
  owner_id TEXT REFERENCES forumline_profiles(id),
  approved BOOLEAN DEFAULT false NOT NULL,
  screenshot_url TEXT,
  tags TEXT[] DEFAULT '{}',
  member_count INTEGER DEFAULT 0 NOT NULL CHECK (member_count >= 0),
  last_seen_at TIMESTAMPTZ,
  consecutive_failures INTEGER DEFAULT 0 NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS forumline_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES forumline_profiles(id) ON DELETE CASCADE,
  forum_id UUID NOT NULL REFERENCES forumline_forums(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  notifications_muted BOOLEAN DEFAULT false NOT NULL,
  forum_authed_at TIMESTAMPTZ,
  UNIQUE(user_id, forum_id)
);
