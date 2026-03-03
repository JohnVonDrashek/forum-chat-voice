// ============================================================================
// Forum Manifest — /.well-known/forumline-manifest.json
// ============================================================================

/** Capabilities a forum can advertise */
export type ForumCapability = 'threads' | 'chat' | 'voice' | 'notifications'

/** The manifest every Forumline-compatible forum must serve */
export interface ForumManifest {
  /** Protocol version. Currently always "1". */
  forumline_version: '1'

  /** Human-readable forum name */
  name: string

  /** The forum's canonical domain (e.g. "my-forum.com") */
  domain: string

  /** URL to the forum's icon (absolute or relative to web_base) */
  icon_url: string

  /** Base URL for Forumline API endpoints (e.g. "https://my-forum.com/api/forumline") */
  api_base: string

  /** Base URL for the forum's web UI (e.g. "https://my-forum.com") */
  web_base: string

  /** Which features this forum supports */
  capabilities: ForumCapability[]

  /** Optional description of the forum */
  description?: string

  /** Optional banner image URL */
  banner_url?: string

  /** Optional accent color (hex, e.g. "#7c3aed") */
  accent_color?: string

  /** Optional approximate member count */
  member_count?: number

  /** Whether joining requires an invite */
  invite_required?: boolean
}
