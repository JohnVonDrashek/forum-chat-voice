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

import { useState, useRef, useCallback, useEffect } from 'react'
import type { ForumToHubMessage, HubToForumMessage, UnreadCounts, ForumNotification } from '@johnvondrashek/forumline-protocol'
import type { ForumMembership } from './ForumProvider'

interface ForumWebviewProps {
  forum: ForumMembership
  /** OAuth auth URL for auto-login (e.g. /forumline/auth?hub_token=...) */
  authUrl?: string | null
  /** Called when the auth flow completes */
  onAuthed?: (domain: string) => void
  /** Called when the user signs out of the forum */
  onSignedOut?: (domain: string) => void
  /** Called when the forum reports unread counts */
  onUnreadCounts?: (domain: string, counts: UnreadCounts) => void
  /** Called when the forum sends a notification */
  onNotification?: (domain: string, notification: ForumNotification) => void
  /** Called when the user navigates within the forum */
  onNavigate?: (domain: string, path: string) => void
  /** Optional path to navigate to within the forum (e.g. from a deep link) */
  initialPath?: string | null
}

export default function ForumWebview({ forum, authUrl, onAuthed, onSignedOut, onUnreadCounts, onNotification, onNavigate, initialPath }: ForumWebviewProps) {
  const [loading, setLoading] = useState(true)
  const initialUrl = initialPath ? `${forum.web_base}${initialPath}` : forum.web_base
  const [iframeSrc, setIframeSrc] = useState(initialUrl)
  const [loggingIn, setLoggingIn] = useState(false)
  const hasCalledAuthed = useRef(false)
  const iframeRef = useRef<HTMLIFrameElement>(null)

  const forumOrigin = new URL(forum.web_base).origin

  // Listen for typed messages from the forum iframe
  useEffect(() => {
    const postToForum = (msg: HubToForumMessage) => {
      iframeRef.current?.contentWindow?.postMessage(msg, forumOrigin)
    }

    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== forumOrigin) return
      const msg = event.data as ForumToHubMessage
      if (!msg?.type?.startsWith('forumline:')) return

      switch (msg.type) {
        case 'forumline:ready':
          postToForum({ type: 'forumline:request_auth_state' })
          postToForum({ type: 'forumline:request_unread_counts' })
          break

        case 'forumline:auth_state':
          if (msg.signedIn) {
            if (onAuthed && !hasCalledAuthed.current) {
              hasCalledAuthed.current = true
              onAuthed(forum.domain)
            }
          } else {
            if (onSignedOut) {
              hasCalledAuthed.current = false
              onSignedOut(forum.domain)
            }
          }
          break

        case 'forumline:unread_counts':
          onUnreadCounts?.(forum.domain, msg.counts)
          break

        case 'forumline:notification':
          onNotification?.(forum.domain, msg.notification)
          break

        case 'forumline:navigate':
          onNavigate?.(forum.domain, msg.path)
          break
      }
    }
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [forum.domain, forumOrigin, onAuthed, onSignedOut, onUnreadCounts, onNotification, onNavigate])

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
    // Ask the forum for its current auth state as a fallback
    // (the primary path is the forumline:ready event from the forum).
    const requestAuth: HubToForumMessage = { type: 'forumline:request_auth_state' }
    iframeRef.current?.contentWindow?.postMessage(requestAuth, forumOrigin)
  }, [loggingIn, onAuthed, forum.domain, forumOrigin])

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
          ref={iframeRef}
          key={forum.domain}
          src={iframeSrc}
          title={`${forum.name} forum`}
          className="h-full w-full border-0"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          allow="clipboard-read; clipboard-write; microphone; display-capture"
          onLoad={handleLoad}
        />
      </div>
    </div>
  )
}
