import type { GoTrueAuthClient, ForumlineSession } from '../lib/gotrue-auth.js'
import type { ForumNotification } from '@johnvondrashek/forumline-protocol'
import { createForumWebview, isTauri, getTauriNotification, setupDeepLinkListener, type ForumStore, type ForumlineStore, type DeepLinkTarget } from '@johnvondrashek/forumline-core'
import { createWelcomePage } from './welcome-page.js'
import { createDmPanel } from './dm-panel.js'
import { createSettingsPage } from './settings-page.js'
import { createMobileTabBar, type AppView } from './mobile-tab-bar.js'
import type { ForumWebviewInstance } from '@johnvondrashek/forumline-core'

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
    console.error('[Hub] Failed to persist forum auth state:', err)
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
  let dmPollInterval: ReturnType<typeof setInterval> | null = null

  // Persistent child instances — created lazily, kept alive
  let webviewInstance: ForumWebviewInstance | null = null
  let webviewForumDomain: string | null = null // track which forum the webview is showing
  let dmChild: { el: HTMLElement; destroy: () => void } | null = null
  let settingsChild: { el: HTMLElement; destroy: () => void } | null = null
  let welcomeChild: { el: HTMLElement; destroy: () => void } | null = null
  let tabBarInstance: ReturnType<typeof createMobileTabBar> | null = null

  // View containers — persistent wrappers for each view
  const forumContainer = document.createElement('div')
  forumContainer.className = 'flex flex-col flex-1 overflow-hidden'

  const cleanups: (() => void)[] = []

  // Root element
  const root = document.createElement('div')
  root.className = 'app-root'

  const mainArea = document.createElement('div')
  mainArea.className = 'app-main'
  root.appendChild(mainArea)

  // Tab bar
  tabBarInstance = createMobileTabBar({
    forumStore,
    onChangeView: (v) => {
      view = v
      switchView()
    },
  })
  root.appendChild(tabBarInstance.el)

  // ---- DM polling ----
  function startDmPolling() {
    const { forumlineClient } = forumlineStore.get()
    if (!forumlineClient) return

    const fetchDmCount = async () => {
      try {
        const convos = await forumlineClient.getConversations()
        dmUnreadCount = convos.reduce((sum, c) => sum + c.unreadCount, 0)
        tabBarInstance?.update(view, dmUnreadCount)
      } catch { /* ignore */ }
    }
    fetchDmCount()
    dmPollInterval = setInterval(fetchDmCount, 30_000)
    cleanups.push(() => { if (dmPollInterval) clearInterval(dmPollInterval) })
  }

  // ---- Deep links ----
  const cleanupDeepLink = setupDeepLinkListener((target: DeepLinkTarget) => {
    forumStore.switchForum(target.domain)
    deepLinkPath = target.path
    switchView()
  })
  cleanups.push(cleanupDeepLink)

  // ---- Memberships fetch ----
  async function fetchMemberships() {
    try {
      const session = auth.getSession()
      if (!session) return
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
        console.error('[Hub] Push subscription failed:', err)
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
      forumHeaderEl = document.createElement('div')
      forumHeaderEl.className = 'forum-header'
    }
    forumHeaderEl.innerHTML = ''

    const backBtn = document.createElement('button')
    backBtn.className = 'forum-header__back'
    backBtn.innerHTML = `<svg class="icon-sm" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/></svg><span>${activeForum?.name ?? ''}</span>`
    backBtn.addEventListener('click', () => forumStore.goHome())
    forumHeaderEl.appendChild(backBtn)

    const shareBtn = document.createElement('button')
    shareBtn.className = 'forum-header__share'
    shareBtn.title = 'Copy link to this page'
    if (copied) {
      shareBtn.innerHTML = `<svg class="icon-sm" style="color:var(--color-green)" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>`
    } else {
      shareBtn.innerHTML = `<svg class="icon-sm" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"/></svg>`
    }
    shareBtn.addEventListener('click', handleShare)
    forumHeaderEl.appendChild(shareBtn)

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
      forumContainer.appendChild(forumHeaderEl!)

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

  // ---- Init ----
  fetchMemberships()
  registerPush()
  startDmPolling()
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
