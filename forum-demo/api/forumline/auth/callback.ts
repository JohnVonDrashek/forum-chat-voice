import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { parseCookies } from '@johnvondrashek/forumline-server-sdk'
import { getForumlineServer } from '../../_lib/forumline-server.js'
import { adaptRequest, adaptResponse } from '../../_lib/vercel-adapter.js'

const siteUrl = process.env.VITE_SITE_URL || 'https://forum-chat-voice.vercel.app'

/**
 * Handle account linking flow (user clicked "Connect to Forumline" from Settings).
 * Instead of creating a new user, we update the existing user's forumline_id.
 */
async function handleLinkFlow(req: VercelRequest, res: VercelResponse, linkUid: string) {
  const cookies = parseCookies(req.headers.cookie || '')

  // Validate CSRF state
  const { code, state } = req.query as Record<string, string>
  if (!code || !state) {
    return res.status(400).json({ error: 'Missing code or state parameter' })
  }
  if (cookies['forumline_state'] !== state) {
    return res.status(400).json({ error: 'State mismatch — possible CSRF attack' })
  }

  // Exchange code for hub tokens
  const hubUrl = process.env.FORUMLINE_HUB_URL!
  const clientId = process.env.FORUMLINE_CLIENT_ID!
  const clientSecret = process.env.FORUMLINE_CLIENT_SECRET!
  const redirectUri = `${siteUrl}/api/forumline/auth/callback`

  const tokenResponse = await fetch(`${hubUrl}/api/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
    }),
  })

  if (!tokenResponse.ok) {
    console.error('[Forumline:Link] Token exchange failed:', await tokenResponse.text())
    return res.redirect(302, `${siteUrl}/settings?error=link_failed`)
  }

  const tokenData = await tokenResponse.json()
  const { identity, identity_token, hub_access_token } = tokenData

  if (!identity?.forumline_id || !identity?.username) {
    console.error('[Forumline:Link] Invalid identity from hub')
    return res.redirect(302, `${siteUrl}/settings?error=link_failed`)
  }

  // Check that forumline_id isn't already linked to a different local account
  const supabaseUrl = process.env.VITE_SUPABASE_URL!
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
  const supabase = createClient(supabaseUrl, serviceRoleKey)

  const { data: existingProfile } = await supabase
    .from('profiles')
    .select('id')
    .eq('forumline_id', identity.forumline_id)
    .single()

  if (existingProfile && existingProfile.id !== linkUid) {
    console.error('[Forumline:Link] forumline_id already linked to another account')
    return res.redirect(302, `${siteUrl}/settings?error=already_linked`)
  }

  // Link: update the user's profile with the forumline_id
  const { error: updateError } = await supabase
    .from('profiles')
    .update({ forumline_id: identity.forumline_id })
    .eq('id', linkUid)

  if (updateError) {
    console.error('[Forumline:Link] Profile update failed:', updateError)
    return res.redirect(302, `${siteUrl}/settings?error=link_failed`)
  }

  // Set cookies (same as SDK callback) and clear the link cookie
  const setCookies = [
    'forumline_state=; Path=/; HttpOnly; SameSite=None; Secure; Max-Age=0',
    'forumline_link_uid=; Path=/; HttpOnly; SameSite=None; Secure; Max-Age=0',
    `forumline_identity=${identity_token}; Path=/; HttpOnly; SameSite=None; Secure; Max-Age=3600`,
    `forumline_user_id=${linkUid}; Path=/; HttpOnly; SameSite=None; Secure; Max-Age=3600`,
  ]
  if (hub_access_token) {
    setCookies.push(`hub_access_token=${hub_access_token}; Path=/; HttpOnly; SameSite=None; Secure; Max-Age=3600`)
  }
  res.setHeader('Set-Cookie', setCookies)

  return res.redirect(302, `${siteUrl}/settings?forumline_linked=true`)
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Check for account linking flow
  const cookies = parseCookies(req.headers.cookie || '')
  const linkUid = cookies['forumline_link_uid']

  if (linkUid) {
    return handleLinkFlow(req, res, linkUid)
  }

  // Normal sign-in flow
  const server = getForumlineServer()
  try {
    return await server.authCallbackHandler()(adaptRequest(req), adaptResponse(res))
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'EmailCollisionError') {
      return res.redirect(302, `${siteUrl}/login?error=email_exists`)
    }
    console.error('[Forumline:Callback] Error:', err)
    return res.redirect(302, `${siteUrl}/login?error=auth_failed`)
  }
}
