import { $ } from '../lib/utils.js';
import store from '../state/store.js';
import { ForumlineAPI } from '../api/client.js';
import { ForumlineAuth } from '../api/auth.js';

let _showView, _closeAllDropdowns, _showLogin, _showToast;

export function showSettings() {
  store.currentView = 'settings';
  store.currentForum = null;
  store.currentThread = null;
  store.currentDm = null;
  _showView('settingsView');
  _closeAllDropdowns();
}

export function initSettings(deps) {
  _showView = deps.showView;
  _closeAllDropdowns = deps.closeAllDropdowns;
  _showLogin = deps.showLogin;
  _showToast = deps.showToast;

  // Settings nav item click handlers
  document.querySelectorAll('.settings-nav-item').forEach(item => {
    item.addEventListener('click', () => {
      const target = item.dataset.settings;

      if (target === 'logout') {
        ForumlineAuth.signOut();
        return;
      }

      document.querySelectorAll('.settings-nav-item').forEach(i => {
        i.classList.remove('active');
        if (i.getAttribute('role') === 'tab') {
          i.setAttribute('aria-selected', 'false');
        }
      });
      item.classList.add('active');
      if (item.getAttribute('role') === 'tab') {
        item.setAttribute('aria-selected', 'true');
      }

      document.querySelectorAll('.settings-panel').forEach(p => p.classList.add('hidden'));
      const panelId = 'settings' + target.charAt(0).toUpperCase() + target.slice(1);
      const panel = $(panelId);
      if (panel) panel.classList.remove('hidden');
    });
  });
}
