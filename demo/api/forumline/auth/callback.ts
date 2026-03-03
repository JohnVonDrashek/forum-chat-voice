import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

/**
 * GET /api/forumline/auth/callback
 * Handles the OAuth callback from Forumline Central Services.
 * Exchanges the authorization code for an identity token,
 * then creates or links a local user account.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { code, state } = req.query as Record<string, string>

  if (!code || !state) {
    return res.status(400).json({ error: 'Missing code or state parameter' })
  }

  // Verify state matches cookie
  const cookies = parseCookies(req.headers.cookie || '')
  if (cookies.forumline_state !== state) {
    return res.status(400).json({ error: 'State mismatch — possible CSRF attack' })
  }

  const hubUrl = process.env.FORUMLINE_HUB_URL
  const clientId = process.env.FORUMLINE_CLIENT_ID
  const clientSecret = process.env.FORUMLINE_CLIENT_SECRET
  if (!hubUrl || !clientId || !clientSecret) {
    return res.status(500).json({ error: 'Forumline Central Services not configured' })
  }

  // Exchange code for identity token
  const tokenResponse = await fetch(`${hubUrl}/api/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: `${process.env.VITE_SITE_URL || 'https://forum-chat-voice.vercel.app'}/api/forumline/auth/callback`,
    }),
  })

  if (!tokenResponse.ok) {
    const err = await tokenResponse.json().catch(() => ({}))
    return res.status(400).json({ error: 'Failed to exchange code', details: err })
  }

  const tokenData = await tokenResponse.json()
  const { identity, identity_token, hub_access_token } = tokenData

  if (!identity?.forumline_id || !identity?.username) {
    return res.status(500).json({ error: 'Invalid identity response from hub' })
  }

  // Create or link local user in the forum's Supabase
  const supabaseUrl = process.env.VITE_SUPABASE_URL!
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
  const supabase = createClient(supabaseUrl, serviceRoleKey)

  // Check if a local profile already has this forumline_id
  const { data: existingProfile } = await supabase
    .from('profiles')
    .select('id')
    .eq('forumline_id', identity.forumline_id)
    .single()

  let localUserId: string

  if (existingProfile) {
    // User already linked — update their profile from hub identity
    localUserId = existingProfile.id
    await supabase
      .from('profiles')
      .update({
        display_name: identity.display_name,
        avatar_url: identity.avatar_url || undefined,
      })
      .eq('id', localUserId)
  } else {
    // Create a new local auth user for this forumline identity
    const tempPassword = crypto.randomUUID()
    const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
      email: `${identity.username}@forumline.local`,
      password: tempPassword,
      email_confirm: true,
      user_metadata: {
        username: identity.username,
        display_name: identity.display_name,
        forumline_id: identity.forumline_id,
      },
    })

    if (createError || !newUser.user) {
      return res.status(500).json({ error: 'Failed to create local user', details: createError?.message })
    }

    localUserId = newUser.user.id

    // The profile trigger should create the profile, but let's update it with forumline_id
    await supabase
      .from('profiles')
      .update({ forumline_id: identity.forumline_id })
      .eq('id', localUserId)
  }

  // Create a session for the local user
  // We'll store the identity token and redirect to the app
  // Clear the state cookie
  const cookies = [
    'forumline_state=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0',
    `forumline_identity=${identity_token}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=3600`,
    `forumline_user_id=${localUserId}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=3600`,
  ]
  if (hub_access_token) {
    cookies.push(`hub_access_token=${hub_access_token}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=3600`)
  }
  res.setHeader('Set-Cookie', cookies)

  // Redirect to app with success indicator
  const appUrl = process.env.VITE_SITE_URL || 'https://forum-chat-voice.vercel.app'
  return res.redirect(302, `${appUrl}/?forumline_auth=success`)
}

function parseCookies(cookieHeader: string): Record<string, string> {
  const cookies: Record<string, string> = {}
  for (const pair of cookieHeader.split(';')) {
    const [key, ...rest] = pair.trim().split('=')
    if (key) cookies[key] = rest.join('=')
  }
  return cookies
}
