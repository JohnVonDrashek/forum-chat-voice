import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getHubSupabase, getHubSupabaseAnon } from '../_lib/supabase.js'
import { rateLimit } from '../_lib/rate-limit.js'
import { usernameSchema, passwordSchema, emailSchema } from '@johnvondrashek/forumline-protocol/validation'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  if (!rateLimit(req, res, { key: 'signup', limit: 5, windowMs: 60_000 })) return

  const { email, password, username, display_name } = req.body || {}

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

  const serviceSupabase = getHubSupabase()

  // Check username uniqueness before creating auth user
  const { data: existingProfile } = await serviceSupabase
    .from('hub_profiles')
    .select('id')
    .eq('username', username)
    .single()

  if (existingProfile) {
    return res.status(409).json({ error: 'Username already taken' })
  }

  const supabase = getHubSupabaseAnon()

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        username,
        display_name: display_name || username,
      },
    },
  })

  if (error) {
    console.error('[signup] Supabase auth.signUp error:', error)
    return res.status(400).json({ error: 'Signup failed' })
  }

  if (!data.user || !data.session) {
    return res.status(400).json({ error: 'Signup failed — check email confirmation settings' })
  }

  // Create hub profile (no trigger — we do it manually)
  const { error: profileError } = await serviceSupabase
    .from('hub_profiles')
    .insert({
      id: data.user.id,
      username,
      display_name: display_name || username,
    })

  if (profileError) {
    // Profile creation failed — clean up auth user
    console.error('[signup] Failed to create hub_profile for user', data.user.id, ':', profileError)
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
      expires_at: new Date((data.session.expires_at ?? 0) * 1000).toISOString(),
    },
  })
}
