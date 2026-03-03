import type { VercelRequest, VercelResponse } from '@vercel/node'
import { randomBytes } from 'crypto'

/**
 * GET /api/forumline/auth
 * Redirects the user to the Forumline Central Services OAuth authorization endpoint.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const hubUrl = process.env.FORUMLINE_HUB_URL
  const clientId = process.env.FORUMLINE_CLIENT_ID
  if (!hubUrl || !clientId) {
    return res.status(500).json({ error: 'Forumline Central Services not configured' })
  }

  const state = randomBytes(16).toString('hex')
  const redirectUri = `${process.env.VITE_SITE_URL || 'https://forum-chat-voice.vercel.app'}/api/forumline/auth/callback`

  const authorizeUrl = new URL(`${hubUrl}/api/oauth/authorize`)
  authorizeUrl.searchParams.set('client_id', clientId)
  authorizeUrl.searchParams.set('redirect_uri', redirectUri)
  authorizeUrl.searchParams.set('state', state)

  // Pass access_token if provided (for users already authenticated on the hub)
  if (req.query.hub_token) {
    authorizeUrl.searchParams.set('access_token', req.query.hub_token as string)
  }

  // Set state in a cookie so we can verify on callback
  res.setHeader('Set-Cookie', `forumline_state=${state}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=600`)

  return res.redirect(302, authorizeUrl.toString())
}
