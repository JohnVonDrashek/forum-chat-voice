import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getHubSupabase, getAuthenticatedUser, handleCors } from '../_lib/supabase'

/**
 * GET /api/dms
 * List DM conversations for the authenticated user.
 * Returns conversations grouped by the other user, with last message and unread count.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleCors(req, res)) return

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const user = await getAuthenticatedUser(req, res)
  if (!user) return

  const supabase = getHubSupabase()

  // Fetch all DMs where user is sender or recipient
  const { data: messages, error } = await supabase
    .from('hub_direct_messages')
    .select('id, sender_id, recipient_id, content, read, created_at')
    .or(`sender_id.eq.${user.id},recipient_id.eq.${user.id}`)
    .order('created_at', { ascending: false })

  if (error) {
    return res.status(500).json({ error: 'Failed to fetch conversations' })
  }

  if (!messages || messages.length === 0) {
    return res.status(200).json([])
  }

  // Group by the other user
  const conversationMap = new Map<string, {
    recipientId: string
    lastMessage: string
    lastMessageTime: string
    unreadCount: number
  }>()

  for (const msg of messages) {
    const otherId = msg.sender_id === user.id ? msg.recipient_id : msg.sender_id
    if (!conversationMap.has(otherId)) {
      conversationMap.set(otherId, {
        recipientId: otherId,
        lastMessage: msg.content,
        lastMessageTime: msg.created_at,
        unreadCount: 0,
      })
    }
    // Count unread messages sent TO the current user
    if (msg.recipient_id === user.id && !msg.read) {
      const conv = conversationMap.get(otherId)!
      conv.unreadCount++
    }
  }

  // Fetch profiles for all conversation partners
  const otherIds = Array.from(conversationMap.keys())
  const { data: profiles } = await supabase
    .from('hub_profiles')
    .select('id, username, display_name, avatar_url')
    .in('id', otherIds)

  const profileMap = new Map(
    (profiles || []).map(p => [p.id, p])
  )

  // Build response matching local DM conversation shape
  const conversations = otherIds.map(id => {
    const conv = conversationMap.get(id)!
    const profile = profileMap.get(id)
    return {
      recipientId: conv.recipientId,
      recipientName: profile?.display_name || profile?.username || 'Unknown',
      recipientAvatarUrl: profile?.avatar_url || null,
      lastMessage: conv.lastMessage,
      lastMessageTime: conv.lastMessageTime,
      unreadCount: conv.unreadCount,
    }
  })

  // Sort by last message time (newest first)
  conversations.sort((a, b) =>
    new Date(b.lastMessageTime).getTime() - new Date(a.lastMessageTime).getTime()
  )

  return res.status(200).json(conversations)
}
