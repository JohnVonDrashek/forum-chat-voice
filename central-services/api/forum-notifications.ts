import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getHubSupabase, getAuthenticatedUser } from './_lib/supabase.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'PUT') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const user = await getAuthenticatedUser(req, res)
  if (!user) return

  const { forum_domain, muted } = req.body as { forum_domain?: string; muted?: boolean }
  if (!forum_domain || typeof muted !== 'boolean') {
    return res.status(400).json({ error: 'Missing forum_domain or muted' })
  }

  const supabase = getHubSupabase()

  const { data: forum } = await supabase
    .from('forumline_forums')
    .select('id')
    .eq('domain', forum_domain)
    .single()

  if (!forum) {
    return res.status(404).json({ error: 'Forum not found' })
  }

  const { error } = await supabase
    .from('forumline_memberships')
    .update({ notifications_muted: muted })
    .eq('user_id', user.id)
    .eq('forum_id', forum.id)

  if (error) {
    return res.status(500).json({ error: 'Failed to update mute state' })
  }

  return res.status(200).json({ ok: true })
}
