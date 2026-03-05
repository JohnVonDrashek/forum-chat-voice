-- Push subscriptions table + DM push trigger
-- Applied to hub Supabase project (dptamxaerujopfzoazxq)
-- Requires: pg_net extension

CREATE EXTENSION IF NOT EXISTS pg_net SCHEMA extensions;

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES hub_profiles(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, endpoint)
);

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own subscriptions"
  ON push_subscriptions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own subscriptions"
  ON push_subscriptions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own subscriptions"
  ON push_subscriptions FOR DELETE
  USING (auth.uid() = user_id);

-- DM push notification trigger
CREATE OR REPLACE FUNCTION push_notify_dm()
RETURNS TRIGGER AS $$
DECLARE
  v_sender_username TEXT;
BEGIN
  SELECT username INTO v_sender_username
  FROM hub_profiles WHERE id = NEW.sender_id;

  PERFORM net.http_post(
    url := 'https://app.forumline.net/api/push-notify',
    body := jsonb_build_object(
      'user_id', NEW.recipient_id,
      'title', 'Message from ' || COALESCE(v_sender_username, 'someone'),
      'body', LEFT(NEW.content, 100)
    ),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <HUB_SERVICE_ROLE_KEY>'
    )
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_dm_push_notify ON hub_direct_messages;
CREATE TRIGGER on_dm_push_notify
  AFTER INSERT ON hub_direct_messages
  FOR EACH ROW
  EXECUTE FUNCTION push_notify_dm();
