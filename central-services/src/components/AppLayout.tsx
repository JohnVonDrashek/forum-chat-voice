import { useState, useCallback, useEffect } from 'react'
import type { Session } from '@supabase/supabase-js'
import { useQuery } from '@tanstack/react-query'
import type { ForumNotification } from '@johnvondrashek/forumline-protocol'
import { ForumWebview, useForum, useHub, isTauri, getTauriNotification, useDeepLink } from '@johnvondrashek/forumline-react'
import type { DeepLinkTarget } from '@johnvondrashek/forumline-react'
import { hubSupabase } from '../App'
import WelcomePage from './WelcomePage'
import DmPanel from './DmPanel'
import SettingsPage from './SettingsPage'
import MobileTabBar from './MobileTabBar'

type AppView = 'forums' | 'settings' | 'dms'

interface AppLayoutProps {
  hubSession: Session | null
}

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

export default function AppLayout({ hubSession }: AppLayoutProps) {
  const { activeForum, setUnreadCounts, switchForum, goHome } = useForum()
  const { hubClient, isHubConnected } = useHub()
  const [view, setView] = useState<AppView>('forums')
  const [authedForums, setAuthedForums] = useState<Set<string> | null>(null)
  const [deepLinkPath, setDeepLinkPath] = useState<string | null>(null)
  const [forumPath, setForumPath] = useState('/')
  const [copied, setCopied] = useState(false)
  const [mutedForums, setMutedForums] = useState<Set<string>>(new Set())

  const { data: dmConversations } = useQuery({
    queryKey: ['hub', 'dm', 'conversations'],
    queryFn: () => hubClient!.getConversations(),
    enabled: !!hubClient,
    staleTime: 10_000,
    refetchInterval: 30_000,
  })
  const dmUnreadCount = (dmConversations ?? []).reduce((sum, c) => sum + c.unreadCount, 0)

  // Handle deep links (desktop only)
  const handleDeepLink = useCallback((target: DeepLinkTarget) => {
    switchForum(target.domain)
    setDeepLinkPath(target.path)
  }, [switchForum])
  useDeepLink(handleDeepLink)

  // Clear deep link path and forum path when forum changes
  useEffect(() => {
    setForumPath('/')
    return () => setDeepLinkPath(null)
  }, [activeForum?.domain])

  const handleNavigate = useCallback((_domain: string, path: string) => {
    setForumPath(path)
  }, [])

  const handleShare = useCallback(() => {
    if (!activeForum) return
    const url = activeForum.web_base + forumPath
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }, [activeForum, forumPath])

  // Pre-populate authedForums from persisted membership data on mount
  useEffect(() => {
    if (!hubSession) {
      setAuthedForums(new Set())
      return
    }
    const fetchMemberships = async () => {
      try {
        const res = await fetch('/api/memberships', {
          headers: { Authorization: `Bearer ${hubSession.access_token}` },
        })
        if (!res.ok) return
        const memberships: { forum_domain: string; forum_authed_at: string | null; notifications_muted?: boolean }[] = await res.json()
        const authed = new Set(
          memberships.filter(m => m.forum_authed_at).map(m => m.forum_domain),
        )
        setAuthedForums(authed)
        setMutedForums(new Set(
          memberships.filter(m => m.notifications_muted).map(m => m.forum_domain),
        ))
      } catch {
        // Non-critical — postMessage handshake will detect auth state anyway
      }
    }
    fetchMemberships()
  }, [hubSession])

  const authUrlForForum = activeForum && hubSession && authedForums !== null && !authedForums.has(activeForum.domain)
    ? `${activeForum.api_base}/auth?hub_token=${hubSession.access_token}`
    : null

  const handleForumAuthed = useCallback((domain: string) => {
    setAuthedForums(prev => new Set<string>(prev ?? new Set<string>()).add(domain))
    if (hubSession) updateForumAuthState(hubSession.access_token, domain, true)
  }, [hubSession])

  const handleForumSignedOut = useCallback((domain: string) => {
    setAuthedForums(prev => {
      const next = new Set<string>(prev ?? new Set<string>())
      next.delete(domain)
      return next
    })
    if (hubSession) updateForumAuthState(hubSession.access_token, domain, false)
  }, [hubSession])

  const handleForumNotification = useCallback(async (domain: string, notification: ForumNotification) => {
    // Skip if forum is muted
    if (mutedForums.has(domain)) return
    // Only notify when window is not visible (works on mobile too)
    if (document.visibilityState === 'visible') return

    const { title, body } = notification

    if (isTauri()) {
      try {
        const { sendNotification, isPermissionGranted, requestPermission } = await getTauriNotification()
        let permitted = await isPermissionGranted()
        if (!permitted) {
          const result = await requestPermission()
          permitted = result === 'granted'
        }
        if (permitted) {
          sendNotification({ title, body })
        }
      } catch (err) {
        console.error('[Hub] Tauri notification error:', err)
      }
    } else if ('Notification' in window) {
      if (Notification.permission === 'default') {
        await Notification.requestPermission()
      }
      if (Notification.permission === 'granted') {
        new Notification(title, { body })
      }
    }
  }, [mutedForums])

  // DM notification listener — fires native/browser notification on new DMs
  useEffect(() => {
    if (!hubSession) return

    const channel = hubSupabase
      .channel('dm-notifications')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'hub_direct_messages',
          filter: `recipient_id=eq.${hubSession.user.id}`,
        },
        async (payload) => {
          // Don't notify if DM panel is active and visible
          if (view === 'dms' && document.visibilityState === 'visible') return

          const row = payload.new as { sender_id: string; content: string }

          // Look up sender's username
          const { data: sender } = await hubSupabase
            .from('hub_profiles')
            .select('username')
            .eq('id', row.sender_id)
            .single()

          const title = `Message from ${sender?.username ?? 'someone'}`
          const body = row.content.length > 100 ? row.content.slice(0, 100) + '...' : row.content

          if (isTauri()) {
            try {
              const { sendNotification, isPermissionGranted, requestPermission } = await getTauriNotification()
              let permitted = await isPermissionGranted()
              if (!permitted) {
                const result = await requestPermission()
                permitted = result === 'granted'
              }
              if (permitted) sendNotification({ title, body })
            } catch (err) {
              console.error('[Hub] DM notification error:', err)
            }
          } else if ('Notification' in window) {
            if (Notification.permission === 'default') {
              await Notification.requestPermission()
            }
            if (Notification.permission === 'granted') {
              new Notification(title, { body })
            }
          }
        },
      )
      .subscribe()

    return () => {
      hubSupabase.removeChannel(channel)
    }
  }, [hubSession, view])

  // Register service worker + push subscription
  useEffect(() => {
    if (!hubSession || !('serviceWorker' in navigator) || !('PushManager' in window)) return

    const vapidPublicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY
    if (!vapidPublicKey) return

    let cancelled = false

    const registerPush = async () => {
      try {
        const registration = await navigator.serviceWorker.register('/sw.js')
        await navigator.serviceWorker.ready

        // Check for existing subscription or create new one
        let subscription = await registration.pushManager.getSubscription()
        if (!subscription) {
          // Convert VAPID key from URL-safe base64 to Uint8Array
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

        // Send subscription to server
        const sub = subscription.toJSON()
        await fetch('/api/push?action=subscribe', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${hubSession.access_token}`,
          },
          body: JSON.stringify({
            endpoint: sub.endpoint,
            keys: sub.keys,
          }),
        })
      } catch (err) {
        console.error('[Hub] Push subscription failed:', err)
      }
    }

    registerPush()
    return () => { cancelled = true }
  }, [hubSession])

  // Listen for notification click from service worker
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.data?.type === 'notification-click') {
        const { forum_domain, link } = event.data
        if (forum_domain) {
          switchForum(forum_domain)
        }
      }
    }
    navigator.serviceWorker?.addEventListener('message', handler)
    return () => navigator.serviceWorker?.removeEventListener('message', handler)
  }, [switchForum])

  return (
    <div className="flex h-dvh flex-col">
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        {view === 'settings' && (
          <SettingsPage hubSession={hubSession} onClose={() => setView('forums')} />
        )}

        {view === 'dms' && (
          <DmPanel onClose={() => setView('forums')} onGoToSettings={() => setView('settings')} />
        )}

        {activeForum && (
          <div className={view !== 'forums' ? 'hidden' : 'flex flex-1 flex-col overflow-hidden'}>
            <div className="flex shrink-0 items-center border-b border-slate-700 bg-slate-900">
              <button
                onClick={goHome}
                className="flex flex-1 items-center gap-2 px-4 py-2.5 text-slate-300 hover:text-white"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                <span className="text-sm font-medium">{activeForum.name}</span>
              </button>
              <button
                onClick={handleShare}
                className="px-3 py-2.5 text-slate-400 hover:text-white transition-colors"
                title="Copy link to this page"
              >
                {copied ? (
                  <svg className="h-4 w-4 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                  </svg>
                )}
              </button>
            </div>
            <ForumWebview
              forum={activeForum}
              authUrl={authUrlForForum}
              onAuthed={handleForumAuthed}
              onSignedOut={handleForumSignedOut}
              onUnreadCounts={setUnreadCounts}
              onNotification={handleForumNotification}
              onNavigate={handleNavigate}
              initialPath={deepLinkPath}
            />
          </div>
        )}

        {view === 'forums' && !activeForum && (
          <WelcomePage hubSession={hubSession} isHubConnected={isHubConnected} onGoToSettings={() => setView('settings')} />
        )}
      </div>

      <MobileTabBar
        view={view}
        onChangeView={setView}
        dmUnreadCount={dmUnreadCount}
      />
    </div>
  )
}
