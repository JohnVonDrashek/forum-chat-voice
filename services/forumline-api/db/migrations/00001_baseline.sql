-- +goose Up
-- Baseline schema: represents the complete forumline-api schema as of
-- migration 006 (Zitadel). On existing databases this is a no-op thanks
-- to IF NOT EXISTS / IF EXISTS guards. On fresh databases it creates
-- everything from scratch.

-- Forumline user profiles (linked to Zitadel user IDs)
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

-- Forum registry
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

-- User forum memberships
CREATE TABLE IF NOT EXISTS forumline_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES forumline_profiles(id) ON DELETE CASCADE,
  forum_id UUID NOT NULL REFERENCES forumline_forums(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  notifications_muted BOOLEAN DEFAULT false NOT NULL,
  forum_authed_at TIMESTAMPTZ,
  UNIQUE(user_id, forum_id)
);

-- Conversations (1:1 and group chats)
CREATE TABLE IF NOT EXISTS forumline_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  is_group BOOLEAN NOT NULL DEFAULT false,
  name TEXT,
  created_by TEXT REFERENCES forumline_profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Conversation members
CREATE TABLE IF NOT EXISTS forumline_conversation_members (
  conversation_id UUID NOT NULL REFERENCES forumline_conversations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES forumline_profiles(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_read_at TIMESTAMPTZ NOT NULL DEFAULT '1970-01-01',
  PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_convo_members_user ON forumline_conversation_members(user_id);

-- Voice/video calls (1:1, via LiveKit)
CREATE TABLE IF NOT EXISTS forumline_calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES forumline_conversations(id) ON DELETE CASCADE,
  caller_id TEXT NOT NULL REFERENCES forumline_profiles(id) ON DELETE CASCADE,
  callee_id TEXT NOT NULL REFERENCES forumline_profiles(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'ringing',
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  duration_seconds INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_forumline_calls_conversation ON forumline_calls(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_forumline_calls_active ON forumline_calls(status) WHERE status IN ('ringing', 'active');

-- Direct messages (linked to conversations)
CREATE TABLE IF NOT EXISTS forumline_direct_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES forumline_conversations(id) ON DELETE CASCADE,
  sender_id TEXT NOT NULL REFERENCES forumline_profiles(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_forumline_dms_conversation ON forumline_direct_messages(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_forumline_dms_sender ON forumline_direct_messages(sender_id);

-- Performance indexes for memberships and forum ownership lookups
CREATE INDEX IF NOT EXISTS idx_forumline_memberships_user_id ON forumline_memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_forumline_memberships_forum_id ON forumline_memberships(forum_id);
CREATE INDEX IF NOT EXISTS idx_forumline_forums_owner_id ON forumline_forums(owner_id);

-- Forum discovery indexes
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

-- Push subscriptions
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES forumline_profiles(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, endpoint)
);

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

DROP TRIGGER IF EXISTS forumline_conversations_updated_at ON forumline_conversations;
CREATE TRIGGER forumline_conversations_updated_at
  BEFORE UPDATE ON forumline_conversations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- LISTEN/NOTIFY triggers for SSE and push notifications
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION notify_dm_changes() RETURNS TRIGGER AS $$
DECLARE
  member_ids TEXT[];
BEGIN
  SELECT array_agg(user_id) INTO member_ids
  FROM forumline_conversation_members
  WHERE conversation_id = NEW.conversation_id;

  PERFORM pg_notify('dm_changes', json_build_object(
    'conversation_id', NEW.conversation_id,
    'sender_id', NEW.sender_id,
    'member_ids', member_ids,
    'id', NEW.id,
    'content', NEW.content,
    'created_at', NEW.created_at
  )::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

DROP TRIGGER IF EXISTS dm_changes_notify ON forumline_direct_messages;
CREATE TRIGGER dm_changes_notify
  AFTER INSERT ON forumline_direct_messages
  FOR EACH ROW EXECUTE FUNCTION notify_dm_changes();

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION notify_new_dm() RETURNS TRIGGER AS $$
DECLARE
  member_ids TEXT[];
BEGIN
  SELECT array_agg(user_id) INTO member_ids
  FROM forumline_conversation_members
  WHERE conversation_id = NEW.conversation_id;

  PERFORM pg_notify('push_dm', json_build_object(
    'conversation_id', NEW.conversation_id,
    'sender_id', NEW.sender_id,
    'member_ids', member_ids,
    'content', NEW.content
  )::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

DROP TRIGGER IF EXISTS push_dm_notify ON forumline_direct_messages;
CREATE TRIGGER push_dm_notify
  AFTER INSERT ON forumline_direct_messages
  FOR EACH ROW EXECUTE FUNCTION notify_new_dm();

-- Notifications (pushed from forums)
CREATE TABLE IF NOT EXISTS forumline_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES forumline_profiles(id) ON DELETE CASCADE,
  forum_domain TEXT NOT NULL,
  forum_name TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  link TEXT NOT NULL DEFAULT '/',
  read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_forumline_notifs_user_unread
  ON forumline_notifications(user_id, created_at DESC) WHERE read = false;
CREATE INDEX IF NOT EXISTS idx_forumline_notifs_user_all
  ON forumline_notifications(user_id, created_at DESC);

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION notify_forumline_notification_insert()
RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('forumline_notification_changes', json_build_object(
    'id', NEW.id,
    'user_id', NEW.user_id,
    'forum_domain', NEW.forum_domain,
    'forum_name', NEW.forum_name,
    'type', NEW.type,
    'title', NEW.title,
    'body', NEW.body,
    'link', NEW.link,
    'read', NEW.read,
    'created_at', NEW.created_at
  )::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

DROP TRIGGER IF EXISTS trg_forumline_notification_insert ON forumline_notifications;
CREATE TRIGGER trg_forumline_notification_insert
  AFTER INSERT ON forumline_notifications
  FOR EACH ROW
  EXECUTE FUNCTION notify_forumline_notification_insert();

-- +goose Down
-- Intentionally empty: dropping the entire schema requires manual intervention.
-- Use pg_dump for backups before any destructive operations.
