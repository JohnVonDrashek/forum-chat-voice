// ============================================================================
// Forumline API Contract — Required & optional endpoints
// ============================================================================

import type { ForumManifest } from './manifest'
import type { ForumNotification, UnreadCounts } from './notifications'
import type { AuthSession, ForumlineIdentity } from './identity'

/**
 * Required API endpoints every Forumline-compatible forum MUST implement.
 * These are relative to the forum's `api_base` from the manifest.
 *
 * The manifest itself is at: GET /.well-known/forumline-manifest.json
 */
export interface ForumlineApiEndpoints {
  /**
   * GET /unread
   * Returns unread counts for the authenticated user.
   */
  'GET /unread': {
    response: UnreadCounts
  }

  /**
   * GET /notifications
   * Returns the user's recent notifications.
   */
  'GET /notifications': {
    response: ForumNotification[]
  }

  /**
   * GET /notifications/stream
   * Server-Sent Events stream for real-time notifications.
   * Each event is a JSON-encoded ForumNotification.
   */
  'GET /notifications/stream': {
    response: ForumNotification // SSE event data
  }

  /**
   * POST /notifications/:id/read
   * Mark a specific notification as read.
   */
  'POST /notifications/:id/read': {
    params: { id: string }
    response: { success: boolean }
  }
}

/**
 * Optional auth endpoints for forums that support Forumline identity.
 * Forums without these still work — users sign up locally.
 */
export interface ForumlineAuthEndpoints {
  /**
   * GET /auth
   * Redirects to Forumline Forumline OAuth2 authorization.
   */
  'GET /auth': {
    query: { redirect_uri: string }
    response: never // 302 redirect
  }

  /**
   * GET /auth/callback
   * Handles OAuth2 callback from Forumline.
   */
  'GET /auth/callback': {
    query: { code: string; state: string }
    response: { session: AuthSession }
  }

  /**
   * GET /auth/session
   * Validates the current session and returns the user's identity.
   */
  'GET /auth/session': {
    response: {
      identity: ForumlineIdentity
      forum_manifest: ForumManifest
    } | null
  }
}
