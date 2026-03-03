/**
 * ForumProvider — Shared state for multi-forum management in the Tauri desktop app.
 *
 * Follows the standard Provider/hook pattern.
 * On web (non-Tauri), provides empty state and no-op functions.
 */

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'
import type { UnreadCounts } from '@forumline/protocol'
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

  // Load forum list on mount (Tauri only)
  useEffect(() => {
    if (!tauriActive) return
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
  }, [tauriActive])

  // Listen for forum switch events from Rust backend
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
    if (!tauriActive) return
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
  }, [tauriActive])

  const goHome = useCallback(() => {
    setActiveForum(null)
  }, [])

  const addForum = useCallback(async (url: string) => {
    if (!tauriActive) return
    await tauriInvoke('add_forum', { url })
    const list = await tauriInvoke<ForumMembership[]>('get_forum_list')
    setForums(list)
  }, [tauriActive])

  const removeForum = useCallback(async (domain: string) => {
    if (!tauriActive) return
    await tauriInvoke('remove_forum', { domain })
    const list = await tauriInvoke<ForumMembership[]>('get_forum_list')
    setForums(list)
    setActiveForum(prev => prev?.domain === domain ? null : prev)
    setUnreadCounts(prev => {
      const next = { ...prev }
      delete next[domain]
      return next
    })
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
