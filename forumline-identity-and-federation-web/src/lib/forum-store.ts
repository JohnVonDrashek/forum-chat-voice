import type { UnreadCounts } from '@johnvondrashek/forumline-protocol'
import { createStore, type Store } from './store.js'

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
}

// ============================================================================
// localStorage helpers
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
  const forums = lsLoadForums()
  const activeDomain = lsGetActiveDomain()
  const activeForum = activeDomain ? forums.find((f) => f.domain === activeDomain) ?? null : null

  const store = createStore<ForumState>({
    forums,
    activeForum,
    unreadCounts: {},
  })

  const forumStore: ForumStore = {
    ...store,

    switchForum(domain: string) {
      const state = store.get()
      const match = state.forums.find((f) => f.domain === domain) ?? null
      lsSetActiveDomain(domain)
      store.set({ ...state, activeForum: match })
    },

    goHome() {
      lsSetActiveDomain(null)
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
      lsSaveForums(updated)
      store.set({ ...state, forums: updated })

      // Sync to server (fire-and-forget)
      serverJoinForum(manifest.domain)
    },

    removeForum(domain: string) {
      store.set((prev) => {
        const updated = prev.forums.filter((f) => f.domain !== domain)
        lsSaveForums(updated)
        const active = prev.activeForum?.domain === domain ? null : prev.activeForum
        if (prev.activeForum?.domain === domain) lsSetActiveDomain(null)
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

        if (!memberships.length) return

        // Merge server memberships with local state
        // Server is authoritative — add any missing, keep local extras until they sync
        const localForums = store.get().forums
        const localByDomain = new Map(localForums.map(f => [f.domain, f]))
        const serverDomains = new Set(memberships.map(m => m.forum_domain))

        const merged: ForumMembership[] = []

        // Add all server memberships
        for (const m of memberships) {
          const local = localByDomain.get(m.forum_domain)
          merged.push({
            domain: m.forum_domain,
            name: local?.name || m.forum_name,
            icon_url: local?.icon_url || m.forum_icon_url || '',
            web_base: local?.web_base || m.web_base,
            api_base: local?.api_base || m.api_base,
            capabilities: local?.capabilities || m.capabilities || [],
            accent_color: local?.accent_color,
            added_at: local?.added_at || m.joined_at,
          })
        }

        // Also sync any local-only forums to the server
        for (const local of localForums) {
          if (!serverDomains.has(local.domain)) {
            // Forum exists locally but not on server — sync it up
            serverJoinForum(local.domain)
            merged.push(local)
          }
        }

        lsSaveForums(merged)
        const activeDomain = lsGetActiveDomain()
        const activeForum = activeDomain ? merged.find(f => f.domain === activeDomain) ?? null : null
        store.set(prev => ({ ...prev, forums: merged, activeForum }))
      } catch { /* non-critical */ }
    },
  }

  return forumStore
}
