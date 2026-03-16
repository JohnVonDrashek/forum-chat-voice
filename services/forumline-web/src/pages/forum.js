import { $, plural } from '../lib/utils.js';
import { avatarUrl } from '../lib/avatar.js';
import store from '../state/store.js';
import * as data from '../state/data.js';

let _showView, _renderForumList, _renderDmList, _showThread, _showToast, _showContextMenu;

export function showForum(forumId) {
  store.currentView = 'forum';
  store.currentForum = forumId;
  store.currentThread = null;
  store.currentDm = null;
  const forum = data.forums.find(f => f.id === forumId);
  if (!forum) return;
  $('forumName').textContent = forum.name;
  $('forumMeta').textContent = `${plural(forum.members, 'member')} · ${plural(forum.threads, 'thread')}`;
  $('forumAvatar').src = avatarUrl(forum.seed, 'shapes');
  $('membersBtnCount').textContent = forum.members;
  // Clear unread when visiting
  forum.unread = 0;

  // Show view with skeleton loading
  $('newRepliesToast')?.classList.add('hidden');
  const threadList = $('threadList');
  showSkeletons(threadList, 4);
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  $('forumView').classList.remove('hidden');
  setTimeout(() => {
    if (store.currentForum) renderFilteredThreads(store.currentForum);
  }, 300);

  _renderForumList();
  _renderDmList();
  // Close member panel if open
  $('memberPanel').classList.add('hidden');

  // Render online bar
  renderOnlineBar(forumId);
}

function showSkeletons(container, count) {
  let html = '';
  for (let i = 0; i < count; i++) {
    html += `
      <div class="skeleton-thread">
        <div class="skeleton skeleton-circle"></div>
        <div class="skeleton-lines">
          <div class="skeleton skeleton-line skeleton-line-long"></div>
          <div class="skeleton skeleton-line skeleton-line-short"></div>
        </div>
      </div>
    `;
  }
  container.innerHTML = html;
}

export function renderFilteredThreads(forumId) {
  const el = $('threadList');
  let forumThreads = data.threads[forumId] || [];

  // Filter
  if (store.currentFilter !== 'all') {
    forumThreads = forumThreads.filter(t => t.label === store.currentFilter);
  }

  // Sort
  let sorted = [...forumThreads];
  switch (store.currentSort) {
    case 'newest':
      sorted.reverse();
      break;
    case 'most-active':
      sorted.sort((a, b) => b.replies - a.replies);
      break;
    case 'unanswered':
      sorted = sorted.filter(t => t.replies === 0);
      break;
    default:
      sorted.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
  }

  el.innerHTML = sorted.map(t => {
    let labelHtml = '';
    if (t.pinned) labelHtml += '<span class="thread-pinned-icon">&#x1F4CC;</span>';
    if (t.label === 'announcement') labelHtml += '<span class="thread-label thread-label-announcement">Announcement</span>';
    else if (t.label === 'question' && t.resolved) labelHtml += '<span class="thread-label thread-label-resolved">Resolved</span>';
    else if (t.label === 'question') labelHtml += '<span class="thread-label thread-label-question">Question</span>';
    else if (t.label === 'discussion') labelHtml += '<span class="thread-label thread-label-discussion">Discussion</span>';
    return `
      <div class="thread-item ${t.pinned ? 'thread-pinned' : ''}" data-thread="${t.id}" data-forum="${forumId}" tabindex="0" role="listitem" aria-label="${t.title}, ${plural(t.replies, 'reply')}, ${t.time}">
        <img class="thread-avatar" src="${avatarUrl(t.seed)}" alt="" onerror="this.style.display='none'">
        <div class="thread-info">
          <div class="thread-title">${labelHtml}${t.title}</div>
          <div class="thread-snippet">${t.snippet}</div>
        </div>
        <div class="thread-meta">
          <div class="thread-time">${t.time}</div>
          <div class="thread-replies">${plural(t.replies, 'reply')}</div>
        </div>
      </div>
    `;
  }).join('');

  if (sorted.length === 0) {
    el.innerHTML = '<div class="empty-state"><div class="empty-icon">&#x1F50D;</div><p>No threads match this filter</p></div>';
  }

  el.querySelectorAll('.thread-item').forEach(item => {
    item.addEventListener('click', (e) => {
      if (e.button === 0) _showThread(item.dataset.thread);
    });
    item.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        _showThread(item.dataset.thread);
      }
    });
    item.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      _showContextMenu(e.clientX, e.clientY, item.dataset.thread, item.dataset.forum);
    });
  });
}

export function renderOnlineBar(forumId) {
  const members = data.forumMembers[forumId] || [];
  const online = members.filter(m => m.online);
  const bar = $('forumOnlineBar');
  if (!bar) return;

  const avatarsHtml = online.slice(0, 5).map(m =>
    `<img src="${avatarUrl(m.seed)}" alt="${m.name}" title="${m.name}">`
  ).join('');

  $('onlineAvatars').innerHTML = avatarsHtml;
  const extra = online.length > 5 ? ` +${online.length - 5} more` : '';
  $('onlineText').innerHTML = `<strong>${online.length}</strong> member${online.length !== 1 ? 's' : ''} online${extra}`;
}

export function initForum(deps) {
  _showView = deps.showView;
  _renderForumList = deps.renderForumList;
  _renderDmList = deps.renderDmList;
  _showThread = deps.showThread;
  _showToast = deps.showToast;
  _showContextMenu = deps.showContextMenu;

  // Thread sort select change handler
  $('threadSortSelect').addEventListener('change', (e) => {
    store.currentSort = e.target.value;
    if (store.currentForum) renderFilteredThreads(store.currentForum);
  });

  // Filter pill click handlers
  document.querySelectorAll('.filter-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('.filter-pill').forEach(p => {
        p.classList.remove('active');
        p.setAttribute('aria-selected', 'false');
      });
      pill.classList.add('active');
      pill.setAttribute('aria-selected', 'true');
      store.currentFilter = pill.dataset.filter;
      if (store.currentForum) renderFilteredThreads(store.currentForum);
    });
  });

  // Thread density toggle handlers
  document.querySelectorAll('.density-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.density-btn').forEach(b => {
        b.classList.remove('active');
        b.setAttribute('aria-pressed', 'false');
      });
      btn.classList.add('active');
      btn.setAttribute('aria-pressed', 'true');
      store.threadDensity = btn.dataset.density;
      const threadList = $('threadList');
      threadList.classList.remove('density-compact', 'density-comfortable');
      if (store.threadDensity === 'compact') {
        threadList.classList.add('density-compact');
      }
    });
  });
}
