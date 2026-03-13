import { $ } from '../lib/utils.js';
import store from '../state/store.js';
import * as data from '../state/data.js';

let _deps = {
  showToast: () => {},
  renderFilteredThreads: () => {},
};

let contextThreadId = null;
let contextForumId = null;

export function showContextMenu(x, y, threadId, forumId) {
  contextThreadId = threadId;
  contextForumId = forumId;
  const menu = $('contextMenu');
  menu.classList.remove('hidden');
  menu.style.left = Math.min(x, window.innerWidth - 200) + 'px';
  menu.style.top = Math.min(y, window.innerHeight - 160) + 'px';
}

export function initContextMenu(deps) {
  _deps = { ..._deps, ...deps };

  // Document click to close
  document.addEventListener('click', () => {
    $('contextMenu').classList.add('hidden');
  });

  // Context menu item click handlers
  document.querySelectorAll('.context-menu-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      const action = item.dataset.action;
      $('contextMenu').classList.add('hidden');

      if (action === 'pin') {
        const allThreads = Object.values(data.threads).flat();
        const thread = allThreads.find(t => t.id === contextThreadId);
        if (thread) {
          thread.pinned = !thread.pinned;
          const currentForum = store.currentForum;
          if (currentForum) _deps.renderFilteredThreads(currentForum);
          _deps.showToast(thread.pinned ? 'Thread pinned' : 'Thread unpinned');
        }
      } else if (action === 'copy') {
        _deps.showToast('Link copied to clipboard');
      } else if (action === 'mute') {
        _deps.showToast('Thread muted');
      } else if (action === 'report') {
        _deps.showToast('Report submitted');
      }
    });
  });
}
