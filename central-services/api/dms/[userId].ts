import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getHubSupabase, getAuthenticatedUser } from '../_lib/supabase.js'
import { rateLimit } from '../_lib/rate-limit.js'
import { messageContentSchema } from '@johnvondrashek/forumline-protocol/validation'

/**
 * GET  /api/dms/:userId — Fetch messages with a specific user
 * POST /api/dms/:userId — Send a message to a specific user
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const user = await getAuthenticatedUser(req, res)
  if (!user) return

  const { userId } = req.query as { userId: string }
  if (!userId) {
    return res.status(400).json({ error: 'userId is required' })
  }

  if (userId === user.id) {
    return res.status(400).json({ error: 'Cannot message yourself' })
  }

  const supabase = getHubSupabase()

  if (req.method === 'GET') {
    return handleGet(req, res, supabase, user.id, userId)
  } else if (req.method === 'POST') {
    return handlePost(req, res, supabase, user.id, userId)
  } else {
    return res.status(405).json({ error: 'Method not allowed' })
  }
}

async function handleGet(
  req: VercelRequest,
  res: VercelResponse,
  supabase: ReturnType<typeof getHubSupabase>,
  currentUserId: string,
  otherUserId: string
) {
  const limit = Math.min(Number(req.query.limit) || 50, 100)
  const before = req.query.before as string | undefined

  let query = supabase
    .from('hub_direct_messages')
    .select('id, sender_id, recipient_id, content, read, created_at')
    .or(
      `and(sender_id.eq.${currentUserId},recipient_id.eq.${otherUserId}),` +
      `and(sender_id.eq.${otherUserId},recipient_id.eq.${currentUserId})`
    )
    .order('created_at', { ascending: false })
    .limit(limit)

  if (before) {
    query = query.lt('id', before)
  }

  const { data: messages, error } = await query

  if (error) {
    return res.status(500).json({ error: 'Failed to fetch messages' })
  }

  // Reverse to chronological order for client display
  return res.status(200).json((messages || []).reverse())
}

async function handlePost(
  req: VercelRequest,
  res: VercelResponse,
  supabase: ReturnType<typeof getHubSupabase>,
  currentUserId: string,
  otherUserId: string
) {
  if (!rateLimit(req, res, { key: 'dm-send', limit: 30, windowMs: 60_000 })) return

  const { content } = req.body || {}

  const contentResult = messageContentSchema.safeParse(content?.trim?.())
  if (!contentResult.success) {
    return res.status(400).json({ error: contentResult.error.issues[0].message })
  }

  // Verify the recipient exists
  const { data: recipient } = await supabase
    .from('hub_profiles')
    .select('id')
    .eq('id', otherUserId)
    .single()

  if (!recipient) {
    return res.status(404).json({ error: 'Recipient not found' })
  }

  const { data: message, error } = await supabase
    .from('hub_direct_messages')
    .insert({
      sender_id: currentUserId,
      recipient_id: otherUserId,
      content: content.trim(),
    })
    .select('id, sender_id, recipient_id, content, read, created_at')
    .single()

  if (error) {
    return res.status(500).json({ error: 'Failed to send message' })
  }

  return res.status(201).json(message)
}
