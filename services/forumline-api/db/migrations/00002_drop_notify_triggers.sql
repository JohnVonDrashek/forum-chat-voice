-- +goose Up
-- Drop PG NOTIFY triggers — realtime events are now published directly
-- from Go service code to NATS. These triggers are no longer needed.

DROP TRIGGER IF EXISTS dm_changes_notify ON forumline_direct_messages;
DROP FUNCTION IF EXISTS notify_dm_changes();

DROP TRIGGER IF EXISTS push_dm_notify ON forumline_direct_messages;
DROP FUNCTION IF EXISTS notify_new_dm();

DROP TRIGGER IF EXISTS trg_forumline_notification_insert ON forumline_notifications;
DROP FUNCTION IF EXISTS notify_forumline_notification_insert();

-- +goose Down
-- Recreate triggers for rollback (PG LISTEN fallback path).

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

CREATE TRIGGER dm_changes_notify
  AFTER INSERT ON forumline_direct_messages
  FOR EACH ROW EXECUTE FUNCTION notify_dm_changes();

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

CREATE TRIGGER push_dm_notify
  AFTER INSERT ON forumline_direct_messages
  FOR EACH ROW EXECUTE FUNCTION notify_new_dm();

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

CREATE TRIGGER trg_forumline_notification_insert
  AFTER INSERT ON forumline_notifications
  FOR EACH ROW EXECUTE FUNCTION notify_forumline_notification_insert();
