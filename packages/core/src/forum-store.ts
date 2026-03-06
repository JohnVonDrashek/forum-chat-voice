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
      store.set((prev) => {
        if (prev.forums.some((f) => f.domain === manifest.domain)) return prev

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

        const updated = [...prev.forums, membership]
        lsSaveForums(updated)
        return { ...prev, forums: updated }
      })
    },

    removeForum(domain: string) {
      store.set((prev) => {
        const updated = prev.forums.filter((f) => f.domain !== domain)
        lsSaveForums(updated)
        const active = prev.activeForum?.domain === domain ? null : prev.activeForum
        if (prev.activeForum?.domain === domain) lsSetActiveDomain(null)
        return { ...prev, forums: updated, activeForum: active }
      })
    },

    setUnreadCounts(domain: string, counts: UnreadCounts) {
      store.set((prev) => ({
        ...prev,
        unreadCounts: { ...prev.unreadCounts, [domain]: counts },
      }))
    },
  }

  return forumStore
}
