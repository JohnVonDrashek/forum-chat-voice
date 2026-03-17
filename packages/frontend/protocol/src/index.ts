// ============================================================================
// @forumline/protocol — Federation Protocol Types
//
// Zero-dependency TypeScript types that define the Forumline federation contract.
// This is the source of truth for how forums communicate with the Forumline app.
// ============================================================================

export type {
  ForumlineApiEndpoints,
  ForumlineAuthEndpoints,
} from './api';
export type {
  ForumlineConversationMember,
  ForumlineDirectMessage,
  ForumlineDmConversation,
  ForumlineProfile,
} from './forumline-dms';
export type {
  AuthResult,
  AuthSession,
  ForumlineAuthorizeParams,
  ForumlineIdentity,
  ForumlineMembership,
  ForumlineTokenRequest,
  ForumlineTokenResponse,
} from './identity';
export type { ForumCapability, ForumManifest } from './manifest';
export type {
  ForumNotification,
  ForumNotificationType,
  NotificationInput,
  UnreadCounts,
} from './notifications';
export type {
  ForumlineMessage,
  ForumlineToForumMessage,
  ForumToForumlineMessage,
} from './webview-messages';
export { isForumlineMessage } from './webview-messages';
