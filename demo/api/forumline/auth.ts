import type { VercelRequest, VercelResponse } from '@vercel/node'
import crypto from 'crypto'
import { createClient } from '@supabase/supabase-js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const linkToken = req.query.link_token as string | undefined

  if (linkToken) {
    // "Connect from Settings" flow — verify the user's session and set a link cookie
    const supabaseUrl = process.env.VITE_SUPABASE_URL!
    const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY!
    const sb = createClient(supabaseUrl, supabaseAnonKey)
    const { data: { user }, error } = await sb.auth.getUser(linkToken)

    if (error || !user) {
      const siteUrl = process.env.VITE_SITE_URL || 'https://forum-chat-voice.vercel.app'
      return res.redirect(302, `${siteUrl}/settings?error=invalid_session`)
    }

    // Build the hub authorize URL manually (same as SDK) so we can set both cookies
    const hubUrl = process.env.FORUMLINE_HUB_URL!
    const clientId = process.env.FORUMLINE_CLIENT_ID!
    const siteUrl = process.env.VITE_SITE_URL || 'https://forum-chat-voice.vercel.app'
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

  // Normal sign-in flow — inline the redirect with SameSite=None for iframe compat
  const hubUrl = process.env.FORUMLINE_HUB_URL!
  const clientId = process.env.FORUMLINE_CLIENT_ID!
  const siteUrl = process.env.VITE_SITE_URL || 'https://forum-chat-voice.vercel.app'
  const state = crypto.randomBytes(16).toString('hex')

  const authUrl = new URL(`${hubUrl}/api/oauth/authorize`)
  authUrl.searchParams.set('client_id', clientId)
  authUrl.searchParams.set('redirect_uri', `${siteUrl}/api/forumline/auth/callback`)
  authUrl.searchParams.set('state', state)

  // Pass hub_token if provided (user already authenticated on the hub)
  const hubToken = req.query.hub_token as string | undefined
  if (hubToken) {
    authUrl.searchParams.set('access_token', hubToken)
  }

  res.setHeader('Set-Cookie', `forumline_state=${state}; Path=/; HttpOnly; SameSite=None; Secure; Max-Age=600`)
  return res.redirect(302, authUrl.toString())
}
