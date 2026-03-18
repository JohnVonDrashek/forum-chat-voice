-- +goose Up
-- Drop PG NOTIFY triggers — realtime events are now published directly
-- from Go service code to NATS. These triggers are no longer needed.

DROP TRIGGER IF EXISTS trg_notification_insert ON notifications;
DROP FUNCTION IF EXISTS notify_notification_insert();

DROP TRIGGER IF EXISTS trg_chat_message_insert ON chat_messages;
DROP FUNCTION IF EXISTS notify_chat_message_insert();

DROP TRIGGER IF EXISTS trg_voice_presence_change ON voice_presence;
DROP FUNCTION IF EXISTS notify_voice_presence_change();

DROP TRIGGER IF EXISTS trg_post_insert ON posts;
DROP FUNCTION IF EXISTS notify_post_insert();

-- +goose Down
-- Recreate triggers for rollback (PG LISTEN fallback path).

CREATE OR REPLACE FUNCTION notify_notification_insert() RETURNS TRIGGER AS $$
BEGIN
  PERFORM pg_notify('notification_changes', json_build_object(
    'schema', current_schema(),
    'id', NEW.id,
    'user_id', NEW.user_id,
    'type', NEW.type,
    'title', NEW.title,
    'message', NEW.message,
    'link', NEW.link,
    'read', NEW.read,
    'created_at', NEW.created_at
  )::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_notification_insert
  AFTER INSERT ON notifications
  FOR EACH ROW EXECUTE FUNCTION notify_notification_insert();

CREATE OR REPLACE FUNCTION notify_chat_message_insert() RETURNS TRIGGER AS $$
BEGIN
  PERFORM pg_notify('chat_message_changes', json_build_object(
    'schema', current_schema(),
    'id', NEW.id,
    'channel_id', NEW.channel_id,
    'author_id', NEW.author_id,
    'content', NEW.content,
    'created_at', NEW.created_at
  )::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_chat_message_insert
  AFTER INSERT ON chat_messages
  FOR EACH ROW EXECUTE FUNCTION notify_chat_message_insert();

CREATE OR REPLACE FUNCTION notify_voice_presence_change() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM pg_notify('voice_presence_changes', json_build_object(
      'schema', current_schema(),
      'event', TG_OP,
      'user_id', OLD.user_id,
      'room_slug', OLD.room_slug
    )::text);
  ELSE
    PERFORM pg_notify('voice_presence_changes', json_build_object(
      'schema', current_schema(),
      'event', TG_OP,
      'user_id', NEW.user_id,
      'room_slug', NEW.room_slug,
      'joined_at', NEW.joined_at
    )::text);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_voice_presence_change
  AFTER INSERT OR UPDATE OR DELETE ON voice_presence
  FOR EACH ROW EXECUTE FUNCTION notify_voice_presence_change();

CREATE OR REPLACE FUNCTION notify_post_insert() RETURNS TRIGGER AS $$
BEGIN
  PERFORM pg_notify('post_changes', json_build_object(
    'schema', current_schema(),
    'id', NEW.id,
    'thread_id', NEW.thread_id,
    'author_id', NEW.author_id,
    'content', NEW.content,
    'reply_to_id', NEW.reply_to_id,
    'created_at', NEW.created_at
  )::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_post_insert
  AFTER INSERT ON posts
  FOR EACH ROW EXECUTE FUNCTION notify_post_insert();
