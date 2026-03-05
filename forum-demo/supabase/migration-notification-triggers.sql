-- ============================================================
-- Phase 1a: Reply notifications on posts INSERT
-- ============================================================
CREATE OR REPLACE FUNCTION notify_on_reply()
RETURNS TRIGGER AS $$
DECLARE
  v_thread RECORD;
  v_poster_username TEXT;
  v_participant RECORD;
BEGIN
  -- Look up the thread
  SELECT id, title, author_id INTO v_thread
  FROM threads WHERE id = NEW.thread_id;

  IF NOT FOUND THEN RETURN NEW; END IF;

  -- Get the poster's display name
  SELECT COALESCE(display_name, username) INTO v_poster_username
  FROM profiles WHERE id = NEW.author_id;

  -- Notify thread author (skip if post author == thread author)
  IF NEW.author_id != v_thread.author_id THEN
    INSERT INTO notifications (user_id, type, title, message, link)
    VALUES (
      v_thread.author_id,
      'reply',
      'New reply in "' || LEFT(v_thread.title, 80) || '"',
      v_poster_username || ' replied to your thread',
      '/thread/' || NEW.thread_id
    );
  END IF;

  -- Notify other thread participants (distinct post authors, excluding the poster and thread author)
  FOR v_participant IN
    SELECT DISTINCT author_id
    FROM posts
    WHERE thread_id = NEW.thread_id
      AND author_id != NEW.author_id
      AND author_id != v_thread.author_id
  LOOP
    INSERT INTO notifications (user_id, type, title, message, link)
    VALUES (
      v_participant.author_id,
      'reply',
      'New reply in "' || LEFT(v_thread.title, 80) || '"',
      v_poster_username || ' also replied',
      '/thread/' || NEW.thread_id
    );
  END LOOP;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_post_notify_reply ON posts;
CREATE TRIGGER on_post_notify_reply
  AFTER INSERT ON posts
  FOR EACH ROW
  EXECUTE FUNCTION notify_on_reply();

-- ============================================================
-- Phase 1b: @Mention notifications on posts INSERT
-- ============================================================
CREATE OR REPLACE FUNCTION notify_on_post_mention()
RETURNS TRIGGER AS $$
DECLARE
  v_mention TEXT;
  v_mentioned_user RECORD;
  v_thread_title TEXT;
BEGIN
  SELECT title INTO v_thread_title FROM threads WHERE id = NEW.thread_id;

  -- Extract @username mentions using regex
  FOR v_mention IN
    SELECT DISTINCT (regexp_matches(NEW.content, '@([a-zA-Z0-9_]{3,30})', 'g'))[1]
  LOOP
    -- Look up the mentioned user
    SELECT id, username INTO v_mentioned_user
    FROM profiles
    WHERE username = v_mention AND id != NEW.author_id;

    IF FOUND THEN
      -- Deduplicate: skip if user already has a mention notification for this link
      IF NOT EXISTS (
        SELECT 1 FROM notifications
        WHERE user_id = v_mentioned_user.id
          AND type = 'mention'
          AND link = '/thread/' || NEW.thread_id
          AND read = false
      ) THEN
        INSERT INTO notifications (user_id, type, title, message, link)
        VALUES (
          v_mentioned_user.id,
          'mention',
          'Mentioned in "' || LEFT(COALESCE(v_thread_title, 'a thread'), 80) || '"',
          'You were mentioned in a post',
          '/thread/' || NEW.thread_id
        );
      END IF;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_post_notify_mention ON posts;
CREATE TRIGGER on_post_notify_mention
  AFTER INSERT ON posts
  FOR EACH ROW
  EXECUTE FUNCTION notify_on_post_mention();

-- ============================================================
-- Phase 1c: @Mention notifications on chat_messages INSERT
-- ============================================================
CREATE OR REPLACE FUNCTION notify_on_chat_mention()
RETURNS TRIGGER AS $$
DECLARE
  v_mention TEXT;
  v_mentioned_user RECORD;
  v_channel RECORD;
BEGIN
  SELECT id, name, slug INTO v_channel
  FROM chat_channels WHERE id = NEW.channel_id;

  IF NOT FOUND THEN RETURN NEW; END IF;

  FOR v_mention IN
    SELECT DISTINCT (regexp_matches(NEW.content, '@([a-zA-Z0-9_]{3,30})', 'g'))[1]
  LOOP
    SELECT id, username INTO v_mentioned_user
    FROM profiles
    WHERE username = v_mention AND id != NEW.author_id;

    IF FOUND THEN
      -- Deduplicate: skip if unread mention for same chat channel already exists
      IF NOT EXISTS (
        SELECT 1 FROM notifications
        WHERE user_id = v_mentioned_user.id
          AND type = 'chat_mention'
          AND link = '/chat/' || v_channel.slug
          AND read = false
      ) THEN
        INSERT INTO notifications (user_id, type, title, message, link)
        VALUES (
          v_mentioned_user.id,
          'chat_mention',
          'Mentioned in #' || v_channel.name,
          'You were mentioned in chat',
          '/chat/' || v_channel.slug
        );
      END IF;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_chat_notify_mention ON chat_messages;
CREATE TRIGGER on_chat_notify_mention
  AFTER INSERT ON chat_messages
  FOR EACH ROW
  EXECUTE FUNCTION notify_on_chat_mention();
