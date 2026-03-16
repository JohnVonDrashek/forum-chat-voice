import { $ } from '../lib/utils.js';
import { avatarUrl } from '../lib/avatar.js';
import store from '../state/store.js';
import * as data from '../state/data.js';
import { ForumlineAPI, ForumRegistrationAPI, ForumStore } from '@forumline/client-sdk';

let _showView, _closeAllDropdowns, _showHome, _showForum, _showToast, _fireConfetti;

let selectedBannerGradient = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';

export function showCreateForum() {
  store.currentView = 'createForum';
  _showView('createForumView');
  _closeAllDropdowns();
}

export function initCreateForum(deps) {
  _showView = deps.showView;
  _closeAllDropdowns = deps.closeAllDropdowns;
  _showHome = deps.showHome;
  _showForum = deps.showForum;
  _showToast = deps.showToast;
  _fireConfetti = deps.fireConfetti;

  // Live preview handlers (name input)
  $('createForumName').addEventListener('input', (e) => {
    $('previewName').textContent = e.target.value || 'Your Forum';
    // Auto-generate subdomain
    const subdomain = e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    $('createForumSubdomain').value = subdomain;
    $('previewAvatar').src = avatarUrl(subdomain || 'new-forum', 'shapes');

    if (subdomain) {
      $('subdomainStatus').classList.remove('hidden');
    } else {
      $('subdomainStatus').classList.add('hidden');
    }
  });

  // Live preview handlers (desc input)
  $('createForumDesc').addEventListener('input', (e) => {
    $('previewDesc').textContent = e.target.value || 'Your forum description will appear here...';
  });

  // Category button handlers
  document.querySelectorAll('.create-category-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.create-category-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
    });
  });

  // Banner swatch handlers
  document.querySelectorAll('.banner-swatch').forEach(swatch => {
    swatch.addEventListener('click', () => {
      document.querySelectorAll('.banner-swatch').forEach(s => {
        s.classList.remove('active');
        s.setAttribute('aria-checked', 'false');
      });
      swatch.classList.add('active');
      swatch.setAttribute('aria-checked', 'true');
      selectedBannerGradient = swatch.dataset.gradient;
      // Update preview
      const previewBanner = document.querySelector('.preview-card .discover-card-banner');
      if (previewBanner) previewBanner.style.background = selectedBannerGradient;
    });
  });

  // Cancel handler
  $('createForumCancel').addEventListener('click', _showHome);

  // Submit handler — tries real API registration if authenticated, falls back to mock
  $('createForumSubmit').addEventListener('click', async () => {
    const name = $('createForumName').value.trim();
    const subdomain = $('createForumSubdomain').value.trim();
    const desc = $('createForumDesc')?.value.trim() || '';
    if (name && subdomain) {
      // Try real API registration if authenticated
      if (ForumlineAPI.isAuthenticated()) {
        try {
          const domain = subdomain + '.forumline.net';
          const result = await ForumRegistrationAPI.registerForum(
            { name, domain, api_base: 'https://' + domain, web_base: 'https://' + domain, description: desc },
            ForumlineAPI.getToken()
          );
          // Also sync memberships to pick up the new forum
          await ForumStore.syncFromServer(ForumlineAPI.getToken());
          _clearForm();
          _showHome();
          _showToast(`"${name}" created!`);
          setTimeout(_fireConfetti, 300);
          return;
        } catch (err) {
          // Fall through to mock creation if API fails
          console.warn('Forum registration API failed, using mock:', err.message);
        }
      }

      // Fallback: add to mock forums list
      const newForum = {
        id: 'f' + Date.now(),
        name: name,
        members: 1,
        seed: subdomain,
        unread: false,
        threads: 0,
      };
      data.forums.push(newForum);
      data.threads[newForum.id] = [];
      data.forumMembers[newForum.id] = [
        { name: 'testcaller', seed: 'testcaller', role: 'Owner', online: true },
      ];

      _clearForm();
      _showForum(newForum.id);
      _showToast(`"${name}" created!`);
      setTimeout(_fireConfetti, 300);
    } else {
      if (!name) _showToast('Enter a forum name');
      else if (!subdomain) _showToast('Enter a subdomain');
    }
  });
}

function _clearForm() {
  $('createForumName').value = '';
  $('createForumSubdomain').value = '';
  if ($('createForumDesc')) $('createForumDesc').value = '';
  $('previewName').textContent = 'Your Forum';
  $('previewDesc').textContent = 'Your forum description will appear here...';
  $('subdomainStatus').classList.add('hidden');
}
