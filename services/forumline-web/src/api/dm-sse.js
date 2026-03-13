// ========== DM SSE (Real-time event stream) ==========
// SSE connection singleton for DM real-time updates.
// Exponential backoff reconnect, ref-counted via subscribe/unsubscribe.

import { ForumlineAPI } from './client.js';

let eventSource = null;
let reconnectTimer = null;
let destroyed = false;
let reconnectAttempts = 0;
const listeners = new Set();

function connect() {
  if (destroyed || eventSource) return;
  const token = ForumlineAPI.getToken();
  if (!token) return;
  const url = `/api/conversations/stream?access_token=${encodeURIComponent(token)}`;
  eventSource = new EventSource(url);
  eventSource.onopen = () => { reconnectAttempts = 0; };
  eventSource.onmessage = (event) => {
    let parsed = null;
    try { parsed = JSON.parse(event.data); } catch {}
    for (const fn of listeners) fn(parsed || { conversation_id: '', sender_id: '' });
  };
  eventSource.onerror = () => {
    eventSource?.close();
    eventSource = null;
    if (!destroyed && listeners.size > 0) {
      const base = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
      const jitter = Math.random() * base * 0.3;
      reconnectAttempts++;
      reconnectTimer = setTimeout(connect, base + jitter);
    }
  };
}

function disconnect() {
  destroyed = true;
  eventSource?.close();
  eventSource = null;
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  reconnectAttempts = 0;
}

function subscribe(fn) {
  listeners.add(fn);
  destroyed = false;
  if (!eventSource) connect();
  return () => {
    listeners.delete(fn);
    if (listeners.size === 0) disconnect();
  };
}

function reconnect() {
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  eventSource?.close();
  eventSource = null;
  reconnectAttempts = 0;
  destroyed = false;
  if (listeners.size > 0) connect();
}

export const DmSSE = { subscribe, disconnect, reconnect };
