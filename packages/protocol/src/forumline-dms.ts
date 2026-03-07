// ============================================================================
// Forumline Direct Messages — Cross-forum DM types
// ============================================================================

/** A direct message stored on Forumline Central Services */
export interface ForumlineDirectMessage {
  id: string
  sender_id: string
  recipient_id: string
  content: string
  read: boolean
  created_at: string
}

/** A forumline DM conversation summary */
export interface ForumlineDmConversation {
  recipientId: string
  recipientName: string
  recipientAvatarUrl: string | null
  lastMessage: string
  lastMessageTime: string
  unreadCount: number
}

/** A forumline user profile (search result) */
export interface ForumlineProfile {
  id: string
  username: string
  display_name: string
  avatar_url: string | null
}
