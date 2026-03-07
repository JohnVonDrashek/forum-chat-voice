// ============================================================================
// Forumline Webview Messages — Typed postMessage protocol between Forumline app and forum
// ============================================================================

import type { UnreadCounts, ForumNotification } from './notifications'

/** Messages sent from forum iframe → Forumline app */
export type ForumToForumlineMessage =
  | { type: 'forumline:ready' }
  | { type: 'forumline:auth_state'; signedIn: boolean }
  | { type: 'forumline:unread_counts'; counts: UnreadCounts }
  | { type: 'forumline:notification'; notification: ForumNotification }
  | { type: 'forumline:navigate'; path: string }

/** Messages sent from Forumline app → forum iframe */
export type ForumlineToForumMessage =
  | { type: 'forumline:request_auth_state' }
  | { type: 'forumline:request_unread_counts' }

/** All Forumline postMessage types (useful for type guards) */
export type ForumlineMessage = ForumToForumlineMessage | ForumlineToForumMessage

/** Type guard: checks if a MessageEvent.data is a Forumline message */
export function isForumlineMessage(data: unknown): data is ForumlineMessage {
  return (
    typeof data === 'object' &&
    data !== null &&
    'type' in data &&
    typeof (data as { type: unknown }).type === 'string' &&
    (data as { type: string }).type.startsWith('forumline:')
  )
}
