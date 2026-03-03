import { createClient } from '@supabase/supabase-js'
import type { VercelRequest, VercelResponse } from '@vercel/node'

export function getHubSupabase() {
  const url = process.env.HUB_SUPABASE_URL
  const serviceKey = process.env.HUB_SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    throw new Error('Hub Supabase not configured')
  }
  return createClient(url, serviceKey)
}

export function getHubSupabaseAnon() {
  const url = process.env.HUB_SUPABASE_URL
  const anonKey = process.env.HUB_SUPABASE_ANON_KEY
  if (!url || !anonKey) {
    throw new Error('Hub Supabase not configured')
  }
  return createClient(url, anonKey)
}

/** Extract and validate Bearer JWT, returning the authenticated user */
export async function getAuthenticatedUser(req: VercelRequest, res: VercelResponse) {
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing authorization token' })
    return null
  }

  const jwt = authHeader.slice(7)
  const supabase = getHubSupabaseAnon()
  const { data: { user }, error } = await supabase.auth.getUser(jwt)
  if (error || !user) {
    res.status(401).json({ error: 'Invalid auth token' })
    return null
  }

  return user
}

/** Handle CORS preflight and return true if the request was handled */
export function handleCors(req: VercelRequest, res: VercelResponse): boolean {
  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return true
  }
  return false
}
