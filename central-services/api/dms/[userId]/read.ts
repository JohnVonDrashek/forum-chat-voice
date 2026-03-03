import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getHubSupabase, getAuthenticatedUser, handleCors } from '../../_lib/supabase'

/**
 * POST /api/dms/:userId/read
 * Mark all messages from a specific user as read.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleCors(req, res)) return

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const user = await getAuthenticatedUser(req, res)
  if (!user) return

  const { userId } = req.query as { userId: string }
  if (!userId) {
    return res.status(400).json({ error: 'userId is required' })
  }

  const supabase = getHubSupabase()

  const { error } = await supabase
    .from('hub_direct_messages')
    .update({ read: true })
    .eq('sender_id', userId)
    .eq('recipient_id', user.id)
    .eq('read', false)

  if (error) {
    return res.status(500).json({ error: 'Failed to mark messages as read' })
  }

  return res.status(200).json({ success: true })
}
