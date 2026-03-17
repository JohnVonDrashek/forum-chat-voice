/*
 * Forum Manifest
 *
 * Defines the self-description document that every Forumline-compatible forum publishes at /.well-known/forumline-manifest.json.
 *
 * It must:
 * - Declare the forum's name, domain, icon, and description so the Forumline app can display it in the forum directory and sidebar
 * - Advertise which capabilities the forum supports (threads, chat, voice, notifications) so the app can enable or hide features accordingly
 * - Provide API and web base URLs so the app knows where to send API requests and where to link users for browsing
 * - Expose optional metadata (accent color, banner, member count, invite policy) for rich forum previews
 */

// ============================================================================
// Forum Manifest — /.well-known/forumline-manifest.json
// ============================================================================

/** Capabilities a forum can advertise */
export type ForumCapability = 'threads' | 'chat' | 'voice' | 'notifications';

/** The manifest every Forumline-compatible forum must serve */
export interface ForumManifest {
  /** Protocol version. Currently always "1". */
  forumline_version: '1';

  /** Human-readable forum name */
  name: string;

  /** The forum's canonical domain (e.g. "my-forum.com") */
  domain: string;

  /** URL to the forum's icon (absolute or relative to web_base) */
  icon_url: string;

  /** Base URL for Forumline API endpoints (e.g. "https://my-forum.com/api/forumline") */
  api_base: string;

  /** Base URL for the forum's web UI (e.g. "https://my-forum.com") */
  web_base: string;

  /** Which features this forum supports */
  capabilities: ForumCapability[];

  /** Optional description of the forum */
  description?: string;

  /** Optional banner image URL */
  banner_url?: string;

  /** Optional accent color (hex, e.g. "#7c3aed") */
  accent_color?: string;

  /** Optional approximate member count */
  member_count?: number;

  /** Whether joining requires an invite */
  invite_required?: boolean;

  /** Optional tags for categorization and discovery (e.g. "gaming", "programming") */
  tags?: string[];
}
