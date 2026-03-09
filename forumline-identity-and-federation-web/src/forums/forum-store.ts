/*
 * Forum membership store
 *
 * This file manages the user's list of connected forums, the active forum selection, and per-forum unread counts.
 *
 * It must:
 * - Store the list of forum memberships (domain, name, icon, API/web URLs, capabilities)
 * - Track which forum is currently active (selected for viewing)
 * - Track unread counts (notifications, chat mentions, DMs) per forum domain
 * - Add forums by fetching and validating their Forumline manifest from /.well-known/forumline-manifest.json
 * - Prevent duplicate forums from being added
 * - Remove forums from the list and deselect them if active
 * - Sync the forum list from the server (server is source of truth for memberships)
 * - Persist join/leave actions to the server as best-effort background calls
 * - Provide switchForum and goHome actions for navigation
 * - Clear all state on sign-out
 */
import type { UnreadCounts } from '@johnvondrashek/forumline-protocol'
import { createStore, type Store } from '../shared/store.js'

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

export interface ForumState {
  forums: ForumMembership[]
  activeForum: ForumMembership | null
  unreadCounts: Record<string, UnreadCounts>
}

export interface ForumStore extends Store<ForumState> {
  switchForum: (domain: string) => void
  goHome: () => void
  addForum: (url: string) => Promise<void>
  removeForum: (domain: string) => void
  setUnreadCounts: (domain: string, counts: UnreadCounts) => void
  syncFromServer: (accessToken: string) => Promise<void>
  clear: () => void
}

// ============================================================================
// Manifest fetch
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
  let normalized = url.trim()
  if (!/^https?:\/\//i.test(normalized)) {
    normalized = `https://${normalized}`
  }

  const manifestUrl = normalized.includes('/.well-known/forumline-manifest.json')
    ? normalized
    : `${normalized.replace(/\/$/, '')}/.well-known/forumline-manifest.json`

  const resp = await fetch(manifestUrl)
  if (!resp.ok) throw new Error(`Forum returned HTTP ${resp.status}: not a valid Forumline forum`)

  const manifest: ForumManifest = await resp.json()
  if (manifest.forumline_version !== '1') {
    throw new Error(`Unsupported Forumline version: ${manifest.forumline_version}`)
  }
  return manifest
}

// ============================================================================
// Server sync helpers
// ============================================================================

let _accessToken: string | null = null

function setAccessToken(token: string) {
  _accessToken = token
}

async function serverJoinForum(domain: string): Promise<void> {
  if (!_accessToken) return
  try {
    await fetch('/api/memberships/join', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${_accessToken}`,
      },
      body: JSON.stringify({ forum_domain: domain }),
    })
  } catch { /* best-effort */ }
}

async function serverLeaveForum(domain: string): Promise<void> {
  if (!_accessToken) return
  try {
    await fetch('/api/memberships', {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${_accessToken}`,
      },
      body: JSON.stringify({ forum_domain: domain }),
    })
  } catch { /* best-effort */ }
}

// ============================================================================
// Store factory
// ============================================================================

export function createForumStore(): ForumStore {
  const store = createStore<ForumState>({
    forums: [],
    activeForum: null,
    unreadCounts: {},
  })

  const forumStore: ForumStore = {
    ...store,

    switchForum(domain: string) {
      const state = store.get()
      const match = state.forums.find((f) => f.domain === domain) ?? null
      store.set({ ...state, activeForum: match })
    },

    goHome() {
      store.set((prev) => ({ ...prev, activeForum: null }))
    },

    async addForum(url: string) {
      const manifest = await fetchManifest(url)
      const state = store.get()
      if (state.forums.some((f) => f.domain === manifest.domain)) return

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

      const updated = [...state.forums, membership]
      store.set({ ...state, forums: updated })

      // Sync to server (fire-and-forget)
      serverJoinForum(manifest.domain)
    },

    removeForum(domain: string) {
      store.set((prev) => {
        const updated = prev.forums.filter((f) => f.domain !== domain)
        const active = prev.activeForum?.domain === domain ? null : prev.activeForum
        return { ...prev, forums: updated, activeForum: active }
      })

      // Sync to server (fire-and-forget)
      serverLeaveForum(domain)
    },

    setUnreadCounts(domain: string, counts: UnreadCounts) {
      store.set((prev) => ({
        ...prev,
        unreadCounts: { ...prev.unreadCounts, [domain]: counts },
      }))
    },

    clear() {
      _accessToken = null
      store.set({ forums: [], activeForum: null, unreadCounts: {} })
    },

    async syncFromServer(accessToken: string) {
      setAccessToken(accessToken)
      try {
        const res = await fetch('/api/memberships', {
          headers: { Authorization: `Bearer ${accessToken}` },
        })
        if (!res.ok) return
        const memberships: {
          forum_domain: string
          forum_name: string
          forum_icon_url: string | null
          api_base: string
          web_base: string
          capabilities: string[]
          joined_at: string
        }[] = await res.json()

        // Server is the source of truth — build new list and replace
        const forums: ForumMembership[] = memberships.map(m => ({
          domain: m.forum_domain,
          name: m.forum_name,
          icon_url: m.forum_icon_url || '',
          web_base: m.web_base,
          api_base: m.api_base,
          capabilities: m.capabilities || [],
          added_at: m.joined_at,
        }))

        store.set(prev => ({ ...prev, forums, activeForum: null }))
      } catch { /* non-critical */ }
    },
  }

  return forumStore
}
