import { $, plural } from '../lib/utils.js';
import store from '../state/store.js';
import * as data from '../state/data.js';

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
    item.querySelector('.bookmark-remove').addEventListener('click', (e) => {
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
  const forums = data.forums;
  const currentForum = store.currentForum;

  el.innerHTML = forums.map(f => `
    <div class="forum-item ${currentForum === f.id ? 'active' : ''}" data-forum="${f.id}" tabindex="0" role="listitem" aria-label="${f.name}${f.unread > 0 ? ', ' + f.unread + ' unread' : ''}">
      <img src="https://api.dicebear.com/7.x/shapes/svg?seed=${f.seed}" alt="" onerror="this.style.display='none'">
      <div class="forum-item-info">
        <div class="forum-item-name">${f.name}</div>
        <div class="forum-item-count">${plural(f.members, 'member')}</div>
      </div>
      ${f.unread > 0 ? `<div class="unread-badge" aria-hidden="true">${f.unread}</div>` : ''}
    </div>
  `).join('');

  el.querySelectorAll('.forum-item').forEach(item => {
    item.setAttribute('draggable', 'true');
    item.addEventListener('click', () => _deps.showForum(item.dataset.forum));
    item.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        _deps.showForum(item.dataset.forum);
      }
    });
  });

  initDragAndDrop();
}

// ========== DM LIST ==========
export function renderDmList() {
  const el = $('dmList');
  if (!el) return;
  const dms = data.dms;
  const currentDm = store.currentDm;

  el.innerHTML = dms.map(d => `
    <div class="dm-item ${currentDm === d.id ? 'active' : ''}" data-dm="${d.id}" tabindex="0" role="listitem" aria-label="${d.name}${d.unread ? ', unread message' : ''}">
      <img src="https://api.dicebear.com/7.x/avataaars/svg?seed=${d.seed}" alt="" onerror="this.style.display='none'">
      <div class="dm-item-info">
        <div class="dm-item-name">${d.name}</div>
        <div class="dm-item-preview">${d.preview}</div>
      </div>
      ${d.unread ? '<div class="unread-dot" aria-hidden="true"></div>' : ''}
    </div>
  `).join('');

  el.querySelectorAll('.dm-item').forEach(item => {
    item.addEventListener('click', () => _deps.showDm(item.dataset.dm));
    item.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        _deps.showDm(item.dataset.dm);
      }
    });
  });
}

// ========== DRAG AND DROP ==========
export function initDragAndDrop() {
  const forumItems = document.querySelectorAll('#forumList .forum-item');
  let draggedEl = null;

  forumItems.forEach(item => {
    item.setAttribute('draggable', 'true');

    item.addEventListener('dragstart', (e) => {
      draggedEl = item;
      item.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });

    item.addEventListener('dragend', () => {
      item.classList.remove('dragging');
      document.querySelectorAll('.forum-item').forEach(i => i.classList.remove('drag-over'));
      draggedEl = null;
    });

    item.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (draggedEl && draggedEl !== item) {
        item.classList.add('drag-over');
      }
    });

    item.addEventListener('dragleave', () => {
      item.classList.remove('drag-over');
    });

    item.addEventListener('drop', (e) => {
      e.preventDefault();
      item.classList.remove('drag-over');
      if (draggedEl && draggedEl !== item) {
        const forums = data.forums;
        const fromId = draggedEl.dataset.forum;
        const toId = item.dataset.forum;
        const fromIdx = forums.findIndex(f => f.id === fromId);
        const toIdx = forums.findIndex(f => f.id === toId);
        if (fromIdx >= 0 && toIdx >= 0) {
          const [moved] = forums.splice(fromIdx, 1);
          forums.splice(toIdx, 0, moved);
          renderForumList();
        }
      }
    });
  });
}

// ========== INIT ==========
let _deps = { showForum: () => {}, showDm: () => {}, showThread: () => {} };

export function initSidebar(deps) {
  _deps = deps;
}
