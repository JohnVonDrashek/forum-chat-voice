/**
 * SSE helper with auto-reconnect.
 * Returns a cleanup function.
 */

import { getAccessToken } from './auth.js'

export function connectSSE(url, onMessage, requireAuth = false) {
  let es = null
  let reconnectTimer = null
  let cancelled = false

  async function connect() {
    if (cancelled) return

    let fullUrl = url
    if (requireAuth) {
      const token = await getAccessToken()
      if (!token) {
        reconnectTimer = setTimeout(connect, 3000)
        return
      }
      const sep = fullUrl.includes('?') ? '&' : '?'
      fullUrl = `${fullUrl}${sep}access_token=${encodeURIComponent(token)}`
    }

    es = new EventSource(fullUrl)

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        onMessage(data)
      } catch {
        // Ignore heartbeats
      }
    }

    es.onerror = () => {
      if (cancelled) return
      es?.close()
      es = null
      reconnectTimer = setTimeout(connect, 3000)
    }
  }

  connect()

  return () => {
    cancelled = true
    es?.close()
    if (reconnectTimer) clearTimeout(reconnectTimer)
  }
}
