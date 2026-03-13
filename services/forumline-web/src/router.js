// ========== BROWSER HISTORY MANAGEMENT ==========
import store from './state/store.js';

let nav = {};

export function initRouter(navFunctions) {
  nav = navFunctions;

  // Set initial history state
  history.replaceState({ view: 'home' }, '', '');

  window.addEventListener('popstate', (e) => {
    // Restore top bar and sidebar (fixes back-from-login bug)
    nav.hideLogin?.();

    // Close any open modals/overlays
    nav.closeSearch?.();
    nav.closeAllDropdowns?.();
    nav.hideHoverCard?.();
    nav.stopVoiceSpeakingAnimation?.();
    const $ = nav.$;
    if ($) {
      $('voiceOverlay')?.classList.add('hidden');
      $('emojiPicker')?.classList.add('hidden');
      $('statusModal')?.classList.add('hidden');
      $('memberPanel')?.classList.add('hidden');
    }

    const state = e.state;
    if (!state || state.view === 'home') {
      nav.showHome({ skipHistory: true });
    } else if (state.view === 'forum' && state.forumId) {
      nav.showForum(state.forumId, { skipHistory: true });
    } else if (state.view === 'thread' && state.threadId) {
      if (state.forumId) store.currentForum = state.forumId;
      nav.showThread(state.threadId, { skipHistory: true });
    } else if (state.view === 'dm' && state.dmId) {
      nav.showDm(state.dmId, { skipHistory: true });
    } else if (state.view === 'discover') {
      nav.showDiscover({ skipHistory: true });
    } else if (state.view === 'profile' && state.username) {
      nav.showProfile(state.username, { skipHistory: true });
    } else if (state.view === 'settings') {
      nav.showSettings({ skipHistory: true });
    } else if (state.view === 'createForum') {
      nav.showCreateForum({ skipHistory: true });
    } else if (state.view === 'newThread') {
      if (state.forumId) store.currentForum = state.forumId;
      nav.showNewThread({ skipHistory: true });
    } else {
      nav.showHome({ skipHistory: true });
    }
  });
}

export function pushState(state) {
  history.pushState(state, '', '');
}
