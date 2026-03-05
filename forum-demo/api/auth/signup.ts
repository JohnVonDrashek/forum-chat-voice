import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { rateLimit } from '@johnvondrashek/forumline-server-sdk'
import { usernameSchema, passwordSchema, emailSchema } from '@johnvondrashek/forumline-protocol/validation'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  if (!rateLimit(req, res, { key: 'signup', limit: 5, windowMs: 60_000 })) return

  const { email, password, username } = req.body || {}

  const emailResult = emailSchema.safeParse(email)
  if (!emailResult.success) {
    return res.status(400).json({ error: emailResult.error.issues[0].message })
  }

  const passwordResult = passwordSchema.safeParse(password)
  if (!passwordResult.success) {
    return res.status(400).json({ error: passwordResult.error.issues[0].message })
  }

  const usernameResult = usernameSchema.safeParse(username)
  if (!usernameResult.success) {
    return res.status(400).json({ error: usernameResult.error.issues[0].message })
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL!
  const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY!
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

  const serviceSupabase = createClient(supabaseUrl, serviceRoleKey)

  // Check email uniqueness via admin API
  const { data: existingUsers } = await serviceSupabase.auth.admin.listUsers()
  const emailTaken = existingUsers?.users?.some(
    u => u.email?.toLowerCase() === email.toLowerCase()
  )
  if (emailTaken) {
    return res.status(409).json({ error: 'An account with this email already exists' })
  }

  // Check username uniqueness
  const { data: existingProfile } = await serviceSupabase
    .from('profiles')
    .select('id')
    .eq('username', username)
    .single()

  if (existingProfile) {
    return res.status(409).json({ error: 'Username already taken' })
  }

  // Create user via anon client (respects Supabase auth config)
  const anonSupabase = createClient(supabaseUrl, supabaseAnonKey)
  const { data, error } = await anonSupabase.auth.signUp({
    email,
    password,
    options: {
      data: { username, display_name: username },
    },
  })

  if (error) {
    return res.status(400).json({ error: error.message })
  }

  if (!data.user || !data.session) {
    return res.status(400).json({ error: 'Signup failed' })
  }

  // Create profile via service role (don't rely on trigger)
  const { error: profileError } = await serviceSupabase
    .from('profiles')
    .upsert({
      id: data.user.id,
      username,
      display_name: username,
    }, { onConflict: 'id' })

  if (profileError) {
    // Clean up auth user if profile creation fails
    await serviceSupabase.auth.admin.deleteUser(data.user.id)
    return res.status(500).json({ error: 'Failed to create profile' })
  }

  return res.status(201).json({
    user: {
      id: data.user.id,
      email: data.user.email,
    },
    session: {
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
    },
  })
}
