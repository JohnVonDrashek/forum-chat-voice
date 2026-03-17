/*
 * Cross-Forum Notification Protocol
 *
 * Defines the notification types that forums emit and the Forumline app aggregates into a unified inbox.
 *
 * It must:
 * - Enumerate the notification categories (replies, mentions, chat mentions, DMs, custom) so the app can filter and display them appropriately
 * - Represent individual notifications with enough context (title, body, link, source forum) for the user to act on them without leaving the app
 * - Define unread count summaries so the app can show badge counts across all forums at a glance
 * - Provide a server-side notification input type for forums to create new notifications through the SDK
 */

// ============================================================================
// Forumline Notifications — Cross-forum notification protocol
// ============================================================================

/** Types of notifications a forum can emit */
export type ForumNotificationType = 'reply' | 'mention' | 'chat_mention' | 'dm' | 'custom';

/** A notification from a specific forum */
export interface ForumNotification {
  /** Unique notification ID */
  id: string;

  /** Notification type */
  type: ForumNotificationType;

  /** Short title (e.g. "New reply in your thread") */
  title: string;

  /** Notification body text */
  body: string;

  /** ISO 8601 timestamp */
  timestamp: string;

  /** Whether the user has read this notification */
  read: boolean;

  /** Link to the relevant content (relative to the forum's web_base) */
  link: string;

  /** Domain of the forum that sent this notification */
  forum_domain: string;
}

/** Unread counts returned by the /unread endpoint */
export interface UnreadCounts {
  /** Number of unread notifications */
  notifications: number;

  /** Number of unread chat mentions */
  chat_mentions: number;

  /** Number of unread DMs */
  dms: number;
}

/** Input for creating a new notification (server-side) */
export interface NotificationInput {
  type: ForumNotificationType;
  title: string;
  body: string;
  link: string;
}
