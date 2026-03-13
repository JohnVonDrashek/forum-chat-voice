import { $ } from '../lib/utils.js';
import * as data from '../state/data.js';

let _deps = {
  showThread: () => {},
  showForum: () => {},
};

const notifTargets = {
  'n1': { type: 'thread', id: 't2' },
  'n2': { type: 'thread', id: 't1' },
  'n3': { type: 'forum', id: '3' },
  'n4': { type: 'thread', id: 't6' },
  'n5': { type: 'thread', id: 't1' },
};

export function renderNotifications() {
  const notifications = data.notifications;

  $('notifList').innerHTML = notifications.map(n => `
    <div class="notif-item ${n.unread ? 'unread' : ''}" role="listitem">
      <img src="https://api.dicebear.com/7.x/avataaars/svg?seed=${n.seed}" alt="" onerror="this.style.display='none'">
      <div>
        <div class="notif-item-text">${n.text}</div>
        <div class="notif-item-time">${n.time}</div>
      </div>
    </div>
  `).join('');

  // Bind click-to-navigate on each notification item
  $('notifList').querySelectorAll('.notif-item').forEach((item, idx) => {
    item.addEventListener('click', () => {
      const notif = notifications[idx];
      if (notif) {
        notif.unread = false;
        const target = notifTargets[notif.id];
        $('notifDropdown').classList.add('hidden');

        const unreadCount = notifications.filter(n => n.unread).length;
        const badge = $('notifBell').querySelector('.notif-badge');
        if (unreadCount > 0) {
          badge.textContent = unreadCount;
          badge.style.display = '';
        } else {
          badge.style.display = 'none';
        }

        if (target) {
          if (target.type === 'thread') _deps.showThread(target.id);
          else if (target.type === 'forum') _deps.showForum(target.id);
        }
      }
    });
  });
}

export function initNotifications(deps) {
  _deps = { ..._deps, ...deps };

  // Notification bell click handler
  $('notifBell')?.addEventListener('click', (e) => {
    e.stopPropagation();
    $('userDropdown').classList.add('hidden');
    const dd = $('notifDropdown');
    dd.classList.toggle('hidden');
    if (!dd.classList.contains('hidden')) {
      renderNotifications();
    }
  });

  // Mark all read handler
  $('markAllRead')?.addEventListener('click', () => {
    const notifications = data.notifications;
    notifications.forEach(n => n.unread = false);
    $('notifBell').querySelector('.notif-badge').style.display = 'none';
    $('notifBell').setAttribute('aria-label', 'Notifications');
    renderNotifications();
  });
}
