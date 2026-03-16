import { $ } from '../lib/utils.js';
import { avatarUrl } from '../lib/avatar.js';
import store from '../state/store.js';
import { ForumlineAPI } from '../api/client.js';
import { ForumStore } from '../api/forum-store.js';

function timeAgo(timestamp) {
  const now = new Date();
  const then = new Date(timestamp);
  const seconds = Math.floor((now - then) / 1000);

  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days > 1 ? 's' : ''} ago`;
  const weeks = Math.floor(days / 7);
  return `${weeks} week${weeks > 1 ? 's' : ''} ago`;
}

function updateForumsJoinedStat() {
  const el = $('statForumsJoined');
  if (el) el.textContent = ForumStore.forums.length;
}

function renderNetworkStats() {
  updateForumsJoinedStat();
  ForumlineAPI.getConversations().then(convos => {
    const el = $('statConversations');
    if (el) el.textContent = (convos || []).length;
  }).catch(() => {});
}

// Update forums count when memberships sync
ForumStore.subscribe(() => updateForumsJoinedStat());

export function renderActivityFeed() {
  const el = $('activityFeed');
  if (!ForumlineAPI.isAuthenticated()) {
    el.innerHTML = '';
    return;
  }

  el.innerHTML = '<div class="activity-loading">Loading activity...</div>';

  renderNetworkStats();

  ForumlineAPI.getActivity().then(items => {
    if (!items || items.length === 0) {
      el.innerHTML = '<div class="activity-empty">No recent activity in your forums yet.</div>';
      return;
    }

    el.innerHTML = items.map(a => {
      const itemAvatar = a.avatar_url || avatarUrl(a.author);
      const actionText = a.action === 'posted'
        ? `posted "${a.thread_title}"`
        : `replied in "${a.thread_title}"`;

      return `
        <div class="activity-item" data-domain="${a.forum_domain || ''}" data-thread="${a.thread_id || ''}">
          <img src="${itemAvatar}" alt="">
          <div>
            <div class="activity-text"><strong>${a.author}</strong> ${actionText} in <span class="activity-forum">${a.forum_name}</span></div>
            <div class="activity-time">${timeAgo(a.timestamp)}</div>
          </div>
        </div>
      `;
    }).join('');

    el.querySelectorAll('.activity-item[data-domain]').forEach(item => {
      item.addEventListener('click', () => {
        const domain = item.dataset.domain;
        const threadId = item.dataset.thread;
        if (domain) ForumStore.switchForum(domain, threadId ? `/t/${threadId}` : '');
      });
    });
  }).catch(() => {
    el.innerHTML = '<div class="activity-empty">Could not load activity.</div>';
  });
}

let _showView, _renderForumList, _renderDmList;

export function showHome() {
  store.currentView = 'home';
  store.currentForum = null;
  store.currentThread = null;
  store.currentDm = null;
  _showView('homeView');
  _renderForumList();
  _renderDmList();
  renderActivityFeed();
}

export function initHome(deps) {
  _showView = deps.showView;
  _renderForumList = deps.renderForumList;
  _renderDmList = deps.renderDmList;
}
