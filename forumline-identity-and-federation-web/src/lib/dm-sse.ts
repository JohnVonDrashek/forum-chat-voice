import { forumlineAuth } from '../app.js'

export interface DmEvent {
  conversation_id: string
  sender_id: string
  content?: string
}

type DmEventListener = (event: DmEvent) => void

/**
 * Singleton SSE connection for DM events.
 * Multiple components subscribe/unsubscribe; connection is opened when
 * there's at least one listener and closed when the last one leaves.
 */
let eventSource: EventSource | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let destroyed = false
const listeners = new Set<DmEventListener>()

function connect() {
  if (destroyed || eventSource) return
  const session = forumlineAuth.getSession()
  if (!session) return

  const url = `/api/conversations/stream?access_token=${encodeURIComponent(session.access_token)}`
  eventSource = new EventSource(url)

  eventSource.onmessage = (event) => {
    let parsed: DmEvent | null = null
    try {
      parsed = JSON.parse(event.data) as DmEvent
    } catch {
      // Unparseable — notify all listeners with a minimal event
    }
    for (const fn of listeners) {
      fn(parsed ?? { conversation_id: '', sender_id: '' })
    }
  }

  eventSource.onerror = () => {
    eventSource?.close()
    eventSource = null
    if (!destroyed && listeners.size > 0) {
      reconnectTimer = setTimeout(connect, 5000)
    }
  }
}

function disconnect() {
  destroyed = true
  eventSource?.close()
  eventSource = null
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
}

export function subscribeDmEvents(fn: DmEventListener): () => void {
  listeners.add(fn)
  destroyed = false
  if (!eventSource) connect()

  return () => {
    listeners.delete(fn)
    if (listeners.size === 0) {
      disconnect()
    }
  }
}
