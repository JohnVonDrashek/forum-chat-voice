import type { VercelRequest, VercelResponse } from '@vercel/node'
import crypto from 'crypto'
import { createClient } from '@supabase/supabase-js'
import { getForumlineServer } from '../_lib/forumline-server.js'
import { adaptRequest, adaptResponse } from '../_lib/vercel-adapter.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const linkToken = req.query.link_token as string | undefined

  if (linkToken) {
    // "Connect from Settings" flow — verify the user's session and set a link cookie
    const supabaseUrl = process.env.VITE_SUPABASE_URL!
    const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY!
    const sb = createClient(supabaseUrl, supabaseAnonKey)
    const { data: { user }, error } = await sb.auth.getUser(linkToken)

    if (error || !user) {
      const siteUrl = process.env.VITE_SITE_URL || 'https://demo.forumline.net'
      return res.redirect(302, `${siteUrl}/settings?error=invalid_session`)
    }

    // Build the hub authorize URL manually (same as SDK) so we can set both cookies
    const hubUrl = process.env.FORUMLINE_HUB_URL!
    const clientId = process.env.FORUMLINE_CLIENT_ID!
    const siteUrl = process.env.VITE_SITE_URL || 'https://demo.forumline.net'
    const state = crypto.randomBytes(16).toString('hex')

    const authUrl = new URL(`${hubUrl}/api/oauth/authorize`)
    authUrl.searchParams.set('client_id', clientId)
    authUrl.searchParams.set('redirect_uri', `${siteUrl}/api/forumline/auth/callback`)
    authUrl.searchParams.set('state', state)

    res.setHeader('Set-Cookie', [
      `forumline_state=${state}; Path=/; HttpOnly; SameSite=None; Secure; Max-Age=600`,
      `forumline_link_uid=${user.id}; Path=/; HttpOnly; SameSite=None; Secure; Max-Age=600`,
    ])
    return res.redirect(302, authUrl.toString())
  }

  const hubUrl = process.env.FORUMLINE_HUB_URL!
  const clientId = process.env.FORUMLINE_CLIENT_ID!
  const clientSecret = process.env.FORUMLINE_CLIENT_SECRET!
  const siteUrl = process.env.VITE_SITE_URL || 'https://demo.forumline.net'

  // If hub_token is provided, do the entire OAuth exchange server-side.
  // This avoids redirecting the browser to the hub (which has X-Frame-Options: deny
  // and breaks when loaded inside the ForumWebview iframe).
  const hubToken = req.query.hub_token as string | undefined
  if (hubToken) {
    try {
      const state = crypto.randomBytes(16).toString('hex')
      const redirectUri = `${siteUrl}/api/forumline/auth/callback`

      // Step 1: Call hub authorize endpoint server-side to get auth code
      const authorizeUrl = new URL(`${hubUrl}/api/oauth/authorize`)
      authorizeUrl.searchParams.set('client_id', clientId)
      authorizeUrl.searchParams.set('redirect_uri', redirectUri)
      authorizeUrl.searchParams.set('state', state)

      const authorizeResponse = await fetch(authorizeUrl.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ access_token: hubToken }),
        redirect: 'manual', // Don't follow the redirect — we need to extract the code
      })

      if (authorizeResponse.status !== 302) {
        console.error('[Forumline:Auth] Hub authorize failed:', authorizeResponse.status)
        return res.redirect(302, `${siteUrl}/login?error=auth_failed`)
      }

      const location = authorizeResponse.headers.get('location')
      if (!location) {
        console.error('[Forumline:Auth] No redirect location from hub authorize')
        return res.redirect(302, `${siteUrl}/login?error=auth_failed`)
      }

      const callbackUrl = new URL(location)
      const code = callbackUrl.searchParams.get('code')
      if (!code) {
        console.error('[Forumline:Auth] No code in hub redirect:', location)
        return res.redirect(302, `${siteUrl}/login?error=auth_failed`)
      }

      // Step 2: Exchange code for identity token
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
        console.error('[Forumline:Auth] Token exchange failed:', await tokenResponse.text())
        return res.redirect(302, `${siteUrl}/login?error=auth_failed`)
      }

      const tokenData = await tokenResponse.json()
      const { identity, identity_token, hub_access_token } = tokenData

      if (!identity?.forumline_id || !identity?.username) {
        console.error('[Forumline:Auth] Invalid identity from hub')
        return res.redirect(302, `${siteUrl}/login?error=auth_failed`)
      }

      // Step 3: Create or link local user (reuse the ForumlineServer config)
      const server = getForumlineServer()
      const localUserId = await server.config.createOrLinkUser!(identity, hub_access_token || null)

      // Step 4: Set cookies and redirect
      const setCookies = [
        `forumline_identity=${identity_token}; Path=/; HttpOnly; SameSite=None; Secure; Max-Age=3600`,
        `forumline_user_id=${localUserId}; Path=/; HttpOnly; SameSite=None; Secure; Max-Age=3600`,
      ]
      if (hub_access_token) {
        setCookies.push(`hub_access_token=${hub_access_token}; Path=/; HttpOnly; SameSite=None; Secure; Max-Age=3600`)
      }
      res.setHeader('Set-Cookie', setCookies)

      // Step 5: Call afterAuth hook for session generation
      if (server.config.afterAuth) {
        const redirectUrl = await server.config.afterAuth({
          userId: localUserId,
          identity,
          hubAccessToken: hub_access_token || null,
          request: adaptRequest(req),
        })
        if (redirectUrl) {
          return res.redirect(302, redirectUrl)
        }
      }

      return res.redirect(302, `${siteUrl}/?forumline_auth=success`)
    } catch (err) {
      console.error('[Forumline:Auth] Server-side auth failed:', err)
      if (err instanceof Error && err.name === 'EmailCollisionError') {
        return res.redirect(302, `${siteUrl}/login?error=email_exists`)
      }
      return res.redirect(302, `${siteUrl}/login?error=auth_failed`)
    }
  }

  // No hub_token — redirect browser to hub authorize page (manual sign-in)
  const state = crypto.randomBytes(16).toString('hex')
  const authUrl = new URL(`${hubUrl}/api/oauth/authorize`)
  authUrl.searchParams.set('client_id', clientId)
  authUrl.searchParams.set('redirect_uri', `${siteUrl}/api/forumline/auth/callback`)
  authUrl.searchParams.set('state', state)

  res.setHeader('Set-Cookie', `forumline_state=${state}; Path=/; HttpOnly; SameSite=None; Secure; Max-Age=600`)
  return res.redirect(302, authUrl.toString())
}
