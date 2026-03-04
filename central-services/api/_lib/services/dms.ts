import type { SupabaseClient } from '@supabase/supabase-js'
import { getProfilesByIds } from './profiles.js'

export interface DirectMessage {
  id: string
  sender_id: string
  recipient_id: string
  content: string
  read: boolean
  created_at: string
}

export interface Conversation {
  recipientId: string
  recipientName: string
  recipientAvatarUrl: string | null
  lastMessage: string
  lastMessageTime: string
  unreadCount: number
}

/**
 * List DM conversations for a user, grouped by conversation partner,
 * with last message and unread count.
 */
export async function listConversations(
  supabase: SupabaseClient,
  userId: string
): Promise<{ data: Conversation[]; error: string | null }> {
  const { data: messages, error } = await supabase
    .from('hub_direct_messages')
    .select('id, sender_id, recipient_id, content, read, created_at')
    .or(`sender_id.eq.${userId},recipient_id.eq.${userId}`)
    .order('created_at', { ascending: false })
    .limit(500)

  if (error) {
    return { data: [], error: 'Failed to fetch conversations' }
  }

  if (!messages || messages.length === 0) {
    return { data: [], error: null }
  }

  // Group by the other user
  const conversationMap = new Map<string, {
    recipientId: string
    lastMessage: string
    lastMessageTime: string
    unreadCount: number
  }>()

  for (const msg of messages) {
    const otherId = msg.sender_id === userId ? msg.recipient_id : msg.sender_id
    if (!conversationMap.has(otherId)) {
      conversationMap.set(otherId, {
        recipientId: otherId,
        lastMessage: msg.content,
        lastMessageTime: msg.created_at,
        unreadCount: 0,
      })
    }
    if (msg.recipient_id === userId && !msg.read) {
      const conv = conversationMap.get(otherId)!
      conv.unreadCount++
    }
  }

  // Fetch profiles for all conversation partners
  const otherIds = Array.from(conversationMap.keys())
  const profileMap = await getProfilesByIds(supabase, otherIds)

  // Build response sorted by newest first
  const conversations: Conversation[] = otherIds
    .map(id => {
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
    .sort((a, b) =>
      new Date(b.lastMessageTime).getTime() - new Date(a.lastMessageTime).getTime()
    )

  return { data: conversations, error: null }
}

/**
 * Fetch messages between two users with pagination.
 * Returns messages in chronological order (oldest first).
 */
export async function getMessages(
  supabase: SupabaseClient,
  currentUserId: string,
  otherUserId: string,
  options: { limit?: number; before?: string } = {}
): Promise<{ data: DirectMessage[]; error: string | null }> {
  const limit = Math.min(options.limit || 50, 100)

  let query = supabase
    .from('hub_direct_messages')
    .select('id, sender_id, recipient_id, content, read, created_at')
    .or(
      `and(sender_id.eq.${currentUserId},recipient_id.eq.${otherUserId}),` +
      `and(sender_id.eq.${otherUserId},recipient_id.eq.${currentUserId})`
    )
    .order('created_at', { ascending: false })
    .limit(limit)

  if (options.before) {
    query = query.lt('id', options.before)
  }

  const { data: messages, error } = await query

  if (error) {
    return { data: [], error: 'Failed to fetch messages' }
  }

  // Reverse to chronological order for client display
  return { data: (messages || []).reverse(), error: null }
}

/**
 * Verify a recipient exists and send a direct message.
 */
export async function sendMessage(
  supabase: SupabaseClient,
  senderId: string,
  recipientId: string,
  content: string
): Promise<{ data: DirectMessage | null; error: string | null; notFound?: boolean }> {
  // Verify the recipient exists
  const { data: recipient } = await supabase
    .from('hub_profiles')
    .select('id')
    .eq('id', recipientId)
    .single()

  if (!recipient) {
    return { data: null, error: 'Recipient not found', notFound: true }
  }

  const { data: message, error } = await supabase
    .from('hub_direct_messages')
    .insert({
      sender_id: senderId,
      recipient_id: recipientId,
      content,
    })
    .select('id, sender_id, recipient_id, content, read, created_at')
    .single()

  if (error) {
    return { data: null, error: 'Failed to send message' }
  }

  return { data: message, error: null }
}
