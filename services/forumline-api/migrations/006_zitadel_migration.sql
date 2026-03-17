-- Migration: Replace GoTrue with Zitadel
-- This migration removes all GoTrue dependencies and switches user IDs from UUID to TEXT
-- (Zitadel uses numeric string IDs, not UUIDs)

-- 1. Drop GoTrue trigger and function
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS handle_new_forumline_user();

-- 2. Drop OAuth tables (Zitadel manages OIDC clients now)
DROP TABLE IF EXISTS forumline_auth_codes;
DROP TABLE IF EXISTS forumline_oauth_clients;

-- 3. Remove FK from forumline_profiles to auth.users
ALTER TABLE forumline_profiles DROP CONSTRAINT IF EXISTS forumline_profiles_id_fkey;

-- 4. Change forumline_profiles.id from UUID to TEXT
-- Must cascade through all FKs that reference it
ALTER TABLE forumline_conversation_members DROP CONSTRAINT IF EXISTS forumline_conversation_members_user_id_fkey;
ALTER TABLE forumline_memberships DROP CONSTRAINT IF EXISTS forumline_memberships_user_id_fkey;
ALTER TABLE forumline_direct_messages DROP CONSTRAINT IF EXISTS forumline_direct_messages_sender_id_fkey;
ALTER TABLE forumline_direct_messages DROP CONSTRAINT IF EXISTS hub_direct_messages_sender_id_fkey;
ALTER TABLE forumline_notifications DROP CONSTRAINT IF EXISTS forumline_notifications_user_id_fkey;
ALTER TABLE push_subscriptions DROP CONSTRAINT IF EXISTS push_subscriptions_user_id_fkey;
ALTER TABLE forumline_conversations DROP CONSTRAINT IF EXISTS forumline_conversations_created_by_fkey;
ALTER TABLE forumline_forums DROP CONSTRAINT IF EXISTS forumline_forums_owner_id_fkey;
ALTER TABLE forumline_calls DROP CONSTRAINT IF EXISTS forumline_calls_caller_id_fkey;
ALTER TABLE forumline_calls DROP CONSTRAINT IF EXISTS forumline_calls_callee_id_fkey;

ALTER TABLE forumline_profiles ALTER COLUMN id TYPE TEXT USING id::text;
ALTER TABLE forumline_memberships ALTER COLUMN user_id TYPE TEXT USING user_id::text;
ALTER TABLE forumline_conversation_members ALTER COLUMN user_id TYPE TEXT USING user_id::text;
ALTER TABLE forumline_direct_messages ALTER COLUMN sender_id TYPE TEXT USING sender_id::text;
ALTER TABLE forumline_notifications ALTER COLUMN user_id TYPE TEXT USING user_id::text;
ALTER TABLE push_subscriptions ALTER COLUMN user_id TYPE TEXT USING user_id::text;
ALTER TABLE forumline_conversations ALTER COLUMN created_by TYPE TEXT USING created_by::text;
ALTER TABLE forumline_forums ALTER COLUMN owner_id TYPE TEXT USING owner_id::text;
ALTER TABLE forumline_calls ALTER COLUMN caller_id TYPE TEXT USING caller_id::text;
ALTER TABLE forumline_calls ALTER COLUMN callee_id TYPE TEXT USING callee_id::text;

-- Re-add FKs with TEXT type
ALTER TABLE forumline_memberships ADD CONSTRAINT forumline_memberships_user_id_fkey FOREIGN KEY (user_id) REFERENCES forumline_profiles(id) ON DELETE CASCADE;
ALTER TABLE forumline_conversation_members ADD CONSTRAINT forumline_conversation_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES forumline_profiles(id) ON DELETE CASCADE;
ALTER TABLE forumline_direct_messages ADD CONSTRAINT forumline_direct_messages_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES forumline_profiles(id) ON DELETE CASCADE;
ALTER TABLE forumline_notifications ADD CONSTRAINT forumline_notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES forumline_profiles(id) ON DELETE CASCADE;
ALTER TABLE push_subscriptions ADD CONSTRAINT push_subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES forumline_profiles(id) ON DELETE CASCADE;
ALTER TABLE forumline_conversations ADD CONSTRAINT forumline_conversations_created_by_fkey FOREIGN KEY (created_by) REFERENCES forumline_profiles(id);
ALTER TABLE forumline_forums ADD CONSTRAINT forumline_forums_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES forumline_profiles(id);
ALTER TABLE forumline_calls ADD CONSTRAINT forumline_calls_caller_id_fkey FOREIGN KEY (caller_id) REFERENCES forumline_profiles(id);
ALTER TABLE forumline_calls ADD CONSTRAINT forumline_calls_callee_id_fkey FOREIGN KEY (callee_id) REFERENCES forumline_profiles(id);

-- 5. Drop the entire GoTrue auth schema
DROP SCHEMA IF EXISTS auth CASCADE;

-- 6. Fix trigger functions that used UUID[] for member_ids
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

SELECT 'Migration 006 complete: GoTrue removed, Zitadel-compatible schema.' AS status;
