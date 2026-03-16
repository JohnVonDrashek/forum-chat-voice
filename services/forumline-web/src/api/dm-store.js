// ========== DM STORE (Reactive conversation list) ==========
// Conversation store with real-time SSE updates and polling fallback.

import { ForumlineAPI } from './client.js';
import { EventStream } from './event-stream.js';

let conversations = [];
let initialLoad = true;
let loadError = false;
let unreadCount = 0;
let sseUnsub = null;
let sseDebounce = null;
let pollInterval = null;
let refCount = 0;
const changeListeners = new Set();

function getConversations() { return conversations; }
function getUnreadCount() { return unreadCount; }
function isInitialLoad() { return initialLoad; }
function hasError() { return loadError; }

function _notify() { for (const fn of changeListeners) fn(); }

function onChanged(fn) {
  changeListeners.add(fn);
  return () => changeListeners.delete(fn);
}

async function fetchConversations() {
  if (!ForumlineAPI.isAuthenticated()) return;
  try {
    const data = await ForumlineAPI.getConversations();
    conversations = data || [];
    unreadCount = conversations.reduce((sum, c) => sum + (c.unreadCount || 0), 0);
    initialLoad = false;
    loadError = false;
    _notify();
  } catch {
    if (initialLoad) { loadError = true; initialLoad = false; _notify(); }
  }
}

function startUpdates() {
  refCount++;
  if (refCount === 1) {
    fetchConversations();
    sseUnsub = EventStream.subscribeDm(() => {
      if (sseDebounce) clearTimeout(sseDebounce);
      sseDebounce = setTimeout(fetchConversations, 200);
    });
    pollInterval = setInterval(fetchConversations, 30000);
  }
  return () => {
    refCount--;
    if (refCount === 0) {
      sseUnsub?.();
      sseUnsub = null;
      if (sseDebounce) { clearTimeout(sseDebounce); sseDebounce = null; }
      if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
    }
  };
}

export const DmStore = {
  getConversations, getUnreadCount, isInitialLoad, hasError,
  fetchConversations, startUpdates, onChanged,
};
