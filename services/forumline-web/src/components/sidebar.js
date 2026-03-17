import { DmStore, ForumlineAPI, ForumStore, PresenceTracker } from '@forumline/client-sdk';
import { avatarUrl } from '../lib/avatar.js';
import { escapeHtml } from '../lib/markdown.js';
import { $, plural } from '../lib/utils.js';
import { pushState } from '../router.js';
import store from '../state/store.js';
import { showToast } from './toast.js';

// ========== BOOKMARKS ==========
let bookmarks = [];

try {
  bookmarks = JSON.parse(localStorage.getItem('forumline-bookmarks') || '[]');
} catch (e) {
  bookmarks = [];
}

export function saveBookmarks() {
  localStorage.setItem('forumline-bookmarks', JSON.stringify(bookmarks));
}

export function addBookmark(threadId, title) {
  if (bookmarks.find(b => b.threadId === threadId)) return;
  bookmarks.push({ threadId, title, time: 'just now' });
  saveBookmarks();
  renderBookmarks();
}

export function removeBookmark(threadId) {
  bookmarks = bookmarks.filter(b => b.threadId !== threadId);
  saveBookmarks();
  renderBookmarks();
}

export function getBookmarks() {
  return bookmarks;
}

export function renderBookmarks() {
  const el = $('bookmarkList');
  const empty = $('bookmarkEmpty');
  if (!el || !empty) return;

  if (bookmarks.length === 0) {
    empty.classList.remove('hidden');
    el.querySelectorAll('.bookmark-item').forEach(i => i.remove());
    return;
  }

  empty.classList.add('hidden');
  el.querySelectorAll('.bookmark-item').forEach(i => i.remove());

  bookmarks.forEach(b => {
    const item = document.createElement('div');
    item.className = 'bookmark-item';
    item.innerHTML = `
      <span class="bookmark-icon">&#x2605;</span>
      <span class="bookmark-title">${b.title}</span>
      <button class="bookmark-remove" data-id="${b.threadId}">&times;</button>
    `;
    item.querySelector('.bookmark-title').addEventListener('click', () => {
      _deps.showThread(b.threadId);
    });
    item.querySelector('.bookmark-remove').addEventListener('click', e => {
      e.stopPropagation();
      removeBookmark(b.threadId);
    });
    el.appendChild(item);
  });
}

// ========== FORUM LIST ==========
export function renderForumList() {
  const el = $('forumList');
  if (!el) return;

  const forums = ForumStore.forums;
  const currentForum = store.currentForum;

  el.innerHTML = forums
    .map(f => {
      const iconUrl = f.icon_url
        ? f.icon_url.startsWith('/')
          ? (f.web_base || '') + f.icon_url
          : f.icon_url
        : avatarUrl(f.seed || f.domain || 'unknown', 'shapes');
      const forumId = f.id || f.domain;
      return `
    <div class="forum-item ${currentForum === forumId ? 'active' : ''}" data-forum="${forumId}" ${f.isReal ? `data-domain="${f.domain}"` : ''} tabindex="0" role="listitem" aria-label="${f.name}${f.unread > 0 ? ', ' + f.unread + ' unread' : ''}">
      <img src="${iconUrl}" alt="" onerror="this.style.display='none'">
      <div class="forum-item-info">
        <div class="forum-item-name">${f.name}</div>
        <div class="forum-item-count">${plural(f.members, 'member')}</div>
      </div>
      ${f.unread > 0 ? `<div class="unread-badge" aria-hidden="true">${f.unread}</div>` : ''}
    </div>
  `;
    })
    .join('');

  el.querySelectorAll('.forum-item').forEach(item => {
    item.addEventListener('click', () => {
      const domain = item.dataset.domain;
      if (domain) {
        ForumStore.switchForum(domain);
        pushState({ view: 'forum', forumId: domain, isReal: true });
      } else {
        _deps.showForum(item.dataset.forum);
      }
    });
    item.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const domain = item.dataset.domain;
        if (domain) {
          ForumStore.switchForum(domain);
          pushState({ view: 'forum', forumId: domain, isReal: true });
        } else {
          _deps.showForum(item.dataset.forum);
        }
      }
    });
  });

  initDragAndDrop();
}

// ========== DRAG AND DROP ==========
export function initDragAndDrop() {
  const forumItems = document.querySelectorAll('#forumList .forum-item');
  let draggedEl = null;

  forumItems.forEach(item => {
    item.setAttribute('draggable', 'true');

    item.addEventListener('dragstart', e => {
      draggedEl = item;
      item.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });

    item.addEventListener('dragend', () => {
      item.classList.remove('dragging');
      document.querySelectorAll('.forum-item').forEach(i => i.classList.remove('drag-over'));
      draggedEl = null;
    });

    item.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (draggedEl && draggedEl !== item) {
        item.classList.add('drag-over');
      }
    });

    item.addEventListener('dragleave', () => {
      item.classList.remove('drag-over');
    });

    item.addEventListener('drop', e => {
      e.preventDefault();
      item.classList.remove('drag-over');
      if (draggedEl && draggedEl !== item) {
        const forums = ForumStore.forums;
        const fromId = draggedEl.dataset.forum;
        const toId = item.dataset.forum;
        const fromIdx = forums.findIndex(f => (f.id || f.domain) === fromId);
        const toIdx = forums.findIndex(f => (f.id || f.domain) === toId);
        if (fromIdx >= 0 && toIdx >= 0) {
          const [moved] = forums.splice(fromIdx, 1);
          forums.splice(toIdx, 0, moved);
          renderForumList();
        }
      }
    });
  });
}

// ========== DM LIST ==========
export function renderDmList() {
  const el = $('dmList');
  if (!el) return;
  const currentDm = store.currentDm;

  // Use real API data when authenticated, fall back to mock data
  if (ForumlineAPI.isAuthenticated()) {
    const conversations = DmStore.getConversations();
    const myId = ForumlineAPI.getUserId();

    if (DmStore.isInitialLoad()) {
      el.innerHTML = '<div class="dm-item dm-loading">Loading conversations...</div>';
      return;
    }

    if (DmStore.hasError()) {
      el.innerHTML = '<div class="dm-item dm-loading">Failed to load conversations</div>';
      return;
    }

    if (conversations.length === 0) {
      el.innerHTML = '<div class="dm-item dm-loading">No conversations yet</div>';
      return;
    }

    // Track user IDs for presence
    const trackedIds = [];

    el.innerHTML = conversations
      .map(c => {
        const others = (c.members || []).filter(m => m.id !== myId);
        const displayName =
          c.isGroup && c.name
            ? c.name
            : others.map(m => m.displayName || m.username).join(', ') || 'Chat';
        const seed = c.isGroup ? c.name || c.id : others[0]?.username || c.id;
        const convoAvatar =
          !c.isGroup && others[0]?.avatarUrl
            ? others[0].avatarUrl
            : avatarUrl(seed, c.isGroup ? 'shapes' : 'avataaars');
        const preview = escapeHtml(
          typeof c.lastMessage === 'string' ? c.lastMessage : c.lastMessage?.content || '',
        );
        const hasUnread = (c.unreadCount || 0) > 0;

        // Track 1:1 conversation partner for presence
        if (!c.isGroup && others.length === 1) {
          trackedIds.push(others[0].id);
        }

        const isOnline =
          !c.isGroup && others.length === 1 && PresenceTracker.isOnline(others[0].id);

        const escapedName = escapeHtml(displayName);
        return `
        <div class="dm-item ${currentDm === c.id ? 'active' : ''}" data-dm="${c.id}" tabindex="0" role="listitem" aria-label="${escapedName}${hasUnread ? ', unread message' : ''}">
          <div class="dm-avatar-wrap">
            <img src="${convoAvatar}" alt="" onerror="this.style.display='none'">
            ${isOnline ? '<span class="dm-online-dot"></span>' : ''}
          </div>
          <div class="dm-item-info">
            <div class="dm-item-name">${escapedName}</div>
            <div class="dm-item-preview">${preview}</div>
          </div>
          ${hasUnread ? `<div class="unread-dot" aria-hidden="true"></div>` : ''}
        </div>
      `;
      })
      .join('');

    // Update presence tracked users
    if (trackedIds.length > 0) {
      PresenceTracker.setTrackedUsers(trackedIds);
    }

    el.querySelectorAll('.dm-item').forEach(item => {
      if (!item.dataset.dm) return;
      item.addEventListener('click', () => _deps.showDm(item.dataset.dm));
      item.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          _deps.showDm(item.dataset.dm);
        }
      });
    });
    return;
  }

  // Not authenticated — show empty state
  el.innerHTML = '<div class="dm-item dm-loading">Sign in to see messages</div>';
}

// ========== NEW DM MODAL ==========
let _newDmDebounce = null;

function openNewDmModal() {
  const modal = $('newDmModal');
  const input = $('newDmSearchInput');
  const results = $('newDmResults');
  if (!modal) return;

  modal.classList.remove('hidden');
  results.innerHTML =
    '<div class="search-modal-hint">Search by username to start a conversation...</div>';
  input.value = '';
  setTimeout(() => input.focus(), 50);
}

function closeNewDmModal() {
  const modal = $('newDmModal');
  if (modal) modal.classList.add('hidden');
}

function initNewDmModal() {
  const input = $('newDmSearchInput');
  const results = $('newDmResults');
  const backdrop = $('newDmModalBackdrop');
  const escBtn = $('newDmEscBtn');
  const btn = $('newDmBtn');

  if (!input || !results) return;

  btn?.addEventListener('click', () => {
    if (!ForumlineAPI.isAuthenticated()) return;
    openNewDmModal();
  });

  backdrop?.addEventListener('click', closeNewDmModal);
  escBtn?.addEventListener('click', closeNewDmModal);

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !$('newDmModal').classList.contains('hidden')) {
      closeNewDmModal();
    }
  });

  input.addEventListener('input', () => {
    const query = input.value.trim();
    if (query.length < 2) {
      results.innerHTML =
        '<div class="search-modal-hint">Search by username to start a conversation...</div>';
      return;
    }

    clearTimeout(_newDmDebounce);
    _newDmDebounce = setTimeout(async () => {
      results.innerHTML = '<div class="search-modal-hint">Searching...</div>';
      try {
        const profiles = await ForumlineAPI.searchProfiles(query);
        const myId = ForumlineAPI.getUserId();
        const filtered = (profiles || []).filter(p => p.id !== myId);

        if (filtered.length === 0) {
          results.innerHTML = '<div class="search-modal-hint">No users found</div>';
          return;
        }

        results.innerHTML = filtered
          .map(p => {
            const name = escapeHtml(p.display_name || p.username);
            const username = escapeHtml(p.username);
            const userAvatar = p.avatar_url || avatarUrl(p.username);
            return `
            <div class="search-modal-result" data-user-id="${p.id}" role="option" tabindex="0" style="display:flex;align-items:center;gap:10px;padding:10px 16px;cursor:pointer;">
              <img src="${userAvatar}" alt="" style="width:32px;height:32px;border-radius:50%;" onerror="this.style.display='none'">
              <div>
                <div style="font-weight:600;">${name}</div>
                ${name !== username ? `<div style="font-size:12px;color:#888;">@${username}</div>` : ''}
              </div>
            </div>
          `;
          })
          .join('');

        results.querySelectorAll('.search-modal-result').forEach(el => {
          const handler = async () => {
            const userId = el.dataset.userId;
            closeNewDmModal();
            try {
              const convo = await ForumlineAPI.getOrCreateDM(userId);
              await DmStore.fetchConversations();
              renderDmList();
              _deps.showDm(convo.id);
            } catch (err) {
              console.error('[NewDM] Failed to create conversation:', err);
            }
          };
          el.addEventListener('click', handler);
          el.addEventListener('keydown', e => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              handler();
            }
          });
        });
      } catch (err) {
        console.error('[NewDM] Search failed:', err);
        results.innerHTML = '<div class="search-modal-hint">Search failed</div>';
      }
    }, 300);
  });
}

// ========== ADD FORUM MODAL ==========
function openAddForumModal() {
  const modal = $('addForumModal');
  const input = $('addForumUrlInput');
  const error = $('addForumError');
  if (!modal) return;

  modal.classList.remove('hidden');
  if (error) error.classList.add('hidden');
  if (input) {
    input.value = '';
    setTimeout(() => input.focus(), 50);
  }
}

function closeAddForumModal() {
  const modal = $('addForumModal');
  if (modal) modal.classList.add('hidden');
}

function initAddForumModal() {
  const btn = $('addForumBtn');
  const modal = $('addForumModal');
  const input = $('addForumUrlInput');
  const error = $('addForumError');
  const submitBtn = $('addForumSubmit');
  const cancelBtn = $('addForumCancel');

  if (!btn || !modal) return;

  btn.addEventListener('click', openAddForumModal);

  cancelBtn?.addEventListener('click', closeAddForumModal);

  modal.addEventListener('click', e => {
    if (e.target === modal) closeAddForumModal();
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !modal.classList.contains('hidden')) {
      closeAddForumModal();
    }
  });

  const doSubmit = async () => {
    const url = input?.value.trim();
    if (!url) {
      if (error) {
        error.textContent = 'Please enter a forum URL';
        error.classList.remove('hidden');
      }
      return;
    }

    if (error) error.classList.add('hidden');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Adding...';
    }

    try {
      await ForumStore.addForum(url);
      renderForumList();
      closeAddForumModal();
      showToast('Forum added successfully!');
    } catch (err) {
      if (error) {
        error.textContent = err.message || 'Failed to add forum';
        error.classList.remove('hidden');
      }
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Add Forum';
      }
    }
  };

  submitBtn?.addEventListener('click', doSubmit);

  input?.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      doSubmit();
    }
  });
}

// ========== INIT ==========
let _deps = { showForum: () => {}, showDm: () => {}, showThread: () => {} };

export function initSidebar(deps) {
  _deps = deps;
  initNewDmModal();
  initAddForumModal();
}
