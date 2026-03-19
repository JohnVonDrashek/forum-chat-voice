-- sqlc schema for forumline-comm service.
-- Includes comm-owned tables + profiles READ-ONLY (owned by hub).

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

CREATE TABLE IF NOT EXISTS forumline_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  is_group BOOLEAN NOT NULL DEFAULT false,
  name TEXT,
  created_by TEXT REFERENCES forumline_profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS forumline_conversation_members (
  conversation_id UUID NOT NULL REFERENCES forumline_conversations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES forumline_profiles(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_read_at TIMESTAMPTZ NOT NULL DEFAULT '1970-01-01',
  PRIMARY KEY (conversation_id, user_id)
);

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

CREATE TABLE IF NOT EXISTS forumline_direct_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES forumline_conversations(id) ON DELETE CASCADE,
  sender_id TEXT NOT NULL REFERENCES forumline_profiles(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES forumline_profiles(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, endpoint)
);

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
