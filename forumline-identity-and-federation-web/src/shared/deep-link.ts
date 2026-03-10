/*
 * Deep link handler
 *
 * This file parses forumline:// deep links to open specific forums and pages from outside the app.
 *
 * It must:
 * - Parse forumline://forum/<domain>/<path> URLs into a domain and path
 */

export interface DeepLinkTarget {
  domain: string
  path: string
}

/** Parse a forumline:// URL into a domain and path */
export function parseDeepLink(url: string): DeepLinkTarget | null {
  try {
    const match = url.match(/^forumline:\/\/forum\/([^/]+)(.*)$/)
    if (!match) return null
    return {
      domain: match[1],
      path: match[2] || '/',
    }
  } catch {
    return null
  }
}
