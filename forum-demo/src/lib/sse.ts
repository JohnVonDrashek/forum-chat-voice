/**
 * useSSE — Reusable hook for Server-Sent Events with auto-reconnect.
 *
 * Passes access_token as query param for auth (EventSource doesn't support headers).
 */

import { useEffect, useRef } from 'react'

export function useSSE(
  url: string | null,
  onMessage: (data: unknown) => void,
  getAccessToken?: () => Promise<string | null>,
) {
  const onMessageRef = useRef(onMessage)
  onMessageRef.current = onMessage

  useEffect(() => {
    if (!url) return

    let es: EventSource | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let cancelled = false

    async function connect() {
      if (cancelled) return

      let fullUrl = url!
      if (getAccessToken) {
        const token = await getAccessToken()
        if (!token) {
          // No auth token — retry later instead of connecting unauthenticated
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
          onMessageRef.current(data)
        } catch {
          // Ignore non-JSON messages (heartbeats, etc.)
        }
      }

      es.onerror = () => {
        if (cancelled) return
        es?.close()
        es = null
        // Reconnect after 3 seconds
        reconnectTimer = setTimeout(connect, 3000)
      }
    }

    connect()

    return () => {
      cancelled = true
      es?.close()
      if (reconnectTimer) clearTimeout(reconnectTimer)
    }
  }, [url, getAccessToken])
}
