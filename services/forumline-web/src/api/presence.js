// ========== PRESENCE TRACKER (DM online/offline status) ==========
// Ref-counted presence system: sends heartbeats and polls online status
// for tracked users (1:1 DM conversation partners).

import { ForumlineAPI } from './client.js';

const HEARTBEAT_MS = 30000;
const POLL_MS = 30000;

let onlineUsers = {};        // userId -> boolean
let trackedUserIds = [];     // which user IDs to poll
let heartbeatTimer = null;
let pollTimer = null;
let refCount = 0;
const updateListeners = new Set();

function _notify() {
  for (const fn of updateListeners) {
    try { fn(onlineUsers); } catch (e) { console.error('[PresenceTracker]', e); }
  }
}

function _sendHeartbeat() {
  ForumlineAPI.presenceHeartbeat().catch(() => {});
}

async function _pollPresence() {
  if (!trackedUserIds.length) return;
  try {
    const result = await ForumlineAPI.getPresenceStatus(trackedUserIds);
    if (!result) return;
    let changed = false;
    // result is expected as { userId: boolean } or { userId: { online: boolean } }
    const newOnline = {};
    for (const uid of trackedUserIds) {
      const val = result[uid];
      const isOn = typeof val === 'boolean' ? val : (val && val.online) || false;
      newOnline[uid] = isOn;
      if (onlineUsers[uid] !== isOn) changed = true;
    }
    onlineUsers = newOnline;
    if (changed) _notify();
  } catch {
    // silently ignore polling errors
  }
}

function start() {
  refCount++;
  if (refCount === 1) {
    _sendHeartbeat();
    _pollPresence();
    heartbeatTimer = setInterval(_sendHeartbeat, HEARTBEAT_MS);
    pollTimer = setInterval(_pollPresence, POLL_MS);
  }
  return () => stop();
}

function stop() {
  refCount--;
  if (refCount <= 0) {
    refCount = 0;
    if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    onlineUsers = {};
    trackedUserIds = [];
  }
}

function setTrackedUsers(userIds) {
  trackedUserIds = userIds || [];
  // Immediately poll when tracked users change
  if (refCount > 0 && trackedUserIds.length) _pollPresence();
}

function isOnline(userId) {
  return !!onlineUsers[userId];
}

function onUpdate(callback) {
  updateListeners.add(callback);
  return () => updateListeners.delete(callback);
}

function pause() {
  if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

function resume() {
  if (refCount > 0) {
    if (!heartbeatTimer) {
      _sendHeartbeat();
      heartbeatTimer = setInterval(_sendHeartbeat, HEARTBEAT_MS);
    }
    if (!pollTimer) {
      _pollPresence();
      pollTimer = setInterval(_pollPresence, POLL_MS);
    }
  }
}

export const PresenceTracker = { start, stop, setTrackedUsers, isOnline, onUpdate, pause, resume };
