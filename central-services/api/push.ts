import type { VercelRequest, VercelResponse } from '@vercel/node'
import webpush from 'web-push'
import { getHubSupabase, getAuthenticatedUser } from './_lib/supabase.js'

const VAPID_SUBJECT = process.env.VAPID_SUBJECT!
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY!
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY!

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)

/**
 * POST /api/push?action=subscribe — register a push subscription (authed user)
 * DELETE /api/push?action=subscribe — unregister a push subscription (authed user)
 * POST /api/push?action=notify — send push notification (server-to-server, service key auth)
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const action = req.query.action as string

  if (action === 'notify' && req.method === 'POST') {
    return handleNotify(req, res)
  }

  if (action === 'subscribe') {
    return handleSubscribe(req, res)
  }

  return res.status(400).json({ error: 'Missing or invalid action query param' })
}

async function handleSubscribe(req: VercelRequest, res: VercelResponse) {
  const user = await getAuthenticatedUser(req, res)
  if (!user) return

  const supabase = getHubSupabase()

  if (req.method === 'POST') {
    const { endpoint, keys } = req.body as {
      endpoint?: string
      keys?: { p256dh?: string; auth?: string }
    }

    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return res.status(400).json({ error: 'Missing subscription fields' })
    }

    const { error } = await supabase
      .from('push_subscriptions')
      .upsert(
        { user_id: user.id, endpoint, p256dh: keys.p256dh, auth: keys.auth },
        { onConflict: 'user_id,endpoint' }
      )

    if (error) return res.status(500).json({ error: error.message })
    return res.json({ ok: true })
  }

  if (req.method === 'DELETE') {
    const { endpoint } = req.body as { endpoint?: string }
    if (!endpoint) return res.status(400).json({ error: 'Missing endpoint' })

    const { error } = await supabase
      .from('push_subscriptions')
      .delete()
      .eq('user_id', user.id)
      .eq('endpoint', endpoint)

    if (error) return res.status(500).json({ error: error.message })
    return res.json({ ok: true })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}

async function handleNotify(req: VercelRequest, res: VercelResponse) {
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authorization' })
  }

  const token = authHeader.slice(7)
  const serviceKey = process.env.HUB_SUPABASE_SERVICE_ROLE_KEY

  if (token !== serviceKey) {
    const supabase = getHubSupabase()
    const { data: client } = await supabase
      .from('forumline_oauth_clients')
      .select('id')
      .eq('client_secret_hash', token)
      .single()

    if (!client) {
      return res.status(401).json({ error: 'Invalid authorization' })
    }
  }

  const { forumline_id, user_id, title, body, link, forum_domain } = req.body as {
    forumline_id?: string
    user_id?: string
    title: string
    body: string
    link?: string
    forum_domain?: string
  }

  if (!title || !body) {
    return res.status(400).json({ error: 'Missing title or body' })
  }

  const supabase = getHubSupabase()

  let targetUserId = user_id
  if (!targetUserId && forumline_id) {
    const { data: profile } = await supabase
      .from('hub_profiles')
      .select('id')
      .eq('id', forumline_id)
      .single()

    if (!profile) return res.status(404).json({ error: 'User not found' })
    targetUserId = profile.id
  }

  if (!targetUserId) {
    return res.status(400).json({ error: 'Missing user_id or forumline_id' })
  }

  // Check if forum is muted
  if (forum_domain) {
    const { data: forum } = await supabase
      .from('forumline_forums')
      .select('id')
      .eq('domain', forum_domain)
      .single()

    if (forum) {
      const { data: membership } = await supabase
        .from('forumline_memberships')
        .select('notifications_muted')
        .eq('user_id', targetUserId)
        .eq('forum_id', forum.id)
        .single()

      if (membership?.notifications_muted) {
        return res.json({ ok: true, skipped: 'forum_muted' })
      }
    }
  }

  const { data: subscriptions } = await supabase
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth')
    .eq('user_id', targetUserId)

  if (!subscriptions || subscriptions.length === 0) {
    return res.json({ ok: true, sent: 0 })
  }

  const payload = JSON.stringify({ title, body, link, forum_domain })

  let sent = 0
  const staleEndpoints: string[] = []

  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload
      )
      sent++
    } catch (err: any) {
      if (err.statusCode === 410 || err.statusCode === 404) {
        staleEndpoints.push(sub.endpoint)
      } else {
        console.error('[Hub:PushNotify] Failed to send:', err.statusCode, err.body)
      }
    }
  }

  if (staleEndpoints.length > 0) {
    await supabase
      .from('push_subscriptions')
      .delete()
      .eq('user_id', targetUserId)
      .in('endpoint', staleEndpoints)
  }

  return res.json({ ok: true, sent })
}
