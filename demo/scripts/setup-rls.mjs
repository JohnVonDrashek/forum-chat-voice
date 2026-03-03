import pg from 'pg'

const connectionString = 'postgres://postgres.fepzwgtyqgkoswphxviv:HCxzerJ8h3W4Zktd@aws-1-us-east-1.pooler.supabase.com:5432/postgres?sslmode=require'
const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } })

// RLS policies - use DO blocks since CREATE POLICY IF NOT EXISTS doesn't exist in PG < 15
const policies = [
  // Profiles
  { table: 'profiles', name: 'Public profiles are viewable by everyone', cmd: 'SELECT', using: 'true' },
  { table: 'profiles', name: 'Users can update own profile', cmd: 'UPDATE', using: 'auth.uid() = id' },
  { table: 'profiles', name: 'Users can insert own profile', cmd: 'INSERT', check: 'auth.uid() = id' },
  { table: 'profiles', name: 'Service role can insert profiles', cmd: 'INSERT', check: 'true', role: 'postgres' },
  // Categories
  { table: 'categories', name: 'Categories are viewable by everyone', cmd: 'SELECT', using: 'true' },
  // Threads
  { table: 'threads', name: 'Threads are viewable by everyone', cmd: 'SELECT', using: 'true' },
  { table: 'threads', name: 'Authenticated users can create threads', cmd: 'INSERT', check: "auth.role() = 'authenticated'" },
  { table: 'threads', name: 'Authors can update own threads', cmd: 'UPDATE', using: 'auth.uid() = author_id' },
  // Posts
  { table: 'posts', name: 'Posts are viewable by everyone', cmd: 'SELECT', using: 'true' },
  { table: 'posts', name: 'Authenticated users can create posts', cmd: 'INSERT', check: "auth.role() = 'authenticated'" },
  { table: 'posts', name: 'Authors can update own posts', cmd: 'UPDATE', using: 'auth.uid() = author_id' },
  // Chat channels
  { table: 'chat_channels', name: 'Chat channels are viewable by everyone', cmd: 'SELECT', using: 'true' },
  // Chat messages
  { table: 'chat_messages', name: 'Chat messages are viewable by everyone', cmd: 'SELECT', using: 'true' },
  { table: 'chat_messages', name: 'Authenticated users can send messages', cmd: 'INSERT', check: "auth.role() = 'authenticated'" },
  // Direct messages
  { table: 'direct_messages', name: 'Users can view own DMs', cmd: 'SELECT', using: 'auth.uid() = sender_id OR auth.uid() = recipient_id' },
  { table: 'direct_messages', name: 'Authenticated users can send DMs', cmd: 'INSERT', check: 'auth.uid() = sender_id' },
  { table: 'direct_messages', name: 'Recipients can mark DMs as read', cmd: 'UPDATE', using: 'auth.uid() = recipient_id' },
  // Voice rooms
  { table: 'voice_rooms', name: 'Voice rooms are viewable by everyone', cmd: 'SELECT', using: 'true' },
  // Bookmarks
  { table: 'bookmarks', name: 'Users can view own bookmarks', cmd: 'SELECT', using: 'auth.uid() = user_id' },
  { table: 'bookmarks', name: 'Users can create bookmarks', cmd: 'INSERT', check: 'auth.uid() = user_id' },
  { table: 'bookmarks', name: 'Users can delete own bookmarks', cmd: 'DELETE', using: 'auth.uid() = user_id' },
  // Notifications
  { table: 'notifications', name: 'Users can view own notifications', cmd: 'SELECT', using: 'auth.uid() = user_id' },
  { table: 'notifications', name: 'Users can update own notifications', cmd: 'UPDATE', using: 'auth.uid() = user_id' },
]

async function main() {
  console.log('Connecting...')
  await client.connect()
  console.log('Creating RLS policies...')

  for (const p of policies) {
    const clause = p.cmd === 'INSERT'
      ? `WITH CHECK (${p.check})`
      : `USING (${p.using})`

    // Drop if exists, then create
    try {
      await client.query(`DROP POLICY IF EXISTS "${p.name}" ON ${p.table}`)
      const roleClause = p.role ? `TO ${p.role}` : ''
      await client.query(`CREATE POLICY "${p.name}" ON ${p.table} FOR ${p.cmd} ${roleClause} ${clause}`)
      console.log(`  ✓ ${p.table}: ${p.name}`)
    } catch (err) {
      console.error(`  ✗ ${p.table}: ${p.name} - ${err.message}`)
    }
  }

  // Create the trigger function
  console.log('\nCreating user signup trigger...')
  try {
    await client.query(`
      CREATE OR REPLACE FUNCTION handle_new_user()
      RETURNS TRIGGER
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = public
      AS $fn$
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
      $fn$;
    `)
    console.log('  ✓ handle_new_user() function created')

    await client.query(`DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users`)
    await client.query(`
      CREATE TRIGGER on_auth_user_created
        AFTER INSERT ON auth.users
        FOR EACH ROW EXECUTE FUNCTION handle_new_user();
    `)
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
