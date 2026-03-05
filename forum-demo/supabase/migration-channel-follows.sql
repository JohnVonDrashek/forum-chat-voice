-- channel_follows table + new thread notification trigger
-- Applied to forum-demo Supabase project (fepzwgtyqgkoswphxviv)

CREATE TABLE IF NOT EXISTS channel_follows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  category_id UUID NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, category_id)
);

ALTER TABLE channel_follows ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own follows"
  ON channel_follows FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own follows"
  ON channel_follows FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own follows"
  ON channel_follows FOR DELETE
  USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION notify_on_new_thread()
RETURNS TRIGGER AS $$
DECLARE
  v_category_name TEXT;
  v_poster_username TEXT;
  v_follower RECORD;
BEGIN
  SELECT name INTO v_category_name FROM categories WHERE id = NEW.category_id;
  SELECT COALESCE(display_name, username) INTO v_poster_username FROM profiles WHERE id = NEW.author_id;

  FOR v_follower IN
    SELECT user_id FROM channel_follows
    WHERE category_id = NEW.category_id
      AND user_id != NEW.author_id
  LOOP
    IF should_notify(v_follower.user_id, 'new_thread') THEN
      INSERT INTO notifications (user_id, type, title, message, link)
      VALUES (
        v_follower.user_id,
        'new_thread',
        'New thread in ' || COALESCE(v_category_name, 'a category'),
        v_poster_username || ' posted "' || LEFT(NEW.title, 80) || '"',
        '/thread/' || NEW.id
      );
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_thread_notify_followers ON threads;
CREATE TRIGGER on_thread_notify_followers
  AFTER INSERT ON threads
  FOR EACH ROW
  EXECUTE FUNCTION notify_on_new_thread();
