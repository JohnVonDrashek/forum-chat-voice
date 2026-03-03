import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createHash } from 'crypto'
import jwt from 'jsonwebtoken'
import { getHubSupabase, getHubSupabaseAnon, handleCors } from '../_lib/supabase'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleCors(req, res)) return

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { code, client_id, client_secret, redirect_uri } = req.body || {}

  if (!code || !client_id || !client_secret) {
    return res.status(400).json({ error: 'code, client_id, and client_secret are required' })
  }

  const supabase = getHubSupabase()

  // Validate client credentials
  const secretHash = createHash('sha256').update(client_secret).digest('hex')

  const { data: client } = await supabase
    .from('forumline_oauth_clients')
    .select('id, forum_id, client_secret_hash')
    .eq('client_id', client_id)
    .single()

  if (!client || client.client_secret_hash !== secretHash) {
    return res.status(401).json({ error: 'Invalid client credentials' })
  }

  // Validate and consume auth code
  const { data: authCode } = await supabase
    .from('forumline_auth_codes')
    .select('*')
    .eq('code', code)
    .eq('forum_id', client.forum_id)
    .eq('used', false)
    .single()

  if (!authCode) {
    return res.status(400).json({ error: 'Invalid or expired authorization code' })
  }

  // Check expiry
  if (new Date(authCode.expires_at) < new Date()) {
    return res.status(400).json({ error: 'Authorization code expired' })
  }

  // Check redirect_uri matches if provided
  if (redirect_uri && authCode.redirect_uri !== redirect_uri) {
    return res.status(400).json({ error: 'redirect_uri mismatch' })
  }

  // Mark code as used
  await supabase
    .from('forumline_auth_codes')
    .update({ used: true })
    .eq('id', authCode.id)

  // Fetch user profile
  const { data: profile } = await supabase
    .from('hub_profiles')
    .select('*')
    .eq('id', authCode.user_id)
    .single()

  if (!profile) {
    return res.status(500).json({ error: 'User profile not found' })
  }

  // Build ForumlineIdentity
  const identity = {
    forumline_id: profile.id,
    username: profile.username,
    display_name: profile.display_name,
    avatar_url: profile.avatar_url || '',
    bio: profile.bio || undefined,
  }

  // Sign a JWT containing the identity
  const jwtSecret = process.env.HUB_JWT_SECRET || process.env.HUB_SUPABASE_SERVICE_ROLE_KEY!
  const identityToken = jwt.sign(
    { identity, forum_id: client.forum_id },
    jwtSecret,
    { expiresIn: '1h', issuer: 'forumline-central-services' }
  )

  // Generate a hub Supabase access token for the user
  // This allows the forum frontend to call hub APIs and connect to hub Realtime
  let hubAccessToken: string | undefined
  try {
    // Get the user's email from auth system
    const { data: authUser } = await supabase.auth.admin.getUserById(authCode.user_id)
    const email = authUser?.user?.email
    if (email) {
      const { data: linkData } = await supabase.auth.admin.generateLink({
        type: 'magiclink',
        email,
      })

      if (linkData?.properties?.hashed_token) {
        const anonSupabase = getHubSupabaseAnon()
        const { data: otpData } = await anonSupabase.auth.verifyOtp({
          token_hash: linkData.properties.hashed_token,
          type: 'magiclink',
        })
        hubAccessToken = otpData?.session?.access_token
      }
    }
  } catch {
    // Hub access token generation is best-effort — DMs won't work without it
    // but identity federation still works
  }

  return res.status(200).json({
    identity_token: identityToken,
    identity,
    token_type: 'Bearer',
    expires_in: 3600,
    hub_access_token: hubAccessToken,
  })
}
