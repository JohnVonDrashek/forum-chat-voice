import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getHubSupabase, getAuthenticatedUser, handleCors } from '../_lib/supabase'

/**
 * GET  /api/dms/:userId — Fetch messages with a specific user
 * POST /api/dms/:userId — Send a message to a specific user
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleCors(req, res)) return

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
  _req: VercelRequest,
  res: VercelResponse,
  supabase: ReturnType<typeof getHubSupabase>,
  currentUserId: string,
  otherUserId: string
) {
  const { data: messages, error } = await supabase
    .from('hub_direct_messages')
    .select('id, sender_id, recipient_id, content, read, created_at')
    .or(
      `and(sender_id.eq.${currentUserId},recipient_id.eq.${otherUserId}),` +
      `and(sender_id.eq.${otherUserId},recipient_id.eq.${currentUserId})`
    )
    .order('created_at', { ascending: true })

  if (error) {
    return res.status(500).json({ error: 'Failed to fetch messages' })
  }

  return res.status(200).json(messages || [])
}

async function handlePost(
  req: VercelRequest,
  res: VercelResponse,
  supabase: ReturnType<typeof getHubSupabase>,
  currentUserId: string,
  otherUserId: string
) {
  const { content } = req.body || {}

  if (!content || typeof content !== 'string' || !content.trim()) {
    return res.status(400).json({ error: 'content is required' })
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
