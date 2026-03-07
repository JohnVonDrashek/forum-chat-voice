import type { ForumToForumlineMessage, ForumlineToForumMessage, UnreadCounts, ForumNotification } from '@johnvondrashek/forumline-protocol'
import type { ForumMembership } from './forum-store.js'
import { showToast } from '../components/ui.js'

export interface ForumWebviewOptions {
  forum: ForumMembership
  authUrl?: string | null
  initialPath?: string | null
  onAuthed?: (domain: string) => void
  onSignedOut?: (domain: string) => void
  onUnreadCounts?: (domain: string, counts: UnreadCounts) => void
  onNotification?: (domain: string, notification: ForumNotification) => void
  onNavigate?: (domain: string, path: string) => void
}

export interface ForumWebviewInstance {
  el: HTMLElement
  destroy: () => void
  setAuthUrl: (url: string | null) => void
}

// State machine for forum auth inside the Forumline iframe wrapper:
//
//   loggingIn:      true while the iframe is navigating to the auth URL (set on
//                   banner click, cleared when iframe finishes loading after redirect)
//   loginAttempted: true only during the brief window where we're waiting for the
//                   forum to confirm auth via postMessage after the redirect completes.
//                   Must be cleared on successful auth AND on sign-out to avoid
//                   false "login did not complete" toasts when the user later signs out.
//   hasCalledAuthed: true once the forum confirms signedIn:true. Reset to false on
//                   signedIn:false so the login banner can reappear.
//   authUrl:        the server-side OAuth URL. Set by the parent via setAuthUrl()
//                   when the user is signed into Forumline but not this forum.
//
// Banner visibility: shown when authUrl is set, not currently logging in, and
//                    the forum hasn't confirmed auth yet.

export function createForumWebview(opts: ForumWebviewOptions): ForumWebviewInstance {
  const { forum, onAuthed, onSignedOut, onUnreadCounts, onNotification, onNavigate } = opts
  let authUrl = opts.authUrl ?? null
  const initialUrl = opts.initialPath ? `${forum.web_base}${opts.initialPath}` : forum.web_base
  const forumOrigin = new URL(forum.web_base).origin

  let loading = true
  let loggingIn = false
  let hasCalledAuthed = false
  let loginAttempted = false

  // Container
  const container = document.createElement('div')
  container.className = 'webview-container'

  // Login banner
  const banner = document.createElement('div')
  banner.className = 'webview-banner'
  banner.innerHTML = `
    <span class="webview-banner__text">
      You're signed in to Forumline. Log in to <strong>${forum.name}</strong> for the full experience.
    </span>
    <button class="btn btn--small btn--white">Log in</button>
  `
  container.appendChild(banner)

  const bannerBtn = banner.querySelector('button')!
  bannerBtn.addEventListener('click', () => {
    if (!authUrl) return
    loggingIn = true
    loginAttempted = true
    loading = true
    spinnerWrap.style.display = ''
    iframe.src = authUrl
    updateBanner()
  })

  // Spinner
  const spinnerWrap = document.createElement('div')
  spinnerWrap.className = 'webview-spinner-wrap'
  const spinner = document.createElement('div')
  spinner.className = 'webview-spinner'
  const spinnerText = document.createElement('span')
  spinnerText.className = 'webview-spinner__text'
  spinnerText.textContent = `Loading ${forum.name}...`
  spinnerWrap.append(spinner, spinnerText)

  // Iframe
  const iframe = document.createElement('iframe')
  iframe.src = initialUrl
  iframe.title = `${forum.name} forum`
  iframe.className = 'webview-iframe'
  iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups')
  iframe.setAttribute('allow', 'clipboard-read; clipboard-write; microphone; display-capture')

  const iframeWrap = document.createElement('div')
  iframeWrap.className = 'webview-iframe-wrap'
  iframeWrap.append(spinnerWrap, iframe)
  container.appendChild(iframeWrap)

  function updateBanner() {
    const show = !!authUrl && !loggingIn && !hasCalledAuthed
    banner.style.display = show ? '' : 'none'
  }

  function postToForum(msg: ForumlineToForumMessage) {
    iframe.contentWindow?.postMessage(msg, forumOrigin)
  }

  function handleMessage(event: MessageEvent) {
    if (event.origin !== forumOrigin) return
    const msg = event.data as ForumToForumlineMessage
    if (!msg?.type?.startsWith('forumline:')) return

    switch (msg.type) {
      case 'forumline:ready':
        postToForum({ type: 'forumline:request_auth_state' })
        postToForum({ type: 'forumline:request_unread_counts' })
        break
      case 'forumline:auth_state':
        if (msg.signedIn) {
          if (onAuthed && !hasCalledAuthed) {
            hasCalledAuthed = true
            loginAttempted = false
            onAuthed(forum.domain)
            updateBanner()
          }
        } else {
          if (loginAttempted && !hasCalledAuthed && !loggingIn) {
            showToast(`Login to ${forum.name} did not complete. The forum reported you are not signed in.`, 'error', 8000)
          }
          loginAttempted = false
          if (onSignedOut) {
            hasCalledAuthed = false
            onSignedOut(forum.domain)
            updateBanner()
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

  iframe.addEventListener('load', () => {
    loading = false
    spinnerWrap.style.display = 'none'

    if (loggingIn) {
      // Check if the iframe landed on an error URL
      try {
        const iframeUrl = new URL(iframe.contentWindow?.location.href ?? '')
        const error = iframeUrl.searchParams.get('error')
        if (error) {
          const errorMessages: Record<string, string> = {
            auth_failed: 'Forum login failed — the server could not complete authentication.',
            email_exists: 'A local account with this email already exists. Sign in to the forum directly and connect Forumline from Settings.',
          }
          showToast(errorMessages[error] || `Forum login error: ${error}`, 'error', 8000)
        }
      } catch {
        // Cross-origin — can't read iframe URL, that's expected for success redirects
      }

      loggingIn = false
      loginAttempted = false
      updateBanner()
      // After auth redirect, delay the auth state check to give the forum
      // time to restore the session from URL hash tokens
      setTimeout(() => {
        if (!hasCalledAuthed) {
          loginAttempted = true
          postToForum({ type: 'forumline:request_auth_state' })
        }
      }, 1500)
      return
    }

    postToForum({ type: 'forumline:request_auth_state' })
  })

  window.addEventListener('message', handleMessage)
  updateBanner()

  return {
    el: container,
    destroy() {
      window.removeEventListener('message', handleMessage)
      container.remove()
    },
    setAuthUrl(url: string | null) {
      authUrl = url
      updateBanner()
    },
  }
}
