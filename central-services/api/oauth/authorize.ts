import type { VercelRequest, VercelResponse } from '@vercel/node'
import { randomBytes } from 'crypto'
import { getHubSupabase, handleCors } from '../_lib/supabase'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleCors(req, res)) return

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { client_id, redirect_uri, state } = req.query as Record<string, string>

  if (!client_id || !redirect_uri || !state) {
    return res.status(400).json({ error: 'client_id, redirect_uri, and state are required' })
  }

  const supabase = getHubSupabase()

  // Validate client_id and redirect_uri
  const { data: client } = await supabase
    .from('forumline_oauth_clients')
    .select('id, forum_id, redirect_uris')
    .eq('client_id', client_id)
    .single()

  if (!client) {
    return res.status(400).json({ error: 'Invalid client_id' })
  }

  const allowedUris: string[] = client.redirect_uris || []
  if (!allowedUris.includes(redirect_uri)) {
    return res.status(400).json({ error: 'Invalid redirect_uri' })
  }

  // Check if user is authenticated via session cookie or Bearer token
  const authHeader = req.headers.authorization
  let userId: string | null = null

  if (authHeader?.startsWith('Bearer ')) {
    const jwt = authHeader.slice(7)
    const { createClient } = await import('@supabase/supabase-js')
    const anonClient = createClient(
      process.env.HUB_SUPABASE_URL!,
      process.env.HUB_SUPABASE_ANON_KEY!
    )
    const { data: { user } } = await anonClient.auth.getUser(jwt)
    if (user) userId = user.id
  }

  // Also check for access_token query param (for redirect-based flows)
  if (!userId && req.query.access_token) {
    const { createClient } = await import('@supabase/supabase-js')
    const anonClient = createClient(
      process.env.HUB_SUPABASE_URL!,
      process.env.HUB_SUPABASE_ANON_KEY!
    )
    const { data: { user } } = await anonClient.auth.getUser(req.query.access_token as string)
    if (user) userId = user.id
  }

  if (!userId) {
    // Not authenticated — return a response indicating login is needed
    // The hub frontend (or a simple login page) would handle this
    return res.status(401).json({
      error: 'Not authenticated',
      login_url: `/api/auth/login`,
      message: 'User must authenticate with the hub before authorizing. Send a POST to /api/auth/login with email+password, then retry with the access_token.',
      retry_params: { client_id, redirect_uri, state },
    })
  }

  // Generate authorization code
  const code = randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString() // 5 minutes

  const { error } = await supabase
    .from('forumline_auth_codes')
    .insert({
      code,
      user_id: userId,
      forum_id: client.forum_id,
      redirect_uri,
      expires_at: expiresAt,
    })

  if (error) {
    return res.status(500).json({ error: 'Failed to generate authorization code' })
  }

  // Also create a membership if one doesn't exist
  await supabase
    .from('forumline_memberships')
    .upsert(
      { user_id: userId, forum_id: client.forum_id },
      { onConflict: 'user_id,forum_id' }
    )

  // Redirect back to the forum with the authorization code
  const redirectUrl = new URL(redirect_uri)
  redirectUrl.searchParams.set('code', code)
  redirectUrl.searchParams.set('state', state)

  return res.redirect(302, redirectUrl.toString())
}
