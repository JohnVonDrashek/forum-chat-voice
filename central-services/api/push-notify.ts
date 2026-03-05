import type { VercelRequest, VercelResponse } from '@vercel/node'
import webpush from 'web-push'
import { getHubSupabase } from './_lib/supabase.js'

const VAPID_SUBJECT = process.env.VAPID_SUBJECT!
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY!
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY!

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Authenticate: accept hub service role key or forum client credentials
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authorization' })
  }

  const token = authHeader.slice(7)
  const serviceKey = process.env.HUB_SUPABASE_SERVICE_ROLE_KEY

  // Simple shared-secret auth: the forum sends the hub's service role key
  // (configured in the forum's env as HUB_PUSH_SECRET)
  // OR a valid forum client_secret
  if (token !== serviceKey) {
    // Check if it's a valid forum client_secret
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

  // Resolve the hub user_id from forumline_id if needed
  let targetUserId = user_id
  if (!targetUserId && forumline_id) {
    const { data: profile } = await supabase
      .from('hub_profiles')
      .select('id')
      .eq('id', forumline_id)
      .single()

    if (!profile) {
      return res.status(404).json({ error: 'User not found' })
    }
    targetUserId = profile.id
  }

  if (!targetUserId) {
    return res.status(400).json({ error: 'Missing user_id or forumline_id' })
  }

  // Check if forum is muted for this user
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

  // Get all push subscriptions for this user
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
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        },
        payload
      )
      sent++
    } catch (err: any) {
      // 410 Gone or 404 = subscription expired, clean it up
      if (err.statusCode === 410 || err.statusCode === 404) {
        staleEndpoints.push(sub.endpoint)
      } else {
        console.error('[Hub:PushNotify] Failed to send:', err.statusCode, err.body)
      }
    }
  }

  // Clean up stale subscriptions
  if (staleEndpoints.length > 0) {
    await supabase
      .from('push_subscriptions')
      .delete()
      .eq('user_id', targetUserId)
      .in('endpoint', staleEndpoints)
  }

  return res.json({ ok: true, sent })
}
