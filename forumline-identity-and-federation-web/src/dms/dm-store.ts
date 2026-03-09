/*
 * DM conversation store (singleton)
 *
 * This file owns the canonical list of DM conversations and a derived unread count.
 *
 * It must:
 * - Hold a Van.js state of conversations, shared across the app
 * - Derive the total unread count automatically when conversations change
 * - Fetch conversations from the server, updating the state
 * - Subscribe to SSE events and poll as a fallback, so conversations stay current
 * - Allow components to start/stop the update loop (SSE + poll) with reference counting
 * - Expose a refreshConversations function so dm-message-view can trigger a re-fetch after marking read
 */
import type { ForumlineStore } from '../shared/forumline-store.js'
import type { ForumlineDmConversation } from '@johnvondrashek/forumline-protocol'
import { state, derive } from '../shared/dom.js'
import { subscribeDmEvents } from './dm-sse.js'

export type Conversation = ForumlineDmConversation

// Singleton reactive state
const conversations = state<Conversation[]>([])
const initialLoad = state(true)
const loadError = state(false)

// Derived unread count — recomputes whenever conversations.val is assigned
const unreadCount = state(0)
derive(() => {
  unreadCount.val = conversations.val.reduce((sum, c) => sum + c.unreadCount, 0)
})

let forumlineStoreRef: ForumlineStore | null = null
let sseUnsub: (() => void) | null = null
let sseDebounce: ReturnType<typeof setTimeout> | null = null
let pollInterval: ReturnType<typeof setInterval> | null = null
let refCount = 0

async function fetchConversations() {
  if (!forumlineStoreRef) return
  const { forumlineClient } = forumlineStoreRef.get()
  if (!forumlineClient) return
  try {
    const data = await forumlineClient.getConversations()
    conversations.val = data
    initialLoad.val = false
    loadError.val = false
  } catch {
    if (initialLoad.val) {
      loadError.val = true
      initialLoad.val = false
    }
  }
}

/** Start SSE + poll updates. Ref-counted -- multiple callers share one loop. */
function startUpdates(forumlineStore: ForumlineStore): () => void {
  forumlineStoreRef = forumlineStore
  refCount++

  if (refCount === 1) {
    // First subscriber -- kick off fetching
    fetchConversations()

    sseUnsub = subscribeDmEvents(() => {
      if (sseDebounce) clearTimeout(sseDebounce)
      sseDebounce = setTimeout(fetchConversations, 200)
    })

    pollInterval = setInterval(fetchConversations, 30_000)
  }

  return () => {
    refCount--
    if (refCount === 0) {
      sseUnsub?.()
      sseUnsub = null
      if (sseDebounce) { clearTimeout(sseDebounce); sseDebounce = null }
      if (pollInterval) { clearInterval(pollInterval); pollInterval = null }
    }
  }
}

export {
  conversations,
  initialLoad,
  loadError,
  unreadCount,
  fetchConversations,
  startUpdates,
}
