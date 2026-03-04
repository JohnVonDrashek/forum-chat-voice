import type { VercelRequest, VercelResponse } from '@vercel/node'
import { randomBytes, createHash } from 'crypto'
import { getHubSupabase, getAuthenticatedUser } from '../_lib/supabase.js'
import { forumUrlSchema } from '@johnvondrashek/forumline-protocol/validation'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const user = await getAuthenticatedUser(req, res)
  if (!user) return

  const { domain, name, api_base, web_base, capabilities, description, redirect_uris } = req.body || {}

  if (!domain || !name || !api_base || !web_base) {
    return res.status(400).json({ error: 'domain, name, api_base, and web_base are required' })
  }

  // Validate URLs
  const apiBaseResult = forumUrlSchema.safeParse(api_base)
  if (!apiBaseResult.success) {
    return res.status(400).json({ error: `api_base: ${apiBaseResult.error.issues[0].message}` })
  }
  const webBaseResult = forumUrlSchema.safeParse(web_base)
  if (!webBaseResult.success) {
    return res.status(400).json({ error: `web_base: ${webBaseResult.error.issues[0].message}` })
  }

  const supabase = getHubSupabase()

  // Enforce forum registration quota (max 5 per user)
  const { count: forumCount } = await supabase
    .from('forumline_forums')
    .select('id', { count: 'exact', head: true })
    .eq('owner_id', user.id)

  if ((forumCount ?? 0) >= 5) {
    return res.status(403).json({ error: 'Maximum of 5 forums per user' })
  }

  // Check if domain already registered
  const { data: existing } = await supabase
    .from('forumline_forums')
    .select('id')
    .eq('domain', domain)
    .single()

  if (existing) {
    return res.status(409).json({ error: 'Forum with this domain is already registered' })
  }

  // Create forum entry
  const { data: forum, error: forumError } = await supabase
    .from('forumline_forums')
    .insert({
      domain,
      name,
      api_base,
      web_base,
      capabilities: capabilities || [],
      description: description || null,
      owner_id: user.id,
      approved: false,
    })
    .select('id')
    .single()

  if (forumError || !forum) {
    return res.status(500).json({ error: 'Failed to register forum' })
  }

  // Generate OAuth client credentials
  const clientId = randomBytes(16).toString('hex')
  const clientSecret = randomBytes(32).toString('hex')
  const clientSecretHash = createHash('sha256').update(clientSecret).digest('hex')

  const { error: clientError } = await supabase
    .from('forumline_oauth_clients')
    .insert({
      forum_id: forum.id,
      client_id: clientId,
      client_secret_hash: clientSecretHash,
      redirect_uris: redirect_uris || [`${web_base}/api/forumline/auth/callback`],
    })

  if (clientError) {
    // Rollback forum creation
    await supabase.from('forumline_forums').delete().eq('id', forum.id)
    return res.status(500).json({ error: 'Failed to create OAuth credentials' })
  }

  return res.status(201).json({
    forum_id: forum.id,
    client_id: clientId,
    client_secret: clientSecret,
    approved: false,
    message: 'Forum registered. OAuth credentials generated. Forum requires approval before appearing in public listings.',
  })
}
