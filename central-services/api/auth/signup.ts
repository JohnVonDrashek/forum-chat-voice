import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getHubSupabase, getHubSupabaseAnon, handleCors } from '../_lib/supabase'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleCors(req, res)) return

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { email, password, username, display_name } = req.body || {}

  if (!email || !password || !username) {
    return res.status(400).json({ error: 'email, password, and username are required' })
  }

  if (username.length < 3 || username.length > 30) {
    return res.status(400).json({ error: 'Username must be 3-30 characters' })
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
    return res.status(400).json({ error: 'Username may only contain letters, numbers, hyphens, and underscores' })
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
    return res.status(400).json({ error: error.message })
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
    await serviceSupabase.auth.admin.deleteUser(data.user.id)
    return res.status(500).json({ error: 'Failed to create profile: ' + profileError.message })
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
