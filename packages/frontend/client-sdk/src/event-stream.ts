/**
 * @module event-stream
 *
 * Single SSE connection multiplexed across DM, notification, and call events.
 * Automatically connects when the first subscriber registers and disconnects
 * when the last one unsubscribes. Reconnects with exponential backoff on failure.
 *
 * @example
 * ```ts
 * const unsub = EventStream.subscribeDm((event) => {
 *   console.log('New DM in', event.conversation_id);
 * });
 * // later: unsub() to stop listening
 * ```
 */

import { ForumlineAPI } from './client.js';

/** SSE event payload for direct message activity. */
export interface DmEvent {
  /** Conversation that received a new message. */
  conversation_id: string;
  /** User who sent the message. */
  sender_id: string;
  [key: string]: unknown;
}

/** SSE event payload for a notification. */
export interface NotificationEvent {
  /** Notification ID. */
  id: string;
  /** Notification type (e.g. `"reply"`, `"mention"`). */
  type: string;
  [key: string]: unknown;
}

/** SSE event payload for call signaling (incoming, accepted, declined, ended). */
export interface CallSignal {
  /** Signal type: `"incoming_call"`, `"call_accepted"`, `"call_declined"`, or `"call_ended"`. */
  type: string;
  call_id?: string;
  conversation_id?: string;
  caller_id?: string;
  caller_display_name?: string;
  caller_username?: string;
  caller_avatar_url?: string | null;
  [key: string]: unknown;
}

/** Callback for {@link EventStream.subscribeDm}. */
export type DmListener = (event: DmEvent) => void;
/** Callback for {@link EventStream.subscribeNotification}. */
export type NotificationListener = (event: NotificationEvent) => void;
/** Callback for {@link EventStream.subscribeCall}. */
export type CallListener = (signal: CallSignal) => void;
/** Function returned by subscribe methods — call it to unsubscribe. */
export type Unsubscribe = () => void;

let eventSource: EventSource | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let destroyed = false;
let reconnectAttempts = 0;

const dmListeners = new Set<DmListener>();
const notificationListeners = new Set<NotificationListener>();
const callListeners = new Set<CallListener>();

function connect(): void {
  if (destroyed || eventSource) return;
  const token = ForumlineAPI.getToken();
  if (!token) return;

  const url = `/api/events/stream?access_token=${encodeURIComponent(token)}`;
  eventSource = new EventSource(url);

  eventSource.onopen = () => {
    reconnectAttempts = 0;
  };

  eventSource.addEventListener('dm', (e: MessageEvent) => {
    let parsed: DmEvent | null = null;
    try {
      parsed = JSON.parse(e.data);
    } catch (e) {
      console.error('[SSE] malformed event data:', e);
    }
    for (const fn of dmListeners) fn(parsed || { conversation_id: '', sender_id: '' });
  });

  eventSource.addEventListener('notification', (e: MessageEvent) => {
    try {
      const data: NotificationEvent = JSON.parse(e.data);
      for (const fn of notificationListeners) fn(data);
    } catch (e) {
      console.error('[SSE] malformed event data:', e);
    }
  });

  eventSource.addEventListener('call', (e: MessageEvent) => {
    try {
      const data: CallSignal = JSON.parse(e.data);
      for (const fn of callListeners) fn(data);
    } catch (e) {
      console.error('[SSE] malformed event data:', e);
    }
  });

  eventSource.onerror = () => {
    eventSource?.close();
    eventSource = null;
    if (!destroyed && hasListeners() && ForumlineAPI.getToken()) {
      const base = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
      const jitter = Math.random() * base * 0.3;
      reconnectAttempts++;
      reconnectTimer = setTimeout(connect, base + jitter);
    }
  };
}

function hasListeners(): boolean {
  return dmListeners.size > 0 || notificationListeners.size > 0 || callListeners.size > 0;
}

function ensureConnected(): void {
  destroyed = false;
  if (!eventSource) connect();
}

/**
 * Close the SSE connection and stop all reconnect attempts.
 * Existing subscriptions remain registered — call {@link reconnect} to resume.
 */
function disconnect(): void {
  destroyed = true;
  eventSource?.close();
  eventSource = null;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  reconnectAttempts = 0;
}

/**
 * Force-reconnect the SSE stream. Useful after a token refresh
 * to re-establish the connection with the new access token.
 */
function reconnect(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  eventSource?.close();
  eventSource = null;
  reconnectAttempts = 0;
  destroyed = false;
  if (hasListeners()) connect();
}

/**
 * Subscribe to DM events (new messages, typing indicators).
 * Opens the SSE connection if not already connected.
 * @returns Unsubscribe function — disconnects SSE when no listeners remain.
 */
function subscribeDm(fn: DmListener): Unsubscribe {
  dmListeners.add(fn);
  ensureConnected();
  return () => {
    dmListeners.delete(fn);
    if (!hasListeners()) disconnect();
  };
}

/**
 * Subscribe to notification events (replies, mentions, etc.).
 * Opens the SSE connection if not already connected.
 * @returns Unsubscribe function — disconnects SSE when no listeners remain.
 */
function subscribeNotification(fn: NotificationListener): Unsubscribe {
  notificationListeners.add(fn);
  ensureConnected();
  return () => {
    notificationListeners.delete(fn);
    if (!hasListeners()) disconnect();
  };
}

/**
 * Subscribe to call signaling events (incoming, accepted, declined, ended).
 * Opens the SSE connection if not already connected.
 * @returns Unsubscribe function — disconnects SSE when no listeners remain.
 */
function subscribeCall(fn: CallListener): Unsubscribe {
  callListeners.add(fn);
  ensureConnected();
  return () => {
    callListeners.delete(fn);
    if (!hasListeners()) disconnect();
  };
}

/**
 * Unified SSE event stream. Multiplexes DM, notification, and call events
 * over a single server connection with automatic reconnect.
 */
export const EventStream = {
  subscribeDm,
  subscribeNotification,
  subscribeCall,
  disconnect,
  reconnect,
};
