import type { Signal } from './types.js'

type Handler = (signal: Signal) => void

/**
 * Manages the signal channel: POST to send, SSE to receive.
 * Routes incoming signals to handlers by type.
 * All signal types flow through one channel — WebRTC signals,
 * call lifecycle events, escalation, and any future types.
 */
export class SignalBus {
  private apiBase: string
  private getAuthToken: () => string | Promise<string>
  private handlers = new Map<string, Set<Handler>>()
  private wildcardHandlers = new Set<Handler>()
  private sse: EventSource | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectAttempts = 0
  private closed = false

  constructor(apiBase: string, getAuthToken: () => string | Promise<string>) {
    this.apiBase = apiBase
    this.getAuthToken = getAuthToken
  }

  /** Send a signal to a target user */
  async send(signal: Signal): Promise<void> {
    const token = await this.getAuthToken()
    await fetch(`${this.apiBase}/signal`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        target_user_id: signal.targetUserId,
        type: signal.type,
        payload: signal.payload,
      }),
    })
  }

  /** Subscribe to signals of a specific type. Returns unsubscribe function. */
  on(type: string, handler: Handler): () => void {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set())
    this.handlers.get(type)!.add(handler)
    return () => { this.handlers.get(type)?.delete(handler) }
  }

  /** Subscribe to all signals regardless of type. Returns unsubscribe function. */
  onAny(handler: Handler): () => void {
    this.wildcardHandlers.add(handler)
    return () => { this.wildcardHandlers.delete(handler) }
  }

  /** Open the SSE stream */
  async connect(): Promise<void> {
    this.closed = false
    await this.openSSE()
  }

  /** Close the SSE stream and stop reconnecting */
  close(): void {
    this.closed = true
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null }
    if (this.sse) { this.sse.close(); this.sse = null }
    this.reconnectAttempts = 0
  }

  private async openSSE(): Promise<void> {
    if (this.closed) return
    const token = await this.getAuthToken()
    this.sse = new EventSource(
      `${this.apiBase}/signal/stream?access_token=${encodeURIComponent(token)}`,
    )

    this.sse.onopen = () => { this.reconnectAttempts = 0 }

    this.sse.onmessage = (event) => {
      try {
        const raw = JSON.parse(event.data)
        // Expect standardized shape: { target_user_id, sender_user_id, type, payload }
        // All signal types (WebRTC, call lifecycle, etc.) must nest their data in payload.
        const signal: Signal = {
          targetUserId: raw.target_user_id ?? '',
          senderUserId: raw.sender_user_id ?? '',
          type: raw.type,
          payload: raw.payload ?? {},
        }

        // Route to type-specific handlers
        const handlers = this.handlers.get(signal.type)
        if (handlers) {
          for (const h of handlers) { try { h(signal) } catch { /* handler error */ } }
        }
        // Route to wildcard handlers
        for (const h of this.wildcardHandlers) { try { h(signal) } catch { /* handler error */ } }
      } catch { /* parse error */ }
    }

    this.sse.onerror = () => {
      this.sse?.close()
      this.sse = null
      if (this.closed) return
      const base = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000)
      this.reconnectAttempts++
      this.reconnectTimer = setTimeout(() => this.openSSE(), base + Math.random() * base * 0.3)
    }
  }
}
