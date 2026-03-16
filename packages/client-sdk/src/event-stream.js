// ========== UNIFIED EVENT STREAM ==========
// Single SSE connection for all Forumline app events (DMs, notifications, calls).
// Uses SSE event types (addEventListener) for routing — no custom parsing needed.

import { ForumlineAPI } from './client.js';

let eventSource = null;
let reconnectTimer = null;
let destroyed = false;
let reconnectAttempts = 0;

const dmListeners = new Set();
const notificationListeners = new Set();
const callListeners = new Set();

function connect() {
  if (destroyed || eventSource) return;
  const token = ForumlineAPI.getToken();
  if (!token) return;

  const url = `/api/events/stream?access_token=${encodeURIComponent(token)}`;
  eventSource = new EventSource(url);

  eventSource.onopen = () => { reconnectAttempts = 0; };

  eventSource.addEventListener('dm', (e) => {
    let parsed = null;
    try { parsed = JSON.parse(e.data); } catch {}
    for (const fn of dmListeners) fn(parsed || { conversation_id: '', sender_id: '' });
  });

  eventSource.addEventListener('notification', (e) => {
    try {
      const data = JSON.parse(e.data);
      for (const fn of notificationListeners) fn(data);
    } catch {}
  });

  eventSource.addEventListener('call', (e) => {
    try {
      const data = JSON.parse(e.data);
      for (const fn of callListeners) fn(data);
    } catch {}
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

function hasListeners() {
  return dmListeners.size > 0 || notificationListeners.size > 0 || callListeners.size > 0;
}

function ensureConnected() {
  destroyed = false;
  if (!eventSource) connect();
}

function disconnect() {
  destroyed = true;
  eventSource?.close();
  eventSource = null;
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  reconnectAttempts = 0;
}

function reconnect() {
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  eventSource?.close();
  eventSource = null;
  reconnectAttempts = 0;
  destroyed = false;
  if (hasListeners()) connect();
}

function subscribeDm(fn) {
  dmListeners.add(fn);
  ensureConnected();
  return () => { dmListeners.delete(fn); if (!hasListeners()) disconnect(); };
}

function subscribeNotification(fn) {
  notificationListeners.add(fn);
  ensureConnected();
  return () => { notificationListeners.delete(fn); if (!hasListeners()) disconnect(); };
}

function subscribeCall(fn) {
  callListeners.add(fn);
  ensureConnected();
  return () => { callListeners.delete(fn); if (!hasListeners()) disconnect(); };
}

export const EventStream = {
  subscribeDm,
  subscribeNotification,
  subscribeCall,
  disconnect,
  reconnect,
};
