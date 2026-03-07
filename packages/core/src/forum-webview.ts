import type { ForumToForumlineMessage, ForumlineToForumMessage, UnreadCounts, ForumNotification } from '@johnvondrashek/forumline-protocol'
import type { ForumMembership } from './forum-store.js'

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

export function createForumWebview(opts: ForumWebviewOptions): ForumWebviewInstance {
  const { forum, onAuthed, onSignedOut, onUnreadCounts, onNotification, onNavigate } = opts
  let authUrl = opts.authUrl ?? null
  const initialUrl = opts.initialPath ? `${forum.web_base}${opts.initialPath}` : forum.web_base
  const forumOrigin = new URL(forum.web_base).origin

  let loading = true
  let loggingIn = false
  let hasCalledAuthed = false

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
    loading = true
    spinner.style.display = ''
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
            onAuthed(forum.domain)
            updateBanner()
          }
        } else {
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

    if (loggingIn && onAuthed && !hasCalledAuthed) {
      hasCalledAuthed = true
      loggingIn = false
      onAuthed(forum.domain)
      updateBanner()
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
