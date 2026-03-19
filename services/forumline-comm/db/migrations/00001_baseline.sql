-- +goose Up
-- Comm-owned tables only. The profiles/forums/memberships tables are owned by
-- the hub service and must already exist in the shared database.

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

-- +goose Down
DROP TABLE IF EXISTS forumline_notifications;
DROP TABLE IF EXISTS push_subscriptions;
DROP TABLE IF EXISTS forumline_direct_messages;
DROP TABLE IF EXISTS forumline_calls;
DROP TABLE IF EXISTS forumline_conversation_members;
DROP TABLE IF EXISTS forumline_conversations;
