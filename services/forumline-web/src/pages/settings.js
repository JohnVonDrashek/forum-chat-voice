import { $ } from '../lib/utils.js';
import { avatarUrl } from '../lib/avatar.js';
import store from '../state/store.js';
import { ForumlineAPI } from '../api/client.js';
import { ForumlineAuth } from '../api/auth.js';
import { Identity } from '../api/identity.js';

let _showView, _closeAllDropdowns, _showLogin, _showToast;

export function showSettings() {
  store.currentView = 'settings';
  store.currentForum = null;
  store.currentThread = null;
  store.currentDm = null;
  _showView('settingsView');
  _closeAllDropdowns();

  // Load real profile data from API into settings fields
  if (ForumlineAPI.isAuthenticated()) {
    Identity.getProfile().then(profile => {
      const userId = profile.forumline_id || ForumlineAPI.getUserId();
      const displayName = profile.display_name || profile.username || '';
      const profileAvatar = profile.avatar_url || avatarUrl(userId);

      const nameInput = $('settingsDisplayName');
      if (nameInput) nameInput.value = displayName;

      const emailInput = $('settingsEmail');
      const session = ForumlineAuth.getSession();
      if (emailInput && session?.user?.email) emailInput.value = session.user.email;

      const bioInput = $('settingsBio');
      if (bioInput) bioInput.value = profile.bio || profile.status_message || '';

      const avatarImg = document.querySelector('.settings-avatar');
      if (avatarImg) avatarImg.src = profileAvatar;

      const onlineSelect = $('onlineStatusSelect');
      if (onlineSelect && profile.online_status) onlineSelect.value = profile.online_status;
    }).catch(() => {
      // Fall through to default HTML values
    });
  }
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

  // Save Changes button handler
  const saveBtn = $('settingsSaveBtn');
  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      if (!ForumlineAPI.isAuthenticated()) return;

      const displayName = $('settingsDisplayName')?.value?.trim();
      const onlineStatus = $('onlineStatusSelect')?.value;

      const updates = {};
      if (displayName) updates.username = displayName;
      if (onlineStatus) {
        const statusMap = { 'online': 'online', 'away': 'away', 'busy': 'away', 'offline': 'offline' };
        updates.online_status = statusMap[onlineStatus] || 'online';
      }

      const bio = $('settingsBio')?.value?.trim();
      if (bio !== undefined) updates.status_message = bio || '';

      try {
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving...';
        await Identity.updateProfile(updates);
        if (_showToast) _showToast('Settings saved!');
      } catch (err) {
        if (_showToast) _showToast('Failed to save: ' + err.message);
      } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Changes';
      }
    });
  }
}
