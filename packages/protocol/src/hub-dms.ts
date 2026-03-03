// ============================================================================
// Hub Direct Messages — Cross-forum DM types
// ============================================================================

/** A direct message stored on Forumline Central Services */
export interface HubDirectMessage {
  id: string
  sender_id: string
  recipient_id: string
  content: string
  read: boolean
  created_at: string
}

/** A hub DM conversation summary */
export interface HubDmConversation {
  recipientId: string
  recipientName: string
  recipientAvatarUrl: string | null
  lastMessage: string
  lastMessageTime: string
  unreadCount: number
}

/** A hub user profile (search result) */
export interface HubProfile {
  id: string
  username: string
  display_name: string
  avatar_url: string | null
}
