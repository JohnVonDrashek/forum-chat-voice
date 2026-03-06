import type { Session } from '@supabase/supabase-js'
import type { ForumNotification } from '@johnvondrashek/forumline-protocol'
import { createForumWebview, isTauri, getTauriNotification, setupDeepLinkListener, type ForumStore, type HubStore, type DeepLinkTarget } from '@johnvondrashek/forumline-core'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createWelcomePage } from './welcome-page.js'
import { createDmPanel } from './dm-panel.js'
import { createSettingsPage } from './settings-page.js'
import { createMobileTabBar, type AppView } from './mobile-tab-bar.js'
import type { ForumWebviewInstance } from '@johnvondrashek/forumline-core'

/** Persist auth state change to hub DB */
async function updateForumAuthState(accessToken: string, forumDomain: string, authed: boolean) {
  try {
    await fetch('/api/memberships', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ forum_domain: forumDomain, authed }),
    })
  } catch (err) {
    console.error('[Hub] Failed to persist forum auth state:', err)
  }
}

interface AppLayoutOptions {
  hubSession: Session
  forumStore: ForumStore
  hubStore: HubStore
  supabase: SupabaseClient
}

export function createAppLayout({ hubSession, forumStore, hubStore, supabase }: AppLayoutOptions) {
  let view: AppView = 'forums'
  let authedForums: Set<string> | null = null
  let mutedForums = new Set<string>()
  let deepLinkPath: string | null = null
  let forumPath = '/'
  let copied = false
  let copiedTimeout: ReturnType<typeof setTimeout> | null = null
  let dmUnreadCount = 0
  let dmPollInterval: ReturnType<typeof setInterval> | null = null

  // Child instances
  let currentChild: { el: HTMLElement; destroy: () => void } | null = null
  let webviewInstance: ForumWebviewInstance | null = null
  let tabBarInstance: ReturnType<typeof createMobileTabBar> | null = null

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
      render()
    },
  })
  root.appendChild(tabBarInstance.el)

  // ---- DM polling ----
  function startDmPolling() {
    const { hubClient } = hubStore.get()
    if (!hubClient) return

    const fetchDmCount = async () => {
      try {
        const convos = await hubClient.getConversations()
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
    render()
  })
  cleanups.push(cleanupDeepLink)

  // ---- Memberships fetch ----
  async function fetchMemberships() {
    try {
      const res = await fetch('/api/memberships', {
        headers: { Authorization: `Bearer ${hubSession.access_token}` },
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
        await fetch('/api/push?action=subscribe', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${hubSession.access_token}`,
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

  // ---- Main render ----
  function render() {
    // Destroy previous child
    currentChild?.destroy()
    currentChild = null
    webviewInstance?.destroy()
    webviewInstance = null
    forumHeaderEl = null

    mainArea.innerHTML = ''
    tabBarInstance?.update(view, dmUnreadCount)

    const { activeForum } = forumStore.get()
    const { isHubConnected } = hubStore.get()

    if (view === 'settings') {
      const settings = createSettingsPage({
        hubSession,
        forumStore,
        hubStore,
        supabase,
        onClose: () => { view = 'forums'; render() },
      })
      currentChild = settings
      mainArea.appendChild(settings.el)
      return
    }

    if (view === 'dms') {
      const dm = createDmPanel({
        hubStore,
        onClose: () => { view = 'forums'; render() },
        onGoToSettings: () => { view = 'settings'; render() },
      })
      currentChild = dm
      mainArea.appendChild(dm.el)
      return
    }

    // Forums view
    if (activeForum) {
      const forumView = document.createElement('div')
      forumView.className = 'flex flex-col flex-1 overflow-hidden'

      // Forum header
      renderForumHeader()
      forumView.appendChild(forumHeaderEl!)

      // Auth URL
      const authUrl = hubSession && authedForums !== null && !authedForums.has(activeForum.domain)
        ? `${activeForum.api_base}/auth?hub_token=${hubSession.access_token}`
        : null

      // Webview
      webviewInstance = createForumWebview({
        forum: activeForum,
        authUrl,
        initialPath: deepLinkPath,
        onAuthed: (domain) => {
          authedForums?.add(domain)
          updateForumAuthState(hubSession.access_token, domain, true)
        },
        onSignedOut: (domain) => {
          authedForums?.delete(domain)
          updateForumAuthState(hubSession.access_token, domain, false)
        },
        onUnreadCounts: (domain, counts) => forumStore.setUnreadCounts(domain, counts),
        onNotification: handleForumNotification,
        onNavigate: (_domain, path) => { forumPath = path },
      })

      forumView.appendChild(webviewInstance.el)
      mainArea.appendChild(forumView)

      deepLinkPath = null
      forumPath = '/'
      return
    }

    // No active forum — welcome page
    const welcome = createWelcomePage({
      hubSession,
      forumStore,
      hubStore,
      onGoToSettings: () => { view = 'settings'; render() },
    })
    currentChild = welcome
    mainArea.appendChild(welcome.el)
  }

  // ---- Subscribe to store changes ----
  const unsubForum = forumStore.subscribe(() => {
    if (view === 'forums') render()
  })
  cleanups.push(unsubForum)

  // ---- Init ----
  fetchMemberships()
  registerPush()
  startDmPolling()
  render()

  return {
    el: root,
    destroy() {
      currentChild?.destroy()
      webviewInstance?.destroy()
      tabBarInstance?.destroy()
      cleanups.forEach((fn) => fn())
      if (copiedTimeout) clearTimeout(copiedTimeout)
    },
  }
}
