import type { VercelRequest, VercelResponse } from '@vercel/node'
import { randomBytes } from 'crypto'
import { getHubSupabase } from '../_lib/supabase.js'
import { renderLoginPage } from '../_lib/templates/oauth-login.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
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

  // Fetch forum name for display
  const { data: forum } = await supabase
    .from('forumline_forums')
    .select('name, domain')
    .eq('id', client.forum_id)
    .single()

  const forumName = forum?.name || forum?.domain || 'a forum'

  // Check if user is authenticated via Bearer token or access_token query param
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
    // Not authenticated — serve HTML login/signup page
    const html = renderLoginPage({ client_id, redirect_uri, state, forumName })
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    return res.status(200).send(html)
  }

  // Generate authorization code
  const code = randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString()

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

  await supabase
    .from('forumline_memberships')
    .upsert(
      { user_id: userId, forum_id: client.forum_id },
      { onConflict: 'user_id,forum_id' }
    )

  const redirectUrl = new URL(redirect_uri)
  redirectUrl.searchParams.set('code', code)
  redirectUrl.searchParams.set('state', state)

  return res.redirect(302, redirectUrl.toString())
}
