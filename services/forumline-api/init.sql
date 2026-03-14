-- ============================================================================
-- Forumline — Local Dev Seed
-- Runs AFTER GoTrue has created the auth schema and tables.
-- ============================================================================

-- Forumline user profiles (extends GoTrue auth.users)
CREATE TABLE IF NOT EXISTS forumline_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
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
  owner_id UUID REFERENCES forumline_profiles(id),
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
  user_id UUID NOT NULL REFERENCES forumline_profiles(id) ON DELETE CASCADE,
  forum_id UUID NOT NULL REFERENCES forumline_forums(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  notifications_muted BOOLEAN DEFAULT false NOT NULL,
  forum_authed_at TIMESTAMPTZ,
  UNIQUE(user_id, forum_id)
);

-- OAuth clients (forum credentials for OAuth flow)
CREATE TABLE IF NOT EXISTS forumline_oauth_clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  forum_id UUID NOT NULL REFERENCES forumline_forums(id) ON DELETE CASCADE,
  client_id TEXT UNIQUE NOT NULL,
  client_secret_hash TEXT NOT NULL,
  redirect_uris TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Ephemeral authorization codes (5-min TTL)
CREATE TABLE IF NOT EXISTS forumline_auth_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  user_id UUID NOT NULL REFERENCES forumline_profiles(id) ON DELETE CASCADE,
  forum_id UUID NOT NULL REFERENCES forumline_forums(id) ON DELETE CASCADE,
  redirect_uri TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used BOOLEAN DEFAULT false NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Conversations (1:1 and group chats)
CREATE TABLE IF NOT EXISTS forumline_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  is_group BOOLEAN NOT NULL DEFAULT false,
  name TEXT,
  created_by UUID REFERENCES forumline_profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Conversation members
CREATE TABLE IF NOT EXISTS forumline_conversation_members (
  conversation_id UUID NOT NULL REFERENCES forumline_conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES forumline_profiles(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_read_at TIMESTAMPTZ NOT NULL DEFAULT '1970-01-01',
  PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_convo_members_user ON forumline_conversation_members(user_id);

-- Direct messages (now linked to conversations)
CREATE TABLE IF NOT EXISTS forumline_direct_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES forumline_conversations(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES forumline_profiles(id) ON DELETE CASCADE,
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

DROP TRIGGER IF EXISTS update_forum_member_count_trigger ON forumline_memberships;
CREATE TRIGGER update_forum_member_count_trigger
  AFTER INSERT OR DELETE ON forumline_memberships
  FOR EACH ROW EXECUTE FUNCTION update_forum_member_count();

-- Push subscriptions
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES forumline_profiles(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, endpoint)
);

-- Auto-update updated_at timestamps
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

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

-- Auto-create forumline profile on signup
CREATE OR REPLACE FUNCTION handle_new_forumline_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.forumline_profiles (id, username, display_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'username', 'user_' || substr(NEW.id::text, 1, 8)),
    COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.raw_user_meta_data->>'username', 'New User')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_forumline_user();

-- LISTEN/NOTIFY triggers for SSE and push notifications
CREATE OR REPLACE FUNCTION notify_dm_changes() RETURNS TRIGGER AS $$
DECLARE
  member_ids UUID[];
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

DROP TRIGGER IF EXISTS dm_changes_notify ON forumline_direct_messages;
CREATE TRIGGER dm_changes_notify
  AFTER INSERT ON forumline_direct_messages
  FOR EACH ROW EXECUTE FUNCTION notify_dm_changes();

CREATE OR REPLACE FUNCTION notify_new_dm() RETURNS TRIGGER AS $$
DECLARE
  member_ids UUID[];
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

DROP TRIGGER IF EXISTS push_dm_notify ON forumline_direct_messages;
CREATE TRIGGER push_dm_notify
  AFTER INSERT ON forumline_direct_messages
  FOR EACH ROW EXECUTE FUNCTION notify_new_dm();

-- Notifications (pushed from forums)
CREATE TABLE IF NOT EXISTS forumline_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES forumline_profiles(id) ON DELETE CASCADE,
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

DROP TRIGGER IF EXISTS trg_forumline_notification_insert ON forumline_notifications;
CREATE TRIGGER trg_forumline_notification_insert
  AFTER INSERT ON forumline_notifications
  FOR EACH ROW
  EXECUTE FUNCTION notify_forumline_notification_insert();

-- ============================================================================
-- Seed Data
-- ============================================================================

-- Seed forum (demo.forumline.net)
INSERT INTO forumline_forums (id, domain, name, api_base, web_base, capabilities, description, approved)
VALUES (
  '1c529bf0-e59c-419d-9589-c38eae9512df',
  'demo.forumline.net',
  'Forumline Demo',
  'https://demo.forumline.net/api/forumline',
  'https://demo.forumline.net',
  '{"threads", "voice", "notifications"}',
  'Reference Forumline forum with real-time chat and voice rooms',
  true
) ON CONFLICT (id) DO NOTHING;

-- Seed OAuth client for the demo forum
INSERT INTO forumline_oauth_clients (forum_id, client_id, client_secret_hash, redirect_uris)
VALUES (
  '1c529bf0-e59c-419d-9589-c38eae9512df',
  'local-test-client-id',
  -- SHA-256 of 'local-test-client-secret'
  '784879ba905b499313877b01857dd63f7748aaac45c84b33971f23086d4cbe8f',
  ARRAY['http://localhost:5173/api/forumline/auth/callback']
) ON CONFLICT (client_id) DO NOTHING;

-- Platform entry for forumline.net website (needed for OAuth client registration)
INSERT INTO forumline_forums (id, domain, name, api_base, web_base, capabilities, description, approved)
VALUES (
  'a0000000-0000-0000-0000-000000000001',
  'forumline.net',
  'Forumline Platform',
  'https://forumline.net',
  'https://forumline.net',
  '{}',
  'Forumline platform website — used for forum creation OAuth flow',
  true
) ON CONFLICT (id) DO NOTHING;

-- OAuth client for the forumline.net website (forum creation flow)
INSERT INTO forumline_oauth_clients (forum_id, client_id, client_secret_hash, redirect_uris)
VALUES (
  'a0000000-0000-0000-0000-000000000001',
  'forumline-website',
  -- SHA-256 of 'forumline-website-secret'
  'c382ee3932b637301c6ad0b75fadd1f59fddddd2078c83bb9b53402df06512c5',
  ARRAY['https://forumline.net/create-callback.html', 'http://localhost:8765/create-callback.html']
) ON CONFLICT (client_id) DO NOTHING;

SELECT 'Init complete: tables created, seed data inserted.' AS status;
