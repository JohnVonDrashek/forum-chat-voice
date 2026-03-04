import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getHubSupabase, getAuthenticatedUser } from '../_lib/supabase.js'
import { searchProfiles } from '../_lib/services/profiles.js'

/**
 * GET /api/profiles/search?q=alice
 * Search hub profiles by username or display name.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const user = await getAuthenticatedUser(req, res)
  if (!user) return

  const q = (req.query.q as string || '').trim()
  if (!q) {
    return res.status(400).json({ error: 'q parameter is required' })
  }

  const supabase = getHubSupabase()
  const { data, error } = await searchProfiles(supabase, q, user.id)

  if (error) {
    return res.status(500).json({ error })
  }

  return res.status(200).json(data)
}
