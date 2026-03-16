import { $ } from '../lib/utils.js';
import { avatarUrl } from '../lib/avatar.js';
import { escapeHtml, renderMarkdown } from '../lib/markdown.js';
import store from '../state/store.js';
import * as data from '../state/data.js';
import { ForumlineAPI } from '../api/client.js';
import { EventStream } from '../api/event-stream.js';
import { DmStore } from '../api/dm-store.js';
import { PresenceTracker } from '../api/presence.js';
import { CallManager } from '../api/calls.js';

let _showView, _renderForumList, _renderDmList, _showToast;

// Conversation metadata cache (populated by showDm)
let _currentConvoMeta = null;
let _dmSseUnsub = null;
let _dmSseDebounce = null;
let _dmMessagePaginationCursor = null;
let _dmAllMessagesLoaded = false;
let _dmLoadingOlder = false;
let _dmSending = false;

function isAtBottom(el) {
  return el.scrollTop + el.clientHeight >= el.scrollHeight - 50;
}

function smoothScrollToBottom(el) {
  requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
}

function _formatMsgTime(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  const now = new Date();
  const diffMs = now - d;
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffDays === 0) {
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  } else if (diffDays === 1) {
    return 'Yesterday ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  } else if (diffDays < 7) {
    return d.toLocaleDateString([], { weekday: 'short' }) + ' ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function showDm(dmId) {
  store.currentView = 'dm';
  store.currentDm = dmId;
  store.currentForum = null;
  store.currentThread = null;

  // Clean up previous SSE subscription for message view
  if (_dmSseUnsub) { _dmSseUnsub(); _dmSseUnsub = null; }
  if (_dmSseDebounce) { clearTimeout(_dmSseDebounce); _dmSseDebounce = null; }

  if (ForumlineAPI.isAuthenticated()) {
    // Fetch conversation metadata from API
    _currentConvoMeta = null;
    const myId = ForumlineAPI.getUserId();

    // Try to get metadata from DmStore cache first
    const cached = DmStore.getConversations().find(c => c.id === dmId);
    if (cached) {
      _currentConvoMeta = cached;
      const others = (cached.members || []).filter(m => m.id !== myId);
      const displayName = cached.isGroup && cached.name
        ? cached.name
        : others.map(m => m.displayName || m.username).join(', ') || 'Chat';
      const seed = cached.isGroup ? (cached.name || cached.id) : (others[0]?.username || cached.id);
      const convoAvatar = !cached.isGroup && others[0]?.avatarUrl
        ? others[0].avatarUrl
        : avatarUrl(seed, cached.isGroup ? 'shapes' : 'avataaars');

      $('dmName').textContent = displayName;
      $('dmAvatar').src = convoAvatar;
      // Use PresenceTracker to set online indicator for 1:1 conversations
      const otherForPresence = !cached.isGroup && others.length === 1 ? others[0].id : null;
      $('dmOnline').style.display = otherForPresence && PresenceTracker.isOnline(otherForPresence) ? 'block' : 'none';
      // Show call button for 1:1 conversations only
      const callBtn = $('dmCallBtn');
      if (callBtn) callBtn.classList.toggle('hidden', !otherForPresence);
    } else {
      $('dmName').textContent = 'Loading...';
      $('dmAvatar').src = '';
      $('dmOnline').style.display = 'none';
      const callBtnLoading = $('dmCallBtn');
      if (callBtnLoading) callBtnLoading.classList.add('hidden');
    }

    // Also fetch fresh metadata from API
    ForumlineAPI.getConversation(dmId).then(convo => {
      if (store.currentDm !== dmId) return;
      _currentConvoMeta = convo;
      const others = (convo.members || []).filter(m => m.id !== myId);
      const displayName = convo.isGroup && convo.name
        ? convo.name
        : others.map(m => m.displayName || m.username).join(', ') || 'Chat';
      const seed = convo.isGroup ? (convo.name || convo.id) : (others[0]?.username || convo.id);
      const convoAvatar = !convo.isGroup && others[0]?.avatarUrl
        ? others[0].avatarUrl
        : avatarUrl(seed, convo.isGroup ? 'shapes' : 'avataaars');

      $('dmName').textContent = displayName;
      $('dmAvatar').src = convoAvatar;
      // Update presence indicator from PresenceTracker
      const otherPresence = !convo.isGroup && others.length === 1 ? others[0].id : null;
      const onlineEl = $('dmOnline');
      if (onlineEl) onlineEl.style.display = otherPresence && PresenceTracker.isOnline(otherPresence) ? 'block' : 'none';
      // Show call button for 1:1 conversations
      const callBtnFresh = $('dmCallBtn');
      if (callBtnFresh) callBtnFresh.classList.toggle('hidden', !otherPresence);
    }).catch(err => console.error('[DM] Failed to fetch conversation:', err));

    // Subscribe to SSE for this conversation
    _dmSseUnsub = EventStream.subscribeDm((event) => {
      if (event.conversation_id && event.conversation_id !== dmId) return;
      if (_dmSseDebounce) clearTimeout(_dmSseDebounce);
      _dmSseDebounce = setTimeout(() => {
        const el = $('messagesList');
        if (el && store.currentDm === dmId) {
          const wasAtBottom = isAtBottom(el);
          _fetchAndRenderMessages(dmId, el, false).then(() => {
            if (wasAtBottom) smoothScrollToBottom(el);
          });
        }
      }, 200);
    });

    _showView('dmView');
    renderMessages(dmId);
    _renderForumList();
    _renderDmList();
    return;
  }

  // Fallback to mock data
  const dm = data.dms.find(d => d.id === dmId);
  if (!dm) return;
  $('dmName').textContent = dm.name;
  $('dmAvatar').src = avatarUrl(dm.seed);
  $('dmOnline').style.display = dm.online ? 'block' : 'none';
  _showView('dmView');
  renderMessages(dmId);
  _renderForumList();
  _renderDmList();
}

/**
 * Composed renderMessages -- merges all layers:
 * 1. Real API message fetching when authenticated
 * 2. Fallback to mock data
 * 3. Read receipts on sent messages
 * 4. Typing indicators
 * 5. Empty state
 */
export function renderMessages(dmId) {
  const el = $('messagesList');

  // If authenticated, fetch from API
  if (ForumlineAPI.isAuthenticated()) {
    el.innerHTML = '<div class="dm-empty-state"><div class="empty-icon">&#x23F3;</div><p>Loading messages...</p></div>';
    _dmMessagePaginationCursor = null;
    _dmAllMessagesLoaded = false;
    _dmLoadingOlder = false;
    _fetchAndRenderMessages(dmId, el, true);
    return;
  }

  // Fallback to mock data
  const dmMessages = data.messages[dmId] || [];
  const dm = data.dms.find(d => d.id === dmId);

  // Check for empty state first
  if (dmMessages.length === 0) {
    el.innerHTML = '<div class="dm-empty-state"><div class="empty-icon">&#x1F4AC;</div><p>No messages yet. Say hello!</p></div>';
    return;
  }

  // Render base messages
  el.innerHTML = dmMessages.map(m => `
    <div class="message-item ${m.from === 'me' ? 'sent' : ''}">
      ${m.from !== 'me' ? `<img class="avatar-sm" src="${avatarUrl(dm?.seed)}" alt="">` : ''}
      <div class="message-bubble">${renderMarkdown(m.content)}</div>
      <span class="message-time">${m.time}</span>
    </div>
  `).join('');

  // Add read receipts to sent messages
  const messageItems = el.querySelectorAll('.message-item.sent');
  messageItems.forEach((item, idx) => {
    const timEl = item.querySelector('.message-time');
    if (timEl) {
      const isLast = idx === messageItems.length - 1;
      const receiptSvg = `<svg viewBox="0 0 16 16" width="14" height="14"><path d="M1.5 8.5l3 3 7-7" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg><svg viewBox="0 0 16 16" width="14" height="14" style="margin-left:-8px"><path d="M1.5 8.5l3 3 7-7" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
      const receiptEl = document.createElement('span');
      receiptEl.className = `receipt-checks ${isLast ? 'delivered' : 'read'}`;
      receiptEl.innerHTML = receiptSvg;

      const wrapper = document.createElement('div');
      wrapper.className = 'message-meta';
      wrapper.appendChild(timEl.cloneNode(true));
      wrapper.appendChild(receiptEl);
      timEl.replaceWith(wrapper);
    }
  });

  // Add typing indicator for active DMs
  if (dm && dm.online) {
    el.innerHTML += `
      <div class="typing-indicator">
        <div class="typing-dots"><span></span><span></span><span></span></div>
        <span>${dm.name} is typing...</span>
      </div>
    `;
    const thisIndicator = el.querySelector('.typing-indicator');
    setTimeout(() => {
      if (thisIndicator && thisIndicator.parentNode) thisIndicator.remove();
    }, 4000);
  }

  el.scrollTop = el.scrollHeight;
}

async function _fetchAndRenderMessages(dmId, el, isInitial) {
  if (store.currentDm !== dmId) return; // user navigated away
  try {
    const msgs = await ForumlineAPI.getMessages(dmId);
    if (store.currentDm !== dmId) return;

    const myId = ForumlineAPI.getUserId();

    if (!msgs || msgs.length === 0) {
      el.innerHTML = '<div class="dm-empty-state"><div class="empty-icon">&#x1F4AC;</div><p>No messages yet. Say hello!</p></div>';
      return;
    }

    // Store cursor for pagination
    _dmMessagePaginationCursor = msgs[0]?.id || null;

    el.innerHTML = msgs.map(m => {
      const isMe = m.sender_id === myId;
      const senderMember = _currentConvoMeta?.members?.find(mem => mem.id === m.sender_id);
      const senderSeed = senderMember?.username || m.sender_id;
      const timeStr = _formatMsgTime(m.created_at);
      const senderLabel = _currentConvoMeta?.isGroup && !isMe
        ? `<div class="message-sender-label">${escapeHtml(senderMember?.displayName || senderMember?.username || 'User')}</div>`
        : '';

      return `
        <div class="message-item ${isMe ? 'sent' : ''}">
          ${!isMe ? `<img class="avatar-sm" src="${senderMember?.avatarUrl || avatarUrl(senderSeed)}" alt="" onerror="this.style.display='none'">` : ''}
          <div>
            ${senderLabel}
            <div class="message-bubble">${renderMarkdown(m.content)}</div>
          </div>
          <span class="message-time">${timeStr}</span>
        </div>
      `;
    }).join('');

    if (isInitial) {
      smoothScrollToBottom(el);
    }

    // Mark as read
    if (msgs.length > 0) {
      ForumlineAPI.markRead(dmId).then(() => DmStore.fetchConversations()).catch(() => {});
    }
  } catch (err) {
    if (store.currentDm !== dmId) return;
    console.error('[DM] Failed to fetch messages:', err);
    el.innerHTML = '<div class="dm-empty-state"><div class="empty-icon">&#x26A0;</div><p>Failed to load messages</p></div>';
  }
}

async function _loadOlderMessages(dmId) {
  if (_dmAllMessagesLoaded || !_dmMessagePaginationCursor || _dmLoadingOlder) return;
  _dmLoadingOlder = true;
  const el = $('messagesList');
  try {
    const older = await ForumlineAPI.getMessages(dmId, { before: _dmMessagePaginationCursor, limit: 50 });
    if (!older || older.length === 0) {
      _dmAllMessagesLoaded = true;
      return;
    }
    _dmMessagePaginationCursor = older[0]?.id || null;
    const myId = ForumlineAPI.getUserId();
    const olderHtml = older.map(m => {
      const isMe = m.sender_id === myId;
      const senderMember = _currentConvoMeta?.members?.find(mem => mem.id === m.sender_id);
      const senderSeed = senderMember?.username || m.sender_id;
      const timeStr = _formatMsgTime(m.created_at);
      return `
        <div class="message-item ${isMe ? 'sent' : ''}">
          ${!isMe ? `<img class="avatar-sm" src="${senderMember?.avatarUrl || avatarUrl(senderSeed)}" alt="" onerror="this.style.display='none'">` : ''}
          <div class="message-bubble">${renderMarkdown(m.content)}</div>
          <span class="message-time">${timeStr}</span>
        </div>
      `;
    }).join('');
    const prevHeight = el.scrollHeight;
    el.insertAdjacentHTML('afterbegin', olderHtml);
    el.scrollTop = el.scrollHeight - prevHeight;
  } catch (err) {
    console.error('[DM] Failed to load older messages:', err);
  } finally {
    _dmLoadingOlder = false;
  }
}

export function initConversation(deps) {
  _showView = deps.showView;
  _renderForumList = deps.renderForumList;
  _renderDmList = deps.renderDmList;
  _showToast = deps.showToast;

  // Call button handler
  $('dmCallBtn')?.addEventListener('click', () => {
    if (!store.currentDm || !_currentConvoMeta || !ForumlineAPI.isAuthenticated()) return;
    const myId = ForumlineAPI.getUserId();
    const others = (_currentConvoMeta.members || []).filter(m => m.id !== myId);
    if (others.length !== 1) return; // only 1:1 calls
    const remote = others[0];
    const remoteAvatar = remote.avatarUrl || avatarUrl(remote.username || remote.id);
    CallManager.initiateCall(store.currentDm, remote.id, remote.displayName || remote.username, remoteAvatar);
  });

  // DM send button handler (with real API optimistic sends + mock fallback)
  const dmSendBtn = $('dmSendBtn');
  dmSendBtn?.addEventListener('click', async () => {
    const input = $('dmInput');
    if (!input.value.trim() || !store.currentDm || _dmSending) return;

    const content = input.value.trim();

    // If authenticated, send via API with optimistic UI
    if (ForumlineAPI.isAuthenticated()) {
      _dmSending = true;
      const messagesList = $('messagesList');

      // Remove empty state if present
      const emptyState = messagesList.querySelector('.dm-empty-state');
      if (emptyState) emptyState.remove();

      // Optimistic message
      const optimisticId = 'temp-' + Date.now();
      const newMsg = document.createElement('div');
      newMsg.className = 'message-item sent';
      newMsg.id = optimisticId;
      newMsg.innerHTML = `
        <div class="message-bubble">${renderMarkdown(content)}</div>
        <div class="message-meta">
          <span class="message-time">now</span>
          <span class="receipt-checks delivered">
            <svg viewBox="0 0 16 16" width="14" height="14"><path d="M1.5 8.5l3 3 7-7" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
            <svg viewBox="0 0 16 16" width="14" height="14" style="margin-left:-8px"><path d="M1.5 8.5l3 3 7-7" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </span>
        </div>
      `;
      messagesList.appendChild(newMsg);
      input.value = '';
      smoothScrollToBottom(messagesList);

      try {
        await ForumlineAPI.sendMessage(store.currentDm, content);
        // Mark as read/delivered
        const checks = newMsg.querySelector('.receipt-checks');
        if (checks) {
          checks.classList.remove('delivered');
          checks.classList.add('read');
        }
      } catch (err) {
        console.error('[DM] Failed to send message:', err);
        // Remove optimistic message on failure
        newMsg.remove();
        input.value = content; // restore the text
        if (_showToast) _showToast('Failed to send message');
      } finally {
        _dmSending = false;
      }
      return;
    }

    // Fallback to mock data
    if (!data.messages[store.currentDm]) data.messages[store.currentDm] = [];
    data.messages[store.currentDm].push({ from: 'me', content: content, time: 'now' });

    const messagesList = $('messagesList');

    // Remove empty state if present
    const emptyState = messagesList.querySelector('.dm-empty-state');
    if (emptyState) emptyState.remove();

    const newMsg = document.createElement('div');
    newMsg.className = 'message-item sent';
    newMsg.innerHTML = `
      <div class="message-bubble">${renderMarkdown(content)}</div>
      <div class="message-meta">
        <span class="message-time">now</span>
        <span class="receipt-checks delivered">
          <svg viewBox="0 0 16 16" width="14" height="14"><path d="M1.5 8.5l3 3 7-7" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
          <svg viewBox="0 0 16 16" width="14" height="14" style="margin-left:-8px"><path d="M1.5 8.5l3 3 7-7" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </span>
      </div>
    `;
    messagesList.appendChild(newMsg);

    // Simulate "read" after 2 seconds
    setTimeout(() => {
      const checks = newMsg.querySelector('.receipt-checks');
      if (checks) {
        checks.classList.remove('delivered');
        checks.classList.add('read');
      }
    }, 2000);

    input.value = '';
    smoothScrollToBottom(messagesList);
  });

  // Enter key to send DM
  $('dmInput')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      dmSendBtn?.click();
    }
  });

  // Scroll-to-top pagination for message history
  $('messagesList')?.addEventListener('scroll', () => {
    const el = $('messagesList');
    if (el.scrollTop < 50 && store.currentDm && ForumlineAPI.isAuthenticated()) {
      _loadOlderMessages(store.currentDm);
    }
  });
}
