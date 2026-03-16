// ========== BROWSER HISTORY MANAGEMENT ==========
import store from './state/store.js';
import { ForumStore } from '@forumline/client-sdk';

let nav = {};

// Convert a state object to a URL path
function stateToPath(state) {
  if (!state || state.view === 'home') return '/';
  if (state.view === 'forum' && state.forumId) return '/forum/' + state.forumId;
  if (state.view === 'thread' && state.threadId) {
    const base = '/thread/' + state.threadId;
    return state.forumId ? base + '?forum=' + state.forumId : base;
  }
  if (state.view === 'dm' && state.dmId) return '/dm/' + state.dmId;
  if (state.view === 'discover') return '/discover';
  if (state.view === 'profile' && state.username) return '/profile/' + state.username;
  if (state.view === 'settings') return '/settings';
  if (state.view === 'createForum') return '/create-forum';
  if (state.view === 'newThread') {
    return state.forumId ? '/new-thread?forum=' + state.forumId : '/new-thread';
  }
  return '/';
}

// Parse a URL path into a state object
function pathToState(path, search) {
  const params = new URLSearchParams(search || '');
  if (path === '/' || path === '') return { view: 'home' };

  const parts = path.replace(/^\//, '').split('/');
  const segment = parts[0];
  const id = parts[1] || '';

  if (segment === 'discover') return { view: 'discover' };
  if (segment === 'settings') return { view: 'settings' };
  if (segment === 'create-forum') return { view: 'createForum' };
  if (segment === 'new-thread') return { view: 'newThread', forumId: params.get('forum') || null };
  if (segment === 'forum' && id) return { view: 'forum', forumId: id };
  if (segment === 'thread' && id) return { view: 'thread', threadId: id, forumId: params.get('forum') || null };
  if (segment === 'dm' && id) return { view: 'dm', dmId: id };
  if (segment === 'profile' && id) return { view: 'profile', username: id };

  return { view: 'home' };
}

// Navigate to a state (used by popstate and initial load)
function navigateToState(state) {
  if (!state || state.view === 'home') {
    nav.showHome({ skipHistory: true });
  } else if (state.view === 'forum' && state.forumId) {
    // Check if this is a real forum (has a domain) — use webview
    if (state.isReal || ForumStore.forums.some(f => f.domain === state.forumId)) {
      ForumStore.switchForum(state.forumId);
    } else {
      nav.showForum(state.forumId, { skipHistory: true });
    }
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
}

// Store the initial path so we can navigate to it after auth
let _pendingInitialPath = null;

export function consumePendingRoute() {
  if (!_pendingInitialPath) return false;
  const state = _pendingInitialPath;
  _pendingInitialPath = null;
  if (state.view === 'home') return false;
  navigateToState(state);
  history.replaceState(state, '', stateToPath(state));
  return true;
}

export function initRouter(navFunctions) {
  nav = navFunctions;

  // Parse the current URL to determine initial state
  const initialState = pathToState(window.location.pathname, window.location.search);

  // Store the initial route for deferred navigation (after auth)
  if (initialState.view !== 'home') {
    _pendingInitialPath = initialState;
  }

  // Set initial history state with the current URL
  history.replaceState(initialState, '', stateToPath(initialState));

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
    navigateToState(state);
  });
}

export function pushState(state) {
  history.pushState(state, '', stateToPath(state));
}
