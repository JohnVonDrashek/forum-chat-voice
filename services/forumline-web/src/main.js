// ========== FORUMLINE — Main Entry Point ==========
// Composes all UI and API modules, wires up dependencies.

import './styles/global.css';
import './styles/layout.css';
import './styles/components.css';

import { $ } from './lib/utils.js';
import { avatarUrl } from './lib/avatar.js';
import { initSafeStorage } from './lib/storage.js';
import { setTheme, initThemePicker } from './lib/theme.js';
import { initAccessibility } from './lib/a11y.js';
import { initKeyboardShortcuts } from './lib/keyboard.js';
import { initMobile } from './lib/mobile.js';

import store from './state/store.js';
import * as data from './state/data.js';

import { showHome, renderActivityFeed, initHome } from './pages/home.js';
import { showForum, renderFilteredThreads, renderOnlineBar, initForum } from './pages/forum.js';
import { showThread, renderPosts, initThread } from './pages/thread.js';
import { showDm, renderMessages, initConversation } from './pages/conversation.js';
import { showDiscover, renderDiscover, initDiscover } from './pages/discover.js';
import { showProfile, initProfile, clearIdentityProfile } from './pages/profile.js';
import { showSettings, initSettings } from './pages/settings.js';
import { showCreateForum, initCreateForum } from './pages/create-forum.js';
import { showNewThread, initNewThread } from './pages/new-thread.js';
import { showLogin, hideLogin, initLogin } from './pages/login.js';

import { renderForumList, renderDmList, renderBookmarks, addBookmark, removeBookmark, getBookmarks, initSidebar } from './components/sidebar.js';
import { showToast } from './components/toast.js';
import { openSearch, closeSearch, initSearch } from './components/search.js';
import { renderNotifications, initNotifications, startNotificationUpdates } from './components/notifications.js';
import { renderVoiceParticipants, startVoiceSpeakingAnimation, stopVoiceSpeakingAnimation, initVoiceRoom } from './components/voice-room.js';
import { renderEmojiPicker, initEmojiPicker } from './components/emoji-picker.js';
import { initMemberPanel } from './components/member-panel.js';
import { hideHoverCard, initHoverCard } from './components/hover-card.js';
import { closeLightbox, initLightbox } from './components/lightbox.js';
import { showOnboarding, initOnboarding } from './components/onboarding.js';
import { showContextMenu, initContextMenu } from './components/context-menu.js';
import { fireConfetti } from './components/confetti.js';
import { initStatusModal } from './components/status-modal.js';
import { closeAllDropdowns, initNav } from './components/nav.js';

import { initRouter, pushState, consumePendingRoute } from './router.js';

// API modules
import { ForumlineAPI } from './api/client.js';
import { ForumlineAuth } from './api/auth.js';
import { EventStream } from './api/event-stream.js';
import { DmStore } from './api/dm-store.js';
import { PresenceTracker } from './api/presence.js';
import { ForumStore } from './api/forum-store.js';
import { ForumDiscoveryAPI } from './api/forum-discovery.js';
import { CallManager } from './api/calls.js';
import { Identity } from './api/identity.js';
import { PushNotifications } from './api/push.js';
import { parseDeepLink, handleDeepLinkParams, checkUrlParams } from './api/deep-link.js';
import { NativeBridge } from './api/native-bridge.js';

// ========== CORE VIEW MANAGEMENT ==========
function showView(viewId) {
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  $(viewId).classList.remove('hidden');
}

// ========== NAVIGATION WRAPPERS WITH HISTORY ==========
const wrappedShowHome = (opts) => {
  showHome();
  ForumStore.goHome();
  if (!opts?.skipHistory) pushState({ view: 'home' });
};

const wrappedShowForum = (id, opts) => {
  // Check if this is a real forum (from ForumStore) — use webview instead of mock forum view
  const realForum = ForumStore.forums.find(f => f.id === id || f.domain === id);
  if (realForum) {
    ForumStore.switchForum(realForum.domain);
    if (!opts?.skipHistory) pushState({ view: 'forum', forumId: id });
    return;
  }
  showForum(id);
  renderOnlineBar(id);
  if (!opts?.skipHistory) pushState({ view: 'forum', forumId: id });
};

const wrappedShowThread = (id, opts) => {
  showThread(id);
  if (!opts?.skipHistory) pushState({ view: 'thread', threadId: id, forumId: store.currentForum });
};

const wrappedShowDm = (id, opts) => {
  showDm(id);
  ForumStore.goHome();
  if (!opts?.skipHistory) pushState({ view: 'dm', dmId: id });
};

const wrappedShowDiscover = (opts) => {
  showDiscover();
  ForumStore.goHome();
  if (!opts?.skipHistory) pushState({ view: 'discover' });
};

const wrappedShowProfile = (username, opts) => {
  showProfile(username);
  if (!opts?.skipHistory) pushState({ view: 'profile', username });
};

const wrappedShowSettings = (opts) => {
  showSettings();
  if (!opts?.skipHistory) pushState({ view: 'settings' });
};

const wrappedShowCreateForum = (opts) => {
  showCreateForum();
  if (!opts?.skipHistory) pushState({ view: 'createForum' });
};

const wrappedShowNewThread = (opts) => {
  showNewThread();
  if (!opts?.skipHistory) pushState({ view: 'newThread', forumId: store.currentForum });
};

// ========== AUTH STATE MANAGEMENT ==========
let _authHasRendered = false;
let _dmStoreStopUpdates = null;

function _updateUserDisplay(session) {
  if (!session || !session.user) return;
  const username = session.user.user_metadata?.username || session.user.email?.split('@')[0] || 'user';
  const email = session.user.email || '';
  // Use user ID as avatar seed per architecture spec (DiceBear avataaars seeded by ID)
  const seed = session.user.id || username;

  const dropdownName = document.querySelector('.user-dropdown-name');
  const dropdownEmail = document.querySelector('.user-dropdown-email');
  const dropdownAvatar = document.querySelector('.user-dropdown-header img');
  if (dropdownName) dropdownName.textContent = username;
  if (dropdownEmail) dropdownEmail.textContent = email;
  if (dropdownAvatar) dropdownAvatar.src = avatarUrl(seed);

  const userMenuAvatar = document.querySelector('#userMenu img');
  if (userMenuAvatar) userMenuAvatar.src = avatarUrl(seed);

  const userMenuName = document.querySelector('#userMenu .username');
  if (userMenuName) userMenuName.textContent = username;

  // Sidebar user display
  const sidebarAvatar = $('sidebarAvatar');
  if (sidebarAvatar) sidebarAvatar.src = avatarUrl(seed);
  const sidebarUsername = $('sidebarUsername');
  if (sidebarUsername) sidebarUsername.textContent = username;

  // Home greeting
  const homeGreeting = $('homeGreeting');
  if (homeGreeting) homeGreeting.textContent = 'Welcome back, ' + username;

  // Reply box avatar
  const replyAvatar = $('replyAvatar');
  if (replyAvatar) replyAvatar.src = avatarUrl(seed);
}

function _startDmStoreIfAuth() {
  if (ForumlineAPI.isAuthenticated() && !_dmStoreStopUpdates) {
    _dmStoreStopUpdates = DmStore.startUpdates();
    DmStore.onChanged(() => renderDmList());
    PresenceTracker.start();
    PresenceTracker.onUpdate(() => renderDmList());
  }
}

function _stopDmStore() {
  if (_dmStoreStopUpdates) {
    _dmStoreStopUpdates();
    _dmStoreStopUpdates = null;
  }
  PresenceTracker.stop();
}

// Auth state change handler
ForumlineAuth.restoreSessionFromUrl();

ForumlineAuth.onAuthStateChange((event, session) => {
  if (event === 'TOKEN_REFRESHED') {
    if (session) ForumlineAPI.configure({ accessToken: session.access_token, userId: session.user.id });
    if (!_authHasRendered && session) {
      hideLogin();
      wrappedShowHome({ skipHistory: true });
      consumePendingRoute();
      _updateUserDisplay(session);
      _authHasRendered = true;
    }
    EventStream.reconnect();
    CallManager.reconnectCallSSE();
  } else if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN') {
    if (session) {
      ForumlineAPI.configure({ accessToken: session.access_token, userId: session.user.id });
      hideLogin();
      wrappedShowHome({ skipHistory: true });
      // Navigate to the URL path the user originally requested (e.g. /discover, /settings)
      consumePendingRoute();
      _updateUserDisplay(session);
      _authHasRendered = true;

      _startDmStoreIfAuth();
      startNotificationUpdates();
      ForumStore.loadCache();
      ForumStore.syncFromServer(ForumlineAPI.getToken()).then(() => {
        CallManager.init();
        PushNotifications.registerServiceWorker();
        checkUrlParams({ showDm: wrappedShowDm, showForum: wrappedShowForum, ForumStore, DmStore });
      });

      if (event === 'SIGNED_IN') {
        showToast('Welcome back!');
      }
    } else {
      if (!ForumlineAuth.isRefreshing) {
        showLogin();
        _authHasRendered = false;
      }
    }
  } else if (event === 'SIGNED_OUT') {
    ForumlineAPI.configure({ accessToken: null, userId: null });
    _stopDmStore();
    CallManager.destroyCallManager();
    clearIdentityProfile();
    _authHasRendered = false;
    showLogin();
  }
});

// ========== WINDOW LIFECYCLE ==========
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    PresenceTracker.pause();
  } else {
    PresenceTracker.resume();
  }
});

window.addEventListener('beforeunload', () => {
  EventStream.disconnect();
});

// ========== INITIALIZE ALL MODULES ==========

// Foundation
initSafeStorage();
initThemePicker();

// Components (no deps or self-contained)
renderEmojiPicker();
initEmojiPicker();
initLightbox();
initOnboarding();
initVoiceRoom();
initStatusModal();

// Wire up command palette actions
data.commands[0].action = () => wrappedShowCreateForum();
data.commands[1].action = () => { if (store.currentForum) wrappedShowNewThread(); else showToast('Open a forum first'); };
data.commands[2].action = () => wrappedShowSettings();
data.commands[3].action = () => wrappedShowProfile('me');
data.commands[4].action = () => wrappedShowDiscover();
data.commands[5].action = () => { $('voiceOverlay').classList.remove('hidden'); renderVoiceParticipants(); startVoiceSpeakingAnimation(); };
data.commands[6].action = () => { const isDark = document.documentElement.getAttribute('data-theme') === 'dark'; setTheme(isDark ? 'light' : 'dark'); };
data.commands[7].action = () => wrappedShowHome();

// Components with deps
initNav({
  showProfile: wrappedShowProfile,
  showSettings: wrappedShowSettings,
  showLogin,
  showHome: wrappedShowHome,
});

initSidebar({
  showForum: wrappedShowForum,
  showDm: wrappedShowDm,
  showThread: wrappedShowThread,
});

initSearch({
  showForum: wrappedShowForum,
  showThread: wrappedShowThread,
  showProfile: wrappedShowProfile,
  showDiscover: wrappedShowDiscover,
  showCreateForum: wrappedShowCreateForum,
  showNewThread: wrappedShowNewThread,
  showSettings: wrappedShowSettings,
  showHome: wrappedShowHome,
  showToast,
  setTheme,
  renderVoiceParticipants,
  closeAllDropdowns,
  hideHoverCard,
});

initNotifications();

initMemberPanel({
  showProfile: wrappedShowProfile,
});

initHoverCard({
  showProfile: wrappedShowProfile,
  showDm: wrappedShowDm,
  showToast,
});

initContextMenu({
  showToast,
  renderFilteredThreads,
});

// Pages
initHome({
  showView,
  renderForumList,
  renderDmList,
});

initForum({
  showView,
  renderForumList,
  renderDmList,
  showThread: wrappedShowThread,
  showToast,
  showContextMenu,
});

initThread({
  showView,
  showToast,
  showForum: wrappedShowForum,
  showHome: wrappedShowHome,
  addBookmark,
  removeBookmark,
  getBookmarks,
});

initConversation({
  showView,
  renderForumList,
  renderDmList,
  showHome: wrappedShowHome,
  showToast,
});

initDiscover({
  showView,
  renderForumList,
  renderDmList,
  showToast,
});

initProfile({
  showView,
  renderForumList,
  renderDmList,
  closeAllDropdowns,
  showThread: wrappedShowThread,
  showForum: wrappedShowForum,
  showSettings: wrappedShowSettings,
});

initSettings({
  showView,
  closeAllDropdowns,
  showLogin,
  showToast,
});

initCreateForum({
  showView,
  closeAllDropdowns,
  showHome: wrappedShowHome,
  showForum: wrappedShowForum,
  showToast,
  fireConfetti,
});

initNewThread({
  showView,
  showForum: wrappedShowForum,
  showHome: wrappedShowHome,
  showToast,
});

initLogin({
  showView,
  showHome: wrappedShowHome,
  showToast,
  showOnboarding,
});

// Keyboard shortcuts
initKeyboardShortcuts({
  openSearch,
  closeSearch,
  closeLightbox,
  closeAllDropdowns,
  hideHoverCard,
  showForum: wrappedShowForum,
  showHome: wrappedShowHome,
  stopVoiceSpeakingAnimation,
  $,
});

// Accessibility
initAccessibility();

// Mobile support
initMobile({
  $,
  showHome: wrappedShowHome,
  showForum: wrappedShowForum,
  showThread: wrappedShowThread,
  showDm: wrappedShowDm,
  showDiscover: wrappedShowDiscover,
});

// Router (browser history)
initRouter({
  $,
  showHome: wrappedShowHome,
  showForum: wrappedShowForum,
  showThread: wrappedShowThread,
  showDm: wrappedShowDm,
  showDiscover: wrappedShowDiscover,
  showProfile: wrappedShowProfile,
  showSettings: wrappedShowSettings,
  showCreateForum: wrappedShowCreateForum,
  showNewThread: wrappedShowNewThread,
  hideLogin,
  closeSearch,
  closeAllDropdowns,
  hideHoverCard,
  stopVoiceSpeakingAnimation,
});

// Native app bridge
NativeBridge.init({
  showDm: wrappedShowDm,
  showForum: wrappedShowForum,
  handleDeepLinkParams,
  CallManager,
});

// ========== BUTTON HANDLERS ==========
$('discoverBtn')?.addEventListener('click', () => wrappedShowDiscover());
$('createBtn')?.addEventListener('click', () => wrappedShowCreateForum());
$('newThreadBtn')?.addEventListener('click', () => wrappedShowNewThread());
$('announcementLearnMore')?.addEventListener('click', () => wrappedShowDiscover());

// Webview forum buttons
$('webviewLeaveBtn')?.addEventListener('click', async () => {
  const btn = $('webviewLeaveBtn');
  const mode = btn?.dataset.mode;
  const domain = btn?.dataset.domain;

  if (mode === 'join' && domain) {
    // Join from preview
    btn.disabled = true;
    btn.textContent = 'Joining...';
    try {
      const forumInfo = {
        name: $('webviewForumName')?.textContent || domain,
        icon_url: $('webviewAvatar')?.src || '',
        web_base: 'https://' + domain,
      };
      await ForumStore.joinByDomain(domain, forumInfo);
      btn.textContent = 'Leave';
      btn.title = 'Leave forum';
      btn.dataset.mode = 'leave';
      btn.disabled = false;
      $('webviewMuteBtn').style.display = '';
      renderForumList();
      showToast('Forum joined!');
    } catch (err) {
      btn.textContent = 'Join';
      btn.disabled = false;
      showToast('Failed to join: ' + err.message);
    }
  } else {
    // Leave
    const forum = ForumStore.activeForum;
    if (!forum) return;
    if (confirm(`Leave ${forum.name}? You can rejoin later.`)) {
      ForumStore.leaveForum(forum.domain);
      wrappedShowHome();
      showToast(`Left ${forum.name}`);
    }
  }
});

$('webviewMuteBtn')?.addEventListener('click', () => {
  const forum = ForumStore.activeForum;
  if (!forum) return;
  const willMute = !forum.muted;
  ForumStore.toggleMute(forum.domain);
  showToast(willMute ? `Muted ${forum.name}` : `Unmuted ${forum.name}`);
});

$('webviewAuthBtn')?.addEventListener('click', () => {
  ForumStore.loginToForum();
});

$('webviewBannerLoginBtn')?.addEventListener('click', () => {
  ForumStore.loginToForum();
});

// ========== INITIAL RENDER ==========
renderForumList();
renderDmList();
renderActivityFeed();
renderBookmarks();

// Re-render sidebar when ForumStore memberships change
ForumStore.subscribe(() => renderForumList());

// Announcement banner dismiss
const bannerDismissed = localStorage.getItem('forumline-banner-dismissed');
if (bannerDismissed) {
  $('announcementBanner')?.classList.add('dismissed');
}
$('announcementClose')?.addEventListener('click', () => {
  $('announcementBanner').classList.add('dismissed');
  localStorage.setItem('forumline-banner-dismissed', 'true');
});

// Post author click -> profile
document.addEventListener('click', (e) => {
  const authorEl = e.target.closest('.post-author');
  if (authorEl) {
    const name = authorEl.textContent.split(' ')[0].trim();
    if (data.profiles[name]) {
      wrappedShowProfile(name);
    }
  }
});

// DiceBear global image error handler
document.addEventListener('error', (e) => {
  if (e.target.tagName === 'IMG' && e.target.src.includes('dicebear.com')) {
    e.target.style.display = 'none';
  }
}, true);
