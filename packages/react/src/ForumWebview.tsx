/**
 * ForumWebview — Renders an external forum's website in an iframe.
 *
 * Used in the Tauri desktop app when a forum is selected from the ForumRail.
 * The iframe is sandboxed for security and keyed by domain for clean remounts.
 *
 * When `authUrl` is provided, a login banner appears at the top of the webview.
 * Clicking "Log in" navigates the iframe through the OAuth flow, which redirects
 * back to the forum fully authenticated.
 */

import { useState, useRef, useCallback } from 'react'
import type { ForumMembership } from './ForumProvider'

interface ForumWebviewProps {
  forum: ForumMembership
  /** OAuth auth URL for auto-login (e.g. /forumline/auth?hub_token=...) */
  authUrl?: string | null
  /** Called when the auth flow completes */
  onAuthed?: (domain: string) => void
}

export default function ForumWebview({ forum, authUrl, onAuthed }: ForumWebviewProps) {
  const [loading, setLoading] = useState(true)
  const [iframeSrc, setIframeSrc] = useState(forum.web_base)
  const [loggingIn, setLoggingIn] = useState(false)
  const hasCalledAuthed = useRef(false)

  const handleLogin = useCallback(() => {
    if (!authUrl) return
    setLoggingIn(true)
    setLoading(true)
    setIframeSrc(authUrl)
  }, [authUrl])

  const handleLoad = useCallback(() => {
    setLoading(false)
    if (loggingIn && onAuthed && !hasCalledAuthed.current) {
      hasCalledAuthed.current = true
      setLoggingIn(false)
      onAuthed(forum.domain)
    }
  }, [loggingIn, onAuthed, forum.domain])

  const showBanner = !!authUrl && !loggingIn && !hasCalledAuthed.current

  return (
    <div className="relative flex flex-1 flex-col">
      {/* Login banner */}
      {showBanner && (
        <div className="flex items-center justify-between bg-indigo-600 px-4 py-2">
          <span className="text-sm text-white">
            You're signed in to Forumline. Log in to <strong>{forum.name}</strong> for the full experience.
          </span>
          <button
            onClick={handleLogin}
            className="ml-4 rounded-md bg-white px-3 py-1 text-sm font-medium text-indigo-600 hover:bg-indigo-50 transition-colors"
          >
            Log in
          </button>
        </div>
      )}

      {/* Webview */}
      <div className="relative flex-1">
        {loading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-900">
            <div className="flex flex-col items-center gap-3">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-600 border-t-indigo-500" />
              <span className="text-sm text-slate-400">
                {loggingIn ? 'Signing in...' : `Loading ${forum.name}...`}
              </span>
            </div>
          </div>
        )}

        <iframe
          key={forum.domain}
          src={iframeSrc}
          title={`${forum.name} forum`}
          className="h-full w-full border-0"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          allow="clipboard-read; clipboard-write"
          onLoad={handleLoad}
        />
      </div>
    </div>
  )
}
