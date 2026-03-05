-- Notification relay trigger: forwards notifications to hub for web push delivery
-- Applied to forum-demo Supabase project (fepzwgtyqgkoswphxviv)
-- Requires: pg_net extension

CREATE EXTENSION IF NOT EXISTS pg_net SCHEMA extensions;

CREATE OR REPLACE FUNCTION relay_notification_to_hub()
RETURNS TRIGGER AS $$
DECLARE
  v_forumline_id TEXT;
BEGIN
  -- Only relay if the user has a forumline_id (connected to hub)
  SELECT forumline_id INTO v_forumline_id
  FROM profiles WHERE id = NEW.user_id;

  IF v_forumline_id IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url := 'https://app.forumline.net/api/push-notify',
    body := jsonb_build_object(
      'forumline_id', v_forumline_id,
      'title', NEW.title,
      'body', NEW.message,
      'link', NEW.link,
      'forum_domain', 'demo.forumline.net'
    ),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <HUB_SERVICE_ROLE_KEY>'
    )
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Don't let push relay failure block notification creation
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_notification_relay_to_hub ON notifications;
CREATE TRIGGER on_notification_relay_to_hub
  AFTER INSERT ON notifications
  FOR EACH ROW
  EXECUTE FUNCTION relay_notification_to_hub();
