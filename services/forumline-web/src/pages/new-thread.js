import { $ } from '../lib/utils.js';
import store from '../state/store.js';
import * as data from '../state/data.js';

let _showView, _showForum, _showHome, _showToast;

export function showNewThread() {
  store.currentView = 'newThread';
  _showView('newThreadView');
}

export function initNewThread(deps) {
  _showView = deps.showView;
  _showForum = deps.showForum;
  _showHome = deps.showHome;
  _showToast = deps.showToast;

  // Back button handler
  $('backFromNewThread').addEventListener('click', () => {
    if (store.currentForum) _showForum(store.currentForum);
    else _showHome();
  });

  // Cancel button handler
  $('composerCancel').addEventListener('click', () => {
    if (store.currentForum) _showForum(store.currentForum);
    else _showHome();
  });

  // Submit handler (creates thread, adds to mock data)
  $('composerSubmit').addEventListener('click', () => {
    const title = $('composerTitle').value.trim();
    const body = $('composerBody').value.trim();
    if (title && body) {
      // Add to mock data
      const forumId = store.currentForum || '1';
      if (!data.threads[forumId]) data.threads[forumId] = [];
      const newThread = {
        id: 't' + Date.now(),
        title: title,
        author: 'testcaller',
        seed: 'testcaller',
        snippet: body.substring(0, 80) + '...',
        replies: 0,
        time: 'just now'
      };
      data.threads[forumId].unshift(newThread);
      data.posts[newThread.id] = [{ author: 'testcaller', seed: 'testcaller', time: 'just now', content: body }];

      $('composerTitle').value = '';
      $('composerBody').value = '';

      _showForum(forumId);
      _showToast('Thread posted!');
    }
  });
}
