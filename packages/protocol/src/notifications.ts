// ============================================================================
// Forumline Notifications — Cross-forum notification protocol
// ============================================================================

/** Types of notifications a forum can emit */
export type ForumNotificationType =
  | 'reply'
  | 'mention'
  | 'chat_mention'
  | 'dm'
  | 'custom'

/** A notification from a specific forum */
export interface ForumNotification {
  /** Unique notification ID */
  id: string

  /** Notification type */
  type: ForumNotificationType

  /** Short title (e.g. "New reply in your thread") */
  title: string

  /** Notification body text */
  body: string

  /** ISO 8601 timestamp */
  timestamp: string

  /** Whether the user has read this notification */
  read: boolean

  /** Link to the relevant content (relative to the forum's web_base) */
  link: string

  /** Domain of the forum that sent this notification */
  forum_domain: string
}

/** Unread counts returned by the /unread endpoint */
export interface UnreadCounts {
  /** Number of unread notifications */
  notifications: number

  /** Number of unread chat mentions */
  chat_mentions: number

  /** Number of unread DMs */
  dms: number
}

/** Input for creating a new notification (server-side) */
export interface NotificationInput {
  type: ForumNotificationType
  title: string
  body: string
  link: string
}
