// ============================================================================
// @johnvondrashek/forumline-protocol — Federation Protocol Types
//
// Zero-dependency TypeScript types that define the Forumline federation contract.
// This is the source of truth for how forums communicate with the Forumline app.
// ============================================================================

export type { ForumManifest, ForumCapability } from './manifest'
export type {
  ForumlineIdentity,
  ForumlineMembership,
  AuthResult,
  AuthSession,
  ForumlineAuthorizeParams,
  ForumlineTokenRequest,
  ForumlineTokenResponse,
} from './identity'
export type {
  ForumNotification,
  ForumNotificationType,
  UnreadCounts,
  NotificationInput,
} from './notifications'
export type {
  ForumlineApiEndpoints,
  ForumlineAuthEndpoints,
} from './api'
export type {
  ForumlineDirectMessage,
  ForumlineDmConversation,
  ForumlineProfile,
} from './forumline-dms'
export type {
  ForumToForumlineMessage,
  ForumlineToForumMessage,
  ForumlineMessage,
} from './webview-messages'
export { isForumlineMessage } from './webview-messages'
