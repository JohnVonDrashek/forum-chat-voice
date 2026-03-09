/*
 * Main application layout
 *
 * This file is the primary shell that ties together forums, DMs, settings, and calls into a unified app experience.
 *
 * It must:
 * - Display the currently selected forum inside an embedded webview (iframe)
 * - Show a welcome/home screen when no forum is selected
 * - Switch between Forums, DMs, and Settings views via the mobile tab bar
 * - Track and display unread DM counts on the tab bar badge, updated via SSE in real-time
 * - Handle deep links (forumline:// URLs) to open specific forums and paths
 * - Sync forum memberships and auth state with the Forumline server
 * - Manage forum-to-Forumline single sign-on, logging users into forums automatically
 * - Register for web push notifications and forward push subscription to the server
 * - Show native or browser notifications for forum events when the app is in the background
 * - Respect per-forum notification mute settings
 * - Provide a share button to copy the current forum page URL to clipboard
 * - Initialize and display the voice call overlay for incoming/outgoing calls
 * - Lazily create and persistently keep alive child views (webview, DMs, settings, welcome)
 */
import type { GoTrueAuthClient, ForumlineSession } from '../auth/gotrue-auth.js'
import type { ForumNotification } from '@johnvondrashek/forumline-protocol'
import { createForumWebview, type ForumWebviewInstance } from '../forums/forum-webview.js'
import { type ForumStore } from '../forums/forum-store.js'
import { isTauri, getTauriNotification } from '../shared/tauri.js'
import { setupDeepLinkListener, type DeepLinkTarget } from '../shared/deep-link.js'
import { type ForumlineStore } from '../shared/forumline-store.js'
import { createWelcomePage } from '../forums/welcome-page.js'
import { createDmPanel } from '../dms/dm-panel.js'
import { createSettingsPage } from '../settings/settings-page.js'
import { createMobileTabBar, type AppView } from './mobile-tab-bar.js'
import { unreadCount as dmUnreadState, startUpdates as startDmStoreUpdates } from '../dms/dm-store.js'
import { initCallManager, destroyCallManager } from '../calls/call-manager.js'
import { createCallOverlay } from '../calls/call-overlay.js'
import { warmAudioContext } from '../calls/call-ringtone.js'
import { tags, html, derive } from '../shared/dom.js'

const { div } = tags

/** Persist auth state change to Forumline DB */
async function updateForumAuthState(auth: GoTrueAuthClient, forumDomain: string, authed: boolean) {
  try {
    const session = auth.getSession()
    if (!session) return
    await fetch('/api/memberships', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ forum_domain: forumDomain, authed }),
    })
  } catch (err) {
    console.error('[Forumline] Failed to persist forum auth state:', err)
  }
}

interface AppLayoutOptions {
  forumlineSession: ForumlineSession
  forumStore: ForumStore
  forumlineStore: ForumlineStore
  auth: GoTrueAuthClient
}

export function createAppLayout({ forumlineSession, forumStore, forumlineStore, auth }: AppLayoutOptions) {
  let view: AppView = 'forums'
  let authedForums: Set<string> | null = null
  let mutedForums = new Set<string>()
  let deepLinkPath: string | null = null
  let forumPath = '/'
  let copied = false
  let copiedTimeout: ReturnType<typeof setTimeout> | null = null
  let dmUnreadCount = 0

  // Persistent child instances — created lazily, kept alive
  let webviewInstance: ForumWebviewInstance | null = null
  let webviewForumDomain: string | null = null // track which forum the webview is showing
  let dmChild: { el: HTMLElement; destroy: () => void } | null = null
  let settingsChild: { el: HTMLElement; destroy: () => void } | null = null
  let welcomeChild: { el: HTMLElement; destroy: () => void } | null = null
  let tabBarInstance: ReturnType<typeof createMobileTabBar> | null = null

  // View containers — persistent wrappers for each view
  const forumContainer = div({ class: 'flex flex-col flex-1 overflow-hidden' }) as HTMLDivElement

  const cleanups: (() => void)[] = []

  // Root element
  const mainArea = div({ class: 'app-main' }) as HTMLDivElement
  const root = div({ class: 'app-root' }, mainArea) as HTMLDivElement

  // Tab bar
  tabBarInstance = createMobileTabBar({
    forumStore,
    onChangeView: (v) => {
      view = v
      switchView()
    },
  })
  root.appendChild(tabBarInstance.el)

  // ---- DM unread count (derived from shared dm-store) ----
  function startDmUpdates() {
    const { isForumlineConnected } = forumlineStore.get()
    if (!isForumlineConnected) return

    // Subscribe to the shared dm-store; it handles SSE + polling internally
    const stopUpdates = startDmStoreUpdates(forumlineStore)
    cleanups.push(stopUpdates)

    // Derive local dmUnreadCount from the store's reactive state and update tab bar
    derive(() => {
      dmUnreadCount = dmUnreadState.val
      tabBarInstance?.update(view, dmUnreadCount)
    })
  }

  // ---- Deep links ----
  const cleanupDeepLink = setupDeepLinkListener((target: DeepLinkTarget) => {
    forumStore.switchForum(target.domain)
    deepLinkPath = target.path
    switchView()
  })
  cleanups.push(cleanupDeepLink)

  // ---- Memberships fetch + server sync ----
  async function fetchMemberships() {
    try {
      const session = auth.getSession()
      if (!session) return

      // Sync forum list from server (merges server + local, persists to localStorage)
      await forumStore.syncFromServer(session.access_token)

      const res = await fetch('/api/memberships', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (!res.ok) return
      const memberships: { forum_domain: string; forum_authed_at: string | null; notifications_muted?: boolean }[] = await res.json()
      authedForums = new Set(
        memberships.filter(m => m.forum_authed_at).map(m => m.forum_domain),
      )
      mutedForums = new Set(
        memberships.filter(m => m.notifications_muted).map(m => m.forum_domain),
      )
    } catch {
      authedForums = new Set()
    }

    // If a webview is already open for a forum that needs auth, set the auth URL now
    if (webviewInstance && webviewForumDomain) {
      if (!authedForums.has(webviewForumDomain)) {
        const { activeForum } = forumStore.get()
        const session = auth.getSession()
        if (activeForum && session) {
          webviewInstance.setAuthUrl(`${activeForum.api_base}/auth?forumline_token=${session.access_token}`)
        }
      }
    }
  }

  // ---- Notifications ----
  function handleForumNotification(_domain: string, notification: ForumNotification) {
    if (mutedForums.has(_domain)) return
    if (document.visibilityState === 'visible') return
    const { title, body } = notification

    if (isTauri()) {
      getTauriNotification().then(async ({ sendNotification, isPermissionGranted, requestPermission }) => {
        let permitted = await isPermissionGranted()
        if (!permitted) {
          const result = await requestPermission()
          permitted = result === 'granted'
        }
        if (permitted) sendNotification({ title, body })
      }).catch(console.error)
    } else if ('Notification' in window) {
      if (Notification.permission === 'default') {
        Notification.requestPermission().then(() => {
          if (Notification.permission === 'granted') new Notification(title, { body })
        })
      } else if (Notification.permission === 'granted') {
        new Notification(title, { body })
      }
    }
  }

  // ---- Push subscription ----
  function registerPush() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return

    const vapidPublicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY
    if (!vapidPublicKey) return

    let cancelled = false
    const doRegister = async () => {
      try {
        const registration = await navigator.serviceWorker.register('/sw.js')
        await navigator.serviceWorker.ready

        let subscription = await registration.pushManager.getSubscription()
        if (!subscription) {
          const padding = '='.repeat((4 - (vapidPublicKey.length % 4)) % 4)
          const base64 = (vapidPublicKey + padding).replace(/-/g, '+').replace(/_/g, '/')
          const rawData = atob(base64)
          const applicationServerKey = new Uint8Array(rawData.length)
          for (let i = 0; i < rawData.length; i++) {
            applicationServerKey[i] = rawData.charCodeAt(i)
          }
          subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey,
          })
        }

        if (cancelled) return

        const sub = subscription.toJSON()
        const session = auth.getSession()
        if (!session) return
        await fetch('/api/push?action=subscribe', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ endpoint: sub.endpoint, keys: sub.keys }),
        })
      } catch (err) {
        console.error('[Forumline] Push subscription failed:', err)
      }
    }
    doRegister()
    cleanups.push(() => { cancelled = true })
  }

  // ---- Service worker notification click ----
  function handleSwMessage(event: MessageEvent) {
    if (event.data?.type === 'notification-click') {
      const { forum_domain } = event.data
      if (forum_domain) forumStore.switchForum(forum_domain)
    }
  }
  navigator.serviceWorker?.addEventListener('message', handleSwMessage)
  cleanups.push(() => navigator.serviceWorker?.removeEventListener('message', handleSwMessage))

  // ---- Share handler ----
  function handleShare() {
    const { activeForum } = forumStore.get()
    if (!activeForum) return
    const url = activeForum.web_base + forumPath
    navigator.clipboard.writeText(url).then(() => {
      copied = true
      renderForumHeader()
      if (copiedTimeout) clearTimeout(copiedTimeout)
      copiedTimeout = setTimeout(() => {
        copied = false
        renderForumHeader()
      }, 2000)
    })
  }

  // ---- Forum header bar ----
  let forumHeaderEl: HTMLElement | null = null
  function renderForumHeader(): HTMLElement {
    const { activeForum } = forumStore.get()
    if (!forumHeaderEl) {
      forumHeaderEl = div({ class: 'forum-header' }) as HTMLElement
    }
    forumHeaderEl.innerHTML = ''

    const backBtn = tags.button({ class: 'forum-header__back', onclick: () => forumStore.goHome() },
      html(`<svg class="icon-sm" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/></svg>`),
      tags.span(activeForum?.name ?? ''),
    )

    const shareIcon = copied
      ? `<svg class="icon-sm" style="color:var(--color-green)" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>`
      : `<svg class="icon-sm" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"/></svg>`
    const shareBtn = tags.button({ class: 'forum-header__share', title: 'Copy link to this page', onclick: handleShare },
      html(shareIcon),
    )

    forumHeaderEl.append(backBtn, shareBtn)
    return forumHeaderEl
  }

  // ---- Helper to show/hide elements ----
  function showEl(el: HTMLElement) { el.style.display = '' }
  function hideEl(el: HTMLElement) { el.style.display = 'none' }

  // ---- Ensure webview for current forum ----
  function ensureWebview() {
    const { activeForum } = forumStore.get()
    if (!activeForum) return

    // If webview is for a different forum, destroy and recreate
    if (webviewInstance && webviewForumDomain !== activeForum.domain) {
      webviewInstance.destroy()
      webviewInstance = null
      webviewForumDomain = null
      forumContainer.innerHTML = ''
      forumHeaderEl = null
    }

    // Create webview if needed
    if (!webviewInstance) {
      forumContainer.innerHTML = ''
      renderForumHeader()
      if (forumHeaderEl) forumContainer.appendChild(forumHeaderEl)

      const needsAuth = authedForums !== null && !authedForums.has(activeForum.domain)
      webviewInstance = createForumWebview({
        forum: activeForum,
        authUrl: null,
        initialPath: deepLinkPath,
        onAuthed: (domain) => {
          authedForums?.add(domain)
          updateForumAuthState(auth, domain, true)
        },
        onSignedOut: (domain) => {
          authedForums?.delete(domain)
          updateForumAuthState(auth, domain, false)
        },
        onUnreadCounts: (domain, counts) => forumStore.setUnreadCounts(domain, counts),
        onNotification: handleForumNotification,
        onNavigate: (_domain, path) => { forumPath = path },
      })
      webviewForumDomain = activeForum.domain

      forumContainer.appendChild(webviewInstance.el)

      // Set auth URL with fresh token (async)
      if (needsAuth) {
        const wv = webviewInstance
        const af = activeForum
        const session = auth.getSession()
        if (session && wv === webviewInstance) {
          wv.setAuthUrl(`${af.api_base}/auth?forumline_token=${session.access_token}`)
        }
      }

      deepLinkPath = null
      forumPath = '/'
    }
  }

  // ---- Main view switch ----
  function switchView() {
    tabBarInstance?.update(view, dmUnreadCount)

    const { activeForum } = forumStore.get()

    // Hide all persistent children
    if (forumContainer.parentNode) hideEl(forumContainer)
    if (dmChild?.el.parentNode) hideEl(dmChild.el)
    if (settingsChild?.el.parentNode) hideEl(settingsChild.el)
    if (welcomeChild?.el.parentNode) hideEl(welcomeChild.el)

    if (view === 'settings') {
      if (!settingsChild) {
        settingsChild = createSettingsPage({
          forumlineSession,
          forumStore,
          forumlineStore,
          auth,
          onClose: () => { view = 'forums'; switchView() },
        })
        mainArea.appendChild(settingsChild.el)
      }
      showEl(settingsChild.el)
      return
    }

    if (view === 'dms') {
      if (!dmChild) {
        dmChild = createDmPanel({
          forumlineStore,
          onClose: () => { view = 'forums'; switchView() },
          onGoToSettings: () => { view = 'settings'; switchView() },
        })
        mainArea.appendChild(dmChild.el)
      }
      showEl(dmChild.el)
      return
    }

    // Forums view
    if (activeForum) {
      // Ensure forum container is in mainArea
      if (!forumContainer.parentNode) {
        mainArea.appendChild(forumContainer)
      }
      ensureWebview()
      showEl(forumContainer)
      return
    }

    // No active forum — welcome page
    if (!welcomeChild) {
      welcomeChild = createWelcomePage({
        forumlineSession,
        forumStore,
        forumlineStore,
        onGoToSettings: () => { view = 'settings'; switchView() },
      })
      mainArea.appendChild(welcomeChild.el)
    }
    showEl(welcomeChild.el)
  }

  // ---- Subscribe to store changes ----
  // Only re-render when activeForum changes (not on unread count updates)
  let prevActiveForum = forumStore.get().activeForum
  const unsubForum = forumStore.subscribe(() => {
    const { activeForum } = forumStore.get()
    if (activeForum !== prevActiveForum) {
      prevActiveForum = activeForum
      if (view === 'forums') switchView()
    }
  })
  cleanups.push(unsubForum)

  // ---- Call overlay ----
  warmAudioContext()
  initCallManager(forumlineStore)
  cleanups.push(destroyCallManager)
  const callOverlay = createCallOverlay()
  root.appendChild(callOverlay.el)
  cleanups.push(callOverlay.destroy)

  // ---- Init ----
  fetchMemberships()
  registerPush()
  startDmUpdates()

  // Eagerly create DM panel (hidden) so conversations are pre-loaded when the user switches tabs
  const { isForumlineConnected } = forumlineStore.get()
  if (isForumlineConnected) {
    dmChild = createDmPanel({
      forumlineStore,
      onClose: () => { view = 'forums'; switchView() },
      onGoToSettings: () => { view = 'settings'; switchView() },
    })
    mainArea.appendChild(dmChild.el)
    hideEl(dmChild.el)
  }

  switchView()

  return {
    el: root,
    destroy() {
      webviewInstance?.destroy()
      dmChild?.destroy()
      settingsChild?.destroy()
      welcomeChild?.destroy()
      tabBarInstance?.destroy()
      cleanups.forEach((fn) => fn())
      if (copiedTimeout) clearTimeout(copiedTimeout)
    },
  }
}
