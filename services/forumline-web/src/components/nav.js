import { $ } from '../lib/utils.js';
import { ForumlineAuth } from '@forumline/client-sdk';

let _deps = {
  showProfile: () => {},
  showSettings: () => {},
  showLogin: () => {},
  showHome: () => {},
};

export function closeAllDropdowns() {
  $('notifDropdown').classList.add('hidden');
  $('userDropdown').classList.add('hidden');
}

export function initNav(deps) {
  _deps = { ..._deps, ...deps };

  // Click outside to close dropdowns
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#notifBell') && !e.target.closest('#notifDropdown')) {
      $('notifDropdown').classList.add('hidden');
    }
    if (!e.target.closest('#userMenu') && !e.target.closest('#userDropdown')) {
      $('userDropdown').classList.add('hidden');
    }
  });

  // User menu click handler
  $('userMenu')?.addEventListener('click', (e) => {
    e.stopPropagation();
    $('notifDropdown').classList.add('hidden');
    $('userDropdown').classList.toggle('hidden');
  });

  // Menu profile/settings/logout click handlers
  $('menuProfile')?.addEventListener('click', () => _deps.showProfile('me'));
  $('menuSettings')?.addEventListener('click', () => _deps.showSettings());
  $('menuLogout')?.addEventListener('click', () => {
    closeAllDropdowns();
    ForumlineAuth.signOut();
  });

  // Logo click -> home handler
  const logoArea = document.querySelector('.logo-area');
  if (logoArea) {
    logoArea.addEventListener('click', _deps.showHome);
    logoArea.style.cursor = 'pointer';
  }
}
