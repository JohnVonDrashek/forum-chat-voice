import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getHubSupabase, getAuthenticatedUser } from '../_lib/supabase.js'
import { listConversations } from '../_lib/services/dms.js'

/**
 * GET /api/dms
 * List DM conversations for the authenticated user.
 * Returns conversations grouped by the other user, with last message and unread count.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const user = await getAuthenticatedUser(req, res)
  if (!user) return

  const supabase = getHubSupabase()
  const { data, error } = await listConversations(supabase, user.id)

  if (error) {
    return res.status(500).json({ error })
  }

  return res.status(200).json(data)
}
