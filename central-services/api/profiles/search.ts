import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getHubSupabase, getAuthenticatedUser, handleCors } from '../_lib/supabase'

/**
 * GET /api/profiles/search?q=alice
 * Search hub profiles by username or display name.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleCors(req, res)) return

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

  const { data: profiles, error } = await supabase
    .from('hub_profiles')
    .select('id, username, display_name, avatar_url')
    .neq('id', user.id)
    .or(`username.ilike.%${q}%,display_name.ilike.%${q}%`)
    .limit(10)

  if (error) {
    return res.status(500).json({ error: 'Failed to search profiles' })
  }

  return res.status(200).json(profiles || [])
}
