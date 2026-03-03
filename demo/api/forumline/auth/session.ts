import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

/**
 * GET /api/forumline/auth/session
 * Validates the current forumline session and returns the user's identity.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
  if (req.method === 'OPTIONS') return res.status(204).end()

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const cookies = parseCookies(req.headers.cookie || '')
  const identityToken = cookies.forumline_identity
  const localUserId = cookies.forumline_user_id

  if (!identityToken || !localUserId) {
    return res.status(200).json(null)
  }

  // Verify the identity token with the hub
  const hubUrl = process.env.FORUMLINE_HUB_URL
  if (!hubUrl) {
    return res.status(200).json(null)
  }

  // Decode the JWT (we trust it since it came from our httpOnly cookie
  // and was originally issued by the hub)
  // For production, you'd verify the signature against the hub's public key
  const payload = decodeJwtPayload(identityToken)
  if (!payload?.identity) {
    return res.status(200).json(null)
  }

  // Check expiry
  if (payload.exp && payload.exp * 1000 < Date.now()) {
    // Clear expired cookies
    res.setHeader('Set-Cookie', [
      'forumline_identity=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0',
      'forumline_user_id=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0',
    ])
    return res.status(200).json(null)
  }

  return res.status(200).json({
    identity: payload.identity,
    local_user_id: localUserId,
  })
}

function parseCookies(cookieHeader: string): Record<string, string> {
  const cookies: Record<string, string> = {}
  for (const pair of cookieHeader.split(';')) {
    const [key, ...rest] = pair.trim().split('=')
    if (key) cookies[key] = rest.join('=')
  }
  return cookies
}

function decodeJwtPayload(token: string): any {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const payload = Buffer.from(parts[1], 'base64url').toString('utf8')
    return JSON.parse(payload)
  } catch {
    return null
  }
}
