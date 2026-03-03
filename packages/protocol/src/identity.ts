// ============================================================================
// Forumline Identity — Cross-forum user identity
// ============================================================================

/** A user's portable identity across Forumline forums */
export interface ForumlineIdentity {
  /** Globally unique user ID (UUID) */
  forumline_id: string

  /** Unique username */
  username: string

  /** Display name shown in UI */
  display_name: string

  /** Avatar image URL */
  avatar_url: string

  /** Optional user bio */
  bio?: string
}

/** A user's membership in a specific forum */
export interface ForumlineMembership {
  /** Forum domain */
  forum_domain: string

  /** Forum name (from manifest) */
  forum_name: string

  /** Forum icon URL (from manifest) */
  forum_icon_url: string

  /** When the user joined this forum */
  joined_at: string

  /** Session token for this forum (opaque to the client) */
  session_token?: string
}

/** Result of an authentication operation */
export interface AuthResult {
  success: boolean
  error?: string
  session?: AuthSession
  identity?: ForumlineIdentity
}

/** An authenticated session */
export interface AuthSession {
  access_token: string
  refresh_token?: string
  expires_at: string
}
