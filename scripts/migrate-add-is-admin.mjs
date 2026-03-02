import pg from 'pg'

// Supabase pooler uses self-signed certs
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

const connectionString = 'postgres://postgres.fepzwgtyqgkoswphxviv:HCxzerJ8h3W4Zktd@aws-1-us-east-1.pooler.supabase.com:5432/postgres'
const client = new pg.Client({ connectionString, ssl: true })

async function main() {
  console.log('Connecting to Supabase database...')
  await client.connect()

  // 1. Add is_admin column if it doesn't exist
  console.log('\n1. Adding is_admin column to profiles...')
  try {
    await client.query(`ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT FALSE`)
    console.log('   ✓ is_admin column added (or already exists)')
  } catch (err) {
    console.error(`   ✗ ${err.message}`)
  }

  // 2. Fix RLS: allow postgres role (trigger function owner) to insert profiles
  // Required because postgres is NOT a superuser in Supabase Marketplace instances
  console.log('\n2. Adding RLS INSERT policy for postgres role...')
  try {
    await client.query(`DROP POLICY IF EXISTS "Service role can insert profiles" ON profiles`)
    await client.query(`CREATE POLICY "Service role can insert profiles" ON profiles FOR INSERT TO postgres WITH CHECK (true)`)
    console.log('   ✓ Policy created')
  } catch (err) {
    console.error(`   ✗ ${err.message}`)
  }

  // 3. Recreate the trigger function with SET search_path
  console.log('\n3. Creating handle_new_user() trigger function...')
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
    console.log('   ✓ Function created')
  } catch (err) {
    console.error(`   ✗ ${err.message}`)
  }

  // 4. Recreate the trigger
  console.log('\n4. Creating on_auth_user_created trigger...')
  try {
    await client.query(`DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users`)
    await client.query(`
      CREATE TRIGGER on_auth_user_created
        AFTER INSERT ON auth.users
        FOR EACH ROW EXECUTE FUNCTION handle_new_user();
    `)
    console.log('   ✓ Trigger created')
  } catch (err) {
    console.error(`   ✗ ${err.message}`)
  }

  // 5. Fix any existing auth users that are missing profiles
  console.log('\n5. Checking for auth users without profiles...')
  try {
    const { rows } = await client.query(`
      SELECT au.id, au.email, au.raw_user_meta_data
      FROM auth.users au
      LEFT JOIN profiles p ON p.id = au.id
      WHERE p.id IS NULL
    `)
    if (rows.length === 0) {
      console.log('   ✓ All auth users have profiles')
    } else {
      console.log(`   Found ${rows.length} users without profiles, creating them...`)
      for (const row of rows) {
        const username = row.raw_user_meta_data?.username || row.email?.split('@')[0] || `user_${row.id.slice(0, 8)}`
        const displayName = row.raw_user_meta_data?.display_name || username
        try {
          await client.query(
            `INSERT INTO profiles (id, username, display_name) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING`,
            [row.id, username, displayName]
          )
          console.log(`   ✓ Created profile for ${username} (${row.email})`)
        } catch (err) {
          console.error(`   ✗ Failed for ${row.email}: ${err.message}`)
        }
      }
    }
  } catch (err) {
    console.error(`   ✗ ${err.message}`)
  }

  // 6. Verify
  console.log('\n6. Verification...')
  try {
    const { rows: [col] } = await client.query(`
      SELECT column_name, data_type, column_default
      FROM information_schema.columns
      WHERE table_name = 'profiles' AND column_name = 'is_admin'
    `)
    console.log(`   ${col ? '✓' : '✗'} is_admin column: ${col ? `${col.data_type}, default=${col.column_default}` : 'NOT FOUND'}`)

    const { rows: [trigger] } = await client.query(`
      SELECT trigger_name FROM information_schema.triggers
      WHERE trigger_name = 'on_auth_user_created'
    `)
    console.log(`   ${trigger ? '✓' : '✗'} on_auth_user_created trigger: ${trigger ? 'exists' : 'NOT FOUND'}`)

    const { rows: policies } = await client.query(`
      SELECT polname FROM pg_policy
      WHERE polrelid = 'public.profiles'::regclass AND polname = 'Service role can insert profiles'
    `)
    console.log(`   ${policies.length ? '✓' : '✗'} RLS policy for postgres role: ${policies.length ? 'exists' : 'NOT FOUND'}`)

    const { rows: [counts] } = await client.query(`
      SELECT
        (SELECT count(*) FROM auth.users) as auth_users,
        (SELECT count(*) FROM profiles) as profiles
    `)
    console.log(`   ✓ Auth users: ${counts.auth_users}, Profiles: ${counts.profiles}`)
  } catch (err) {
    console.error(`   ✗ Verification failed: ${err.message}`)
  }

  console.log('\nDone!')
  await client.end()
}

main().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})
