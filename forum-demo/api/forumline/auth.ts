import type { VercelRequest, VercelResponse } from '@vercel/node'
import crypto from 'crypto'
import { createClient } from '@supabase/supabase-js'
import { createOrLinkUser, afterAuth } from '../_lib/forumline-server.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const linkToken = req.query.link_token as string | undefined

  if (linkToken) {
    // "Connect from Settings" flow — verify the user's session and set a link cookie
    const supabaseUrl = (process.env.VITE_SUPABASE_URL || '').trim()
    const supabaseAnonKey = (process.env.VITE_SUPABASE_ANON_KEY || '').trim()
    const sb = createClient(supabaseUrl, supabaseAnonKey)
    const { data: { user }, error } = await sb.auth.getUser(linkToken)

    if (error || !user) {
      const siteUrl = (process.env.VITE_SITE_URL || 'https://demo.forumline.net').trim()
      return res.redirect(302, `${siteUrl}/settings?error=invalid_session`)
    }

    // Build the hub authorize URL manually (same as SDK) so we can set both cookies
    const hubUrl = (process.env.FORUMLINE_HUB_URL || '').trim()
    const clientId = (process.env.FORUMLINE_CLIENT_ID || '').trim()
    const siteUrl = (process.env.VITE_SITE_URL || 'https://demo.forumline.net').trim()
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

  // .trim() all env vars — Vercel env vars can have trailing newlines which
  // break URL construction (e.g. redirect_uri gets \n embedded in it, causing
  // the hub authorize POST to fail and the function to crash with FUNCTION_INVOCATION_FAILED)
  const hubUrl = (process.env.FORUMLINE_HUB_URL || '').trim()
  const clientId = (process.env.FORUMLINE_CLIENT_ID || '').trim()
  const clientSecret = (process.env.FORUMLINE_CLIENT_SECRET || '').trim()
  const siteUrl = (process.env.VITE_SITE_URL || 'https://demo.forumline.net').trim()

  // If hub_token is provided, do the entire OAuth exchange server-side.
  // This avoids redirecting the browser to the hub (which has X-Frame-Options: deny
  // and breaks when loaded inside the ForumWebview iframe).
  const hubToken = req.query.hub_token as string | undefined
  if (hubToken) {
    try {
      console.log('[Forumline:Auth] Starting server-side auth with hub_token')
      const state = crypto.randomBytes(16).toString('hex')
      const redirectUri = `${siteUrl}/api/forumline/auth/callback`

      // Step 1: Call hub authorize endpoint server-side to get auth code
      const authorizeUrl = new URL(`${hubUrl}/api/oauth/authorize`)
      authorizeUrl.searchParams.set('client_id', clientId)
      authorizeUrl.searchParams.set('redirect_uri', redirectUri)
      authorizeUrl.searchParams.set('state', state)

      console.log('[Forumline:Auth] Step 1: Calling hub authorize')
      const authorizeResponse = await fetch(authorizeUrl.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ access_token: hubToken }),
        redirect: 'manual',
      })
      console.log('[Forumline:Auth] Hub authorize response:', authorizeResponse.status, authorizeResponse.type)

      // With redirect: 'manual', Node.js fetch may return status 0 with type 'opaqueredirect'
      // In that case, we need to follow the redirect ourselves
      const location = authorizeResponse.headers.get('location')
      console.log('[Forumline:Auth] Location header:', location)

      if (!location) {
        // If no redirect, try reading the response body for error info
        const body = await authorizeResponse.text()
        console.error('[Forumline:Auth] No redirect from hub authorize. Status:', authorizeResponse.status, 'Body:', body.slice(0, 200))
        return res.redirect(302, `${siteUrl}/login?error=auth_failed`)
      }

      const callbackUrl = new URL(location, authorizeUrl.toString())
      const code = callbackUrl.searchParams.get('code')
      if (!code) {
        console.error('[Forumline:Auth] No code in hub redirect:', location)
        return res.redirect(302, `${siteUrl}/login?error=auth_failed`)
      }

      // Step 2: Exchange code for identity token
      console.log('[Forumline:Auth] Step 2: Exchanging code for token')
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
        const errText = await tokenResponse.text()
        console.error('[Forumline:Auth] Token exchange failed:', tokenResponse.status, errText)
        return res.redirect(302, `${siteUrl}/login?error=auth_failed`)
      }

      const tokenData = await tokenResponse.json()
      const { identity, identity_token, hub_access_token } = tokenData
      console.log('[Forumline:Auth] Step 2 complete. Identity:', identity?.forumline_id, identity?.username)

      if (!identity?.forumline_id || !identity?.username) {
        console.error('[Forumline:Auth] Invalid identity from hub')
        return res.redirect(302, `${siteUrl}/login?error=auth_failed`)
      }

      // Step 3: Create or link local user
      console.log('[Forumline:Auth] Step 3: Creating/linking local user')
      const localUserId = await createOrLinkUser(identity, hub_access_token || null)
      console.log('[Forumline:Auth] Step 3 complete. Local user ID:', localUserId)

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
      console.log('[Forumline:Auth] Step 5: Calling afterAuth')
      const redirectUrl = await afterAuth({ userId: localUserId })
      console.log('[Forumline:Auth] Step 5 complete. Redirect:', redirectUrl?.slice(0, 50))

      if (redirectUrl) {
        return res.redirect(302, redirectUrl)
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
