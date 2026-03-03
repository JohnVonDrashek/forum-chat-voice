import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getHubSupabase, getAuthenticatedUser, handleCors } from './_lib/supabase'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleCors(req, res)) return

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const user = await getAuthenticatedUser(req, res)
  if (!user) return

  const supabase = getHubSupabase()

  const { data: memberships, error } = await supabase
    .from('forumline_memberships')
    .select(`
      id,
      joined_at,
      forumline_forums (
        domain,
        name,
        icon_url
      )
    `)
    .eq('user_id', user.id)
    .order('joined_at', { ascending: false })

  if (error) {
    return res.status(500).json({ error: 'Failed to fetch memberships' })
  }

  const mapped = (memberships || []).map((m: any) => ({
    forum_domain: m.forumline_forums.domain,
    forum_name: m.forumline_forums.name,
    forum_icon_url: m.forumline_forums.icon_url,
    joined_at: m.joined_at,
  }))

  return res.status(200).json(mapped)
}
