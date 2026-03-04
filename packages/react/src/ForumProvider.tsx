/**
 * ForumProvider — Shared state for multi-forum management.
 *
 * In Tauri desktop app: uses IPC to communicate with the Rust backend.
 * On web: uses localStorage to persist forum list.
 */

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'
import type { UnreadCounts } from '@johnvondrashek/forumline-protocol'
import { isTauri } from './tauri'

// ============================================================================
// Types
// ============================================================================

export interface ForumMembership {
  domain: string
  name: string
  icon_url: string
  web_base: string
  api_base: string
  capabilities: string[]
  accent_color?: string
  added_at: string
}

interface ForumContextType {
  forums: ForumMembership[]
  activeForum: ForumMembership | null
  unreadCounts: Record<string, UnreadCounts>
  switchForum: (domain: string) => Promise<void>
  goHome: () => void
  addForum: (url: string) => Promise<void>
  removeForum: (domain: string) => Promise<void>
}

// ============================================================================
// localStorage helpers (web)
// ============================================================================

const LS_FORUMS_KEY = 'forumline_forums'
const LS_ACTIVE_KEY = 'forumline_active_forum'

function lsLoadForums(): ForumMembership[] {
  try {
    const raw = localStorage.getItem(LS_FORUMS_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function lsSaveForums(forums: ForumMembership[]) {
  localStorage.setItem(LS_FORUMS_KEY, JSON.stringify(forums))
}

function lsGetActiveDomain(): string | null {
  return localStorage.getItem(LS_ACTIVE_KEY)
}

function lsSetActiveDomain(domain: string | null) {
  if (domain) {
    localStorage.setItem(LS_ACTIVE_KEY, domain)
  } else {
    localStorage.removeItem(LS_ACTIVE_KEY)
  }
}

// ============================================================================
// Manifest fetch (web)
// ============================================================================

interface ForumManifest {
  forumline_version: string
  name: string
  domain: string
  icon_url: string
  api_base: string
  web_base: string
  capabilities: string[]
  accent_color?: string
}

async function fetchManifest(url: string): Promise<ForumManifest> {
  const manifestUrl = url.includes('/.well-known/forumline-manifest.json')
    ? url
    : `${url.replace(/\/$/, '')}/.well-known/forumline-manifest.json`

  const resp = await fetch(manifestUrl)
  if (!resp.ok) throw new Error(`Forum returned HTTP ${resp.status}: not a valid Forumline forum`)

  const manifest: ForumManifest = await resp.json()
  if (manifest.forumline_version !== '1') {
    throw new Error(`Unsupported Forumline version: ${manifest.forumline_version}`)
  }
  return manifest
}

// ============================================================================
// Tauri IPC helpers (dynamic imports)
// ============================================================================

async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<T>(cmd, args)
}

async function tauriListen<T>(event: string, handler: (event: { payload: T }) => void) {
  const { listen } = await import('@tauri-apps/api/event')
  return listen<T>(event, handler)
}

// ============================================================================
// Context
// ============================================================================

const ForumContext = createContext<ForumContextType | null>(null)

export function useForum(): ForumContextType {
  const ctx = useContext(ForumContext)
  if (!ctx) throw new Error('useForum must be used within ForumProvider')
  return ctx
}

// ============================================================================
// Provider
// ============================================================================

export function ForumProvider({ children }: { children: ReactNode }) {
  const [forums, setForums] = useState<ForumMembership[]>([])
  const [activeForum, setActiveForum] = useState<ForumMembership | null>(null)
  const [unreadCounts, setUnreadCounts] = useState<Record<string, UnreadCounts>>({})
  const tauriActive = isTauri()

  // Load forum list on mount
  useEffect(() => {
    if (tauriActive) {
      // Tauri: load from Rust backend
      const load = async () => {
        try {
          const list = await tauriInvoke<ForumMembership[]>('get_forum_list')
          setForums(list)

          const activeDomain = await tauriInvoke<string | null>('get_active_forum')
          if (activeDomain) {
            const match = list.find(f => f.domain === activeDomain) ?? null
            setActiveForum(match)
          }

          const counts = await tauriInvoke<Record<string, UnreadCounts>>('get_unread_counts')
          setUnreadCounts(counts)
        } catch (err) {
          console.error('[Forumline:Forum] Failed to load forum list:', err)
        }
      }
      load()
    } else {
      // Web: load from localStorage
      const list = lsLoadForums()
      setForums(list)

      const activeDomain = lsGetActiveDomain()
      if (activeDomain) {
        const match = list.find(f => f.domain === activeDomain) ?? null
        setActiveForum(match)
      }
    }
  }, [tauriActive])

  // Listen for forum switch events from Rust backend (Tauri only)
  useEffect(() => {
    if (!tauriActive) return
    let unlisten: (() => void) | undefined
    tauriListen<string>('forum-switched', (event) => {
      const domain = event.payload
      setForums(currentForums => {
        const match = currentForums.find(f => f.domain === domain) ?? null
        setActiveForum(match)
        return currentForums
      })
    }).then(fn => { unlisten = fn })
    return () => { unlisten?.() }
  }, [tauriActive])

  const switchForum = useCallback(async (domain: string) => {
    if (tauriActive) {
      try {
        await tauriInvoke('switch_forum', { domain })
        setForums(currentForums => {
          const match = currentForums.find(f => f.domain === domain) ?? null
          setActiveForum(match)
          return currentForums
        })
      } catch (err) {
        console.error('[Forumline:Forum] Failed to switch forum:', err)
      }
    } else {
      // Web: switch active forum in localStorage
      setForums(currentForums => {
        const match = currentForums.find(f => f.domain === domain) ?? null
        setActiveForum(match)
        lsSetActiveDomain(domain)
        return currentForums
      })
    }
  }, [tauriActive])

  const goHome = useCallback(() => {
    setActiveForum(null)
    if (!tauriActive) {
      lsSetActiveDomain(null)
    }
  }, [tauriActive])

  const addForum = useCallback(async (url: string) => {
    if (tauriActive) {
      await tauriInvoke('add_forum', { url })
      const list = await tauriInvoke<ForumMembership[]>('get_forum_list')
      setForums(list)
    } else {
      // Web: fetch manifest and add to localStorage
      const manifest = await fetchManifest(url)

      setForums(prev => {
        if (prev.some(f => f.domain === manifest.domain)) return prev

        const membership: ForumMembership = {
          domain: manifest.domain,
          name: manifest.name,
          icon_url: manifest.icon_url,
          web_base: manifest.web_base,
          api_base: manifest.api_base,
          capabilities: manifest.capabilities,
          accent_color: manifest.accent_color,
          added_at: new Date().toISOString(),
        }

        const updated = [...prev, membership]
        lsSaveForums(updated)
        return updated
      })
    }
  }, [tauriActive])

  const removeForum = useCallback(async (domain: string) => {
    if (tauriActive) {
      await tauriInvoke('remove_forum', { domain })
      const list = await tauriInvoke<ForumMembership[]>('get_forum_list')
      setForums(list)
      setActiveForum(prev => prev?.domain === domain ? null : prev)
      setUnreadCounts(prev => {
        const next = { ...prev }
        delete next[domain]
        return next
      })
    } else {
      // Web: remove from localStorage
      setForums(prev => {
        const updated = prev.filter(f => f.domain !== domain)
        lsSaveForums(updated)
        return updated
      })
      setActiveForum(prev => {
        if (prev?.domain === domain) {
          lsSetActiveDomain(null)
          return null
        }
        return prev
      })
    }
  }, [tauriActive])

  return (
    <ForumContext.Provider value={{
      forums,
      activeForum,
      unreadCounts,
      switchForum,
      goHome,
      addForum,
      removeForum,
    }}>
      {children}
    </ForumContext.Provider>
  )
}
