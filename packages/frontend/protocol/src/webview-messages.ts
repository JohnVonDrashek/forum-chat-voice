/*
 * Webview Message Protocol
 *
 * Defines the typed postMessage contract between the Forumline app shell and forum iframes embedded within it.
 *
 * It must:
 * - Define messages the forum sends to the app (ready signal, auth state, unread counts, notifications, navigation requests) so the app can react to forum events
 * - Define messages the app sends to the forum (auth state requests, unread count requests) so forums respond with fresh data on demand
 * - Provide a type guard so both sides can safely distinguish Forumline messages from unrelated postMessage traffic
 */

// ============================================================================
// Forumline Webview Messages — Typed postMessage protocol between Forumline app and forum
// ============================================================================

import type { ForumNotification, UnreadCounts } from './notifications';

/** Messages sent from forum iframe → Forumline app */
export type ForumToForumlineMessage =
  | { type: 'forumline:ready' }
  | { type: 'forumline:auth_state'; signedIn: boolean }
  | { type: 'forumline:unread_counts'; counts: UnreadCounts }
  | { type: 'forumline:notification'; notification: ForumNotification }
  | { type: 'forumline:navigate'; path: string };

/** Messages sent from Forumline app → forum iframe */
export type ForumlineToForumMessage =
  | { type: 'forumline:request_auth_state' }
  | { type: 'forumline:request_unread_counts' };

/** All Forumline postMessage types (useful for type guards) */
export type ForumlineMessage = ForumToForumlineMessage | ForumlineToForumMessage;

/** Type guard: checks if a MessageEvent.data is a Forumline message */
export function isForumlineMessage(data: unknown): data is ForumlineMessage {
  return (
    typeof data === 'object' &&
    data !== null &&
    'type' in data &&
    typeof (data as { type: unknown }).type === 'string' &&
    (data as { type: string }).type.startsWith('forumline:')
  );
}
