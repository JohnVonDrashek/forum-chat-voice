import { $ } from '../lib/utils.js';
import { avatarUrl } from '../lib/avatar.js';
import { ForumlineAPI, ForumStore, EventStream } from '@forumline/client-sdk';

let _notifications = [];
let _loading = false;
let _notifUnsub = null;

function timeAgo(timestamp) {
  const now = new Date();
  const then = new Date(timestamp);
  const seconds = Math.floor((now - then) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  return `${weeks}w ago`;
}

function updateBadge(count) {
  if (count === undefined) {
    count = _notifications.filter(n => !n.read).length;
  }
  const badge = $('notifBell')?.querySelector('.notif-badge');
  if (!badge) return;
  if (count > 0) {
    badge.textContent = count;
    badge.style.display = '';
    $('notifBell').setAttribute('aria-label', `Notifications (${count} unread)`);
  } else {
    badge.style.display = 'none';
    $('notifBell').setAttribute('aria-label', 'Notifications');
  }
}

export function renderNotifications() {
  const list = $('notifList');
  if (!list) return;

  if (_loading) {
    list.innerHTML = '<div class="notif-loading">Loading...</div>';
    return;
  }

  if (_notifications.length === 0) {
    list.innerHTML = '<div class="notif-empty" role="listitem">No notifications yet</div>';
    return;
  }

  list.innerHTML = _notifications.map(n => {
    const seed = n.title.replace(/<[^>]*>/g, '').split(' ')[0] || 'unknown';
    return `
    <div class="notif-item ${!n.read ? 'unread' : ''}" role="listitem"
         data-id="${n.id}" data-domain="${n.forum_domain}" data-link="${n.link || '/'}">
      <img src="${avatarUrl(seed)}" alt="" onerror="this.style.display='none'">
      <div>
        <div class="notif-item-text">${n.title}${n.forum_name ? ' <span class="notif-forum">in ' + n.forum_name + '</span>' : ''}</div>
        <div class="notif-item-time">${timeAgo(n.timestamp)}</div>
      </div>
    </div>
  `;
  }).join('');

  list.querySelectorAll('.notif-item').forEach(item => {
    item.addEventListener('click', () => {
      const id = item.dataset.id;
      const domain = item.dataset.domain;
      const link = item.dataset.link;

      // Mark as read
      const notif = _notifications.find(n => n.id === id);
      if (notif && !notif.read) {
        notif.read = true;
        updateBadge();
        ForumlineAPI.markNotificationRead(id).catch(() => {});
      }

      $('notifDropdown').classList.add('hidden');

      // Navigate to the forum thread
      if (domain) {
        ForumStore.switchForum(domain, link || '');
      }
    });
  });
}

async function fetchNotifications() {
  if (!ForumlineAPI.isAuthenticated()) return;
  _loading = true;
  renderNotifications();
  try {
    _notifications = await ForumlineAPI.getNotifications();
    updateBadge();
  } catch (e) {
    console.warn('[Notifications] fetch failed:', e.message);
    _notifications = [];
  }
  _loading = false;
  renderNotifications();
}

function connectNotifications() {
  if (_notifUnsub) return;

  _notifUnsub = EventStream.subscribeNotification((notif) => {
    _notifications.unshift({
      id: notif.id,
      type: notif.type,
      title: notif.title,
      body: notif.body,
      link: notif.link || '/',
      read: false,
      timestamp: notif.created_at,
      forum_domain: notif.forum_domain,
      forum_name: notif.forum_name,
    });
    updateBadge();
    if (!$('notifDropdown')?.classList.contains('hidden')) {
      renderNotifications();
    }
  });
}

export function initNotifications() {
  // Notification bell click handler
  $('notifBell')?.addEventListener('click', (e) => {
    e.stopPropagation();
    $('userDropdown').classList.add('hidden');
    const dd = $('notifDropdown');
    dd.classList.toggle('hidden');
    if (!dd.classList.contains('hidden')) {
      fetchNotifications();
    }
  });

  // Mark all read handler
  $('markAllRead')?.addEventListener('click', async () => {
    _notifications.forEach(n => n.read = true);
    updateBadge();
    renderNotifications();
    ForumlineAPI.markAllNotificationsRead().catch(() => {});
  });
}

// Called after auth is confirmed (from onAuthStateChange callback)
export function startNotificationUpdates() {
  if (!ForumlineAPI.isAuthenticated()) return;

  // Fetch unread count for badge
  ForumlineAPI.getUnreadCount().then(data => {
    updateBadge(data.count);
  }).catch(() => {});

  // Subscribe to unified event stream for real-time updates
  connectNotifications();
}
