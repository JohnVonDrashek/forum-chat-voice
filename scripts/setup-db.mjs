import pg from 'pg'

const connectionString = 'postgres://postgres.fepzwgtyqgkoswphxviv:HCxzerJ8h3W4Zktd@aws-1-us-east-1.pooler.supabase.com:5432/postgres?sslmode=require'

const client = new pg.Client({
  connectionString,
  ssl: { rejectUnauthorized: false },
})

const sql = `
-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Profiles table (linked to Supabase auth.users)
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username TEXT UNIQUE NOT NULL,
  display_name TEXT,
  avatar_url TEXT,
  bio TEXT,
  website TEXT,
  is_admin BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Categories
CREATE TABLE IF NOT EXISTS categories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  description TEXT,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Threads
CREATE TABLE IF NOT EXISTS threads (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  category_id UUID NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  slug TEXT NOT NULL,
  content TEXT,
  is_pinned BOOLEAN DEFAULT FALSE,
  is_locked BOOLEAN DEFAULT FALSE,
  view_count INT DEFAULT 0,
  post_count INT DEFAULT 0,
  last_post_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Posts (replies in threads)
CREATE TABLE IF NOT EXISTS posts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  thread_id UUID NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  reply_to_id UUID REFERENCES posts(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Chat channels
CREATE TABLE IF NOT EXISTS chat_channels (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Chat messages
CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  channel_id UUID NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Direct messages
CREATE TABLE IF NOT EXISTS direct_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sender_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  recipient_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Voice rooms
CREATE TABLE IF NOT EXISTS voice_rooms (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Bookmarks
CREATE TABLE IF NOT EXISTS bookmarks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  thread_id UUID NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, thread_id)
);

-- Notifications
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('reply', 'mention', 'like', 'follow', 'dm')),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  link TEXT,
  read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_threads_category ON threads(category_id);
CREATE INDEX IF NOT EXISTS idx_threads_author ON threads(author_id);
CREATE INDEX IF NOT EXISTS idx_posts_thread ON posts(thread_id);
CREATE INDEX IF NOT EXISTS idx_posts_author ON posts(author_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_channel ON chat_messages(channel_id);
CREATE INDEX IF NOT EXISTS idx_dm_sender ON direct_messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_dm_recipient ON direct_messages(recipient_id);
CREATE INDEX IF NOT EXISTS idx_bookmarks_user ON bookmarks(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);

-- Enable Row Level Security
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE direct_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE voice_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookmarks ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- RLS Policies: profiles
CREATE POLICY IF NOT EXISTS "Public profiles are viewable by everyone" ON profiles FOR SELECT USING (true);
CREATE POLICY IF NOT EXISTS "Users can update own profile" ON profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY IF NOT EXISTS "Users can insert own profile" ON profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY IF NOT EXISTS "Service role can insert profiles" ON profiles FOR INSERT TO postgres WITH CHECK (true);

-- RLS Policies: categories (public read)
CREATE POLICY IF NOT EXISTS "Categories are viewable by everyone" ON categories FOR SELECT USING (true);

-- RLS Policies: threads
CREATE POLICY IF NOT EXISTS "Threads are viewable by everyone" ON threads FOR SELECT USING (true);
CREATE POLICY IF NOT EXISTS "Authenticated users can create threads" ON threads FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY IF NOT EXISTS "Authors can update own threads" ON threads FOR UPDATE USING (auth.uid() = author_id);

-- RLS Policies: posts
CREATE POLICY IF NOT EXISTS "Posts are viewable by everyone" ON posts FOR SELECT USING (true);
CREATE POLICY IF NOT EXISTS "Authenticated users can create posts" ON posts FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY IF NOT EXISTS "Authors can update own posts" ON posts FOR UPDATE USING (auth.uid() = author_id);

-- RLS Policies: chat_channels (public read)
CREATE POLICY IF NOT EXISTS "Chat channels are viewable by everyone" ON chat_channels FOR SELECT USING (true);

-- RLS Policies: chat_messages
CREATE POLICY IF NOT EXISTS "Chat messages are viewable by everyone" ON chat_messages FOR SELECT USING (true);
CREATE POLICY IF NOT EXISTS "Authenticated users can send messages" ON chat_messages FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- RLS Policies: direct_messages
CREATE POLICY IF NOT EXISTS "Users can view own DMs" ON direct_messages FOR SELECT USING (auth.uid() = sender_id OR auth.uid() = recipient_id);
CREATE POLICY IF NOT EXISTS "Authenticated users can send DMs" ON direct_messages FOR INSERT WITH CHECK (auth.uid() = sender_id);
CREATE POLICY IF NOT EXISTS "Recipients can mark DMs as read" ON direct_messages FOR UPDATE USING (auth.uid() = recipient_id);

-- RLS Policies: voice_rooms (public read)
CREATE POLICY IF NOT EXISTS "Voice rooms are viewable by everyone" ON voice_rooms FOR SELECT USING (true);

-- RLS Policies: bookmarks
CREATE POLICY IF NOT EXISTS "Users can view own bookmarks" ON bookmarks FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY IF NOT EXISTS "Users can create bookmarks" ON bookmarks FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY IF NOT EXISTS "Users can delete own bookmarks" ON bookmarks FOR DELETE USING (auth.uid() = user_id);

-- RLS Policies: notifications
CREATE POLICY IF NOT EXISTS "Users can view own notifications" ON notifications FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY IF NOT EXISTS "Users can update own notifications" ON notifications FOR UPDATE USING (auth.uid() = user_id);

-- Enable Realtime for chat
ALTER PUBLICATION supabase_realtime ADD TABLE chat_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE direct_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE notifications;

-- Seed data: categories
INSERT INTO categories (name, slug, description, sort_order) VALUES
  ('General Discussion', 'general', 'Talk about anything and everything', 1),
  ('Announcements', 'announcements', 'Official announcements and updates', 0),
  ('Help & Support', 'help', 'Get help with issues and questions', 2),
  ('Off Topic', 'off-topic', 'Casual conversations and fun stuff', 3)
ON CONFLICT (slug) DO NOTHING;

-- Seed data: chat channels
INSERT INTO chat_channels (name, slug, description) VALUES
  ('General', 'general', 'General chat for everyone'),
  ('Random', 'random', 'Off-topic and random discussion'),
  ('Help', 'help', 'Get help from the community')
ON CONFLICT (slug) DO NOTHING;

-- Seed data: voice rooms
INSERT INTO voice_rooms (name, slug) VALUES
  ('Lounge', 'lounge'),
  ('Gaming', 'gaming'),
  ('Music', 'music')
ON CONFLICT (slug) DO NOTHING;

`

// Trigger function — run separately since it contains semicolons inside $$ block
const triggerFnSql = `
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, username, display_name, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1)),
    NEW.raw_user_meta_data->>'avatar_url'
  );
  RETURN NEW;
END;
$$;
`

const triggerSql = `
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();
`

async function main() {
  console.log('Connecting to Supabase database...')
  await client.connect()
  console.log('Connected! Running migrations...')

  // Split by statement and run individually to get better error messages
  const statements = sql.split(';').map(s => s.trim()).filter(s => s.length > 0)

  for (const stmt of statements) {
    try {
      await client.query(stmt)
      // Print first 60 chars of each statement
      const preview = stmt.replace(/\n/g, ' ').substring(0, 60)
      console.log(`  ✓ ${preview}...`)
    } catch (err) {
      const preview = stmt.replace(/\n/g, ' ').substring(0, 60)
      console.error(`  ✗ ${preview}...`)
      console.error(`    Error: ${err.message}`)
    }
  }

  // Run trigger function and trigger as single statements (contain semicolons inside $$ block)
  console.log('\nCreating user signup trigger...')
  try {
    await client.query(triggerFnSql)
    console.log('  ✓ handle_new_user() function created')
    await client.query(triggerSql)
    console.log('  ✓ on_auth_user_created trigger created')
  } catch (err) {
    console.error(`  ✗ Trigger: ${err.message}`)
  }

  console.log('\nDone!')
  await client.end()
}

main().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})
