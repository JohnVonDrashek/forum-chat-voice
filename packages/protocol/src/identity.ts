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

// ============================================================================
// Forumline OAuth Flow Types
// ============================================================================

/** Parameters for the Forumline OAuth authorize redirect */
export interface ForumlineAuthorizeParams {
  /** OAuth client ID assigned to the forum */
  client_id: string

  /** Where to redirect after authorization */
  redirect_uri: string

  /** CSRF protection token */
  state: string

  /** Optional: pre-authenticated Forumline access token */
  access_token?: string
}

/** Request body for exchanging an auth code for an identity token */
export interface ForumlineTokenRequest {
  /** Authorization code received from Forumline */
  code: string

  /** Forum's OAuth client ID */
  client_id: string

  /** Forum's OAuth client secret */
  client_secret: string

  /** Must match the redirect_uri used in the authorize request */
  redirect_uri?: string
}

/** Response from the Forumline token endpoint */
export interface ForumlineTokenResponse {
  /** Signed JWT containing the user's ForumlineIdentity */
  identity_token: string

  /** The user's identity (also embedded in the JWT) */
  identity: ForumlineIdentity

  /** Token type (always "Bearer") */
  token_type: 'Bearer'

  /** Token lifetime in seconds */
  expires_in: number
}
