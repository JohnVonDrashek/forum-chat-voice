-- +goose Up
-- Hub baseline: profiles, forums, memberships.
-- Uses IF NOT EXISTS so it's safe to run on the shared database that
-- already has these tables from forumline-api.

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

CREATE INDEX IF NOT EXISTS idx_forumline_memberships_user_id ON forumline_memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_forumline_memberships_forum_id ON forumline_memberships(forum_id);
CREATE INDEX IF NOT EXISTS idx_forumline_forums_owner_id ON forumline_forums(owner_id);

CREATE INDEX IF NOT EXISTS idx_forumline_forums_approved ON forumline_forums(approved) WHERE approved = true;
CREATE INDEX IF NOT EXISTS idx_forumline_forums_tags ON forumline_forums USING GIN(tags) WHERE approved = true;
CREATE INDEX IF NOT EXISTS idx_forumline_forums_member_count ON forumline_forums(member_count DESC) WHERE approved = true;
CREATE INDEX IF NOT EXISTS idx_forumline_forums_health_probe ON forumline_forums(last_seen_at NULLS FIRST) WHERE approved = true;

-- Keep member_count in sync with memberships
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION update_forum_member_count() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE forumline_forums SET member_count = member_count + 1 WHERE id = NEW.forum_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE forumline_forums SET member_count = GREATEST(member_count - 1, 0) WHERE id = OLD.forum_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

DROP TRIGGER IF EXISTS update_forum_member_count_trigger ON forumline_memberships;
CREATE TRIGGER update_forum_member_count_trigger
  AFTER INSERT OR DELETE ON forumline_memberships
  FOR EACH ROW EXECUTE FUNCTION update_forum_member_count();

-- Auto-update updated_at timestamps
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

DROP TRIGGER IF EXISTS forumline_profiles_updated_at ON forumline_profiles;
CREATE TRIGGER forumline_profiles_updated_at
  BEFORE UPDATE ON forumline_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS forumline_forums_updated_at ON forumline_forums;
CREATE TRIGGER forumline_forums_updated_at
  BEFORE UPDATE ON forumline_forums
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- +goose Down
-- Intentionally empty: dropping the entire schema requires manual intervention.
