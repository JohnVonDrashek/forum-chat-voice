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

-- Direct messages
CREATE TABLE IF NOT EXISTS forumline_direct_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id UUID NOT NULL REFERENCES forumline_profiles(id) ON DELETE CASCADE,
  recipient_id UUID NOT NULL REFERENCES forumline_profiles(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT sender_not_recipient CHECK (sender_id != recipient_id)
);

CREATE INDEX IF NOT EXISTS idx_forumline_dms_sender ON forumline_direct_messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_forumline_dms_recipient ON forumline_direct_messages(recipient_id);
CREATE INDEX IF NOT EXISTS idx_forumline_dms_conversation ON forumline_direct_messages(
  least(sender_id, recipient_id),
  greatest(sender_id, recipient_id),
  created_at DESC
);
CREATE INDEX IF NOT EXISTS idx_forumline_dms_unread ON forumline_direct_messages(recipient_id, read)
  WHERE read = false;

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
BEGIN
  PERFORM pg_notify('dm_changes', json_build_object(
    'sender_id', NEW.sender_id,
    'recipient_id', NEW.recipient_id,
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
BEGIN
  PERFORM pg_notify('push_dm', json_build_object(
    'recipient_id', NEW.recipient_id,
    'sender_id', NEW.sender_id,
    'content', NEW.content
  )::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS push_dm_notify ON forumline_direct_messages;
CREATE TRIGGER push_dm_notify
  AFTER INSERT ON forumline_direct_messages
  FOR EACH ROW EXECUTE FUNCTION notify_new_dm();

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

SELECT 'Init complete: tables created, seed data inserted.' AS status;
