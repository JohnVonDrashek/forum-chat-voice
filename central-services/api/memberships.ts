import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getHubSupabase, getAuthenticatedUser } from './_lib/supabase.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const user = await getAuthenticatedUser(req, res)
  if (!user) return

  const supabase = getHubSupabase()

  // POST — update forum auth state for a membership
  if (req.method === 'POST') {
    const { forum_domain, authed } = req.body as { forum_domain?: string; authed?: boolean }
    if (!forum_domain || typeof authed !== 'boolean') {
      return res.status(400).json({ error: 'Missing forum_domain or authed' })
    }

    const { data: forum, error: forumError } = await supabase
      .from('forumline_forums')
      .select('id')
      .eq('domain', forum_domain)
      .single()

    if (forumError || !forum) {
      return res.status(404).json({ error: 'Forum not found' })
    }

    const { error } = await supabase
      .from('forumline_memberships')
      .update({ forum_authed_at: authed ? new Date().toISOString() : null })
      .eq('user_id', user.id)
      .eq('forum_id', forum.id)

    if (error) {
      return res.status(500).json({ error: 'Failed to update auth state' })
    }

    return res.status(200).json({ ok: true })
  }

  // PUT — toggle notification mute for a forum
  if (req.method === 'PUT') {
    const { forum_domain, muted } = req.body as { forum_domain?: string; muted?: boolean }
    if (!forum_domain || typeof muted !== 'boolean') {
      return res.status(400).json({ error: 'Missing forum_domain or muted' })
    }

    const { data: forum } = await supabase
      .from('forumline_forums')
      .select('id')
      .eq('domain', forum_domain)
      .single()

    if (!forum) return res.status(404).json({ error: 'Forum not found' })

    const { error } = await supabase
      .from('forumline_memberships')
      .update({ notifications_muted: muted })
      .eq('user_id', user.id)
      .eq('forum_id', forum.id)

    if (error) return res.status(500).json({ error: 'Failed to update mute state' })
    return res.status(200).json({ ok: true })
  }

  // GET — list memberships
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { data: memberships, error } = await supabase
    .from('forumline_memberships')
    .select(`
      id,
      joined_at,
      forum_authed_at,
      notifications_muted,
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
    forum_authed_at: m.forum_authed_at,
    notifications_muted: m.notifications_muted ?? false,
  }))

  return res.status(200).json(mapped)
}
