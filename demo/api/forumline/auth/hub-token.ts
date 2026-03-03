import type { VercelRequest, VercelResponse } from '@vercel/node'

/**
 * GET /api/forumline/auth/hub-token
 * Returns the hub Supabase access token stored in the httpOnly cookie.
 * The frontend uses this to call hub DM APIs and connect to hub Realtime.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
  if (req.method === 'OPTIONS') return res.status(204).end()

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const cookies = parseCookies(req.headers.cookie || '')
  const hubAccessToken = cookies.hub_access_token

  if (!hubAccessToken) {
    return res.status(200).json({ hub_access_token: null })
  }

  return res.status(200).json({ hub_access_token: hubAccessToken })
}

function parseCookies(cookieHeader: string): Record<string, string> {
  const cookies: Record<string, string> = {}
  for (const pair of cookieHeader.split(';')) {
    const [key, ...rest] = pair.trim().split('=')
    if (key) cookies[key] = rest.join('=')
  }
  return cookies
}
