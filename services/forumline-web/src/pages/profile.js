import { $, plural } from '../lib/utils.js';
import { avatarUrl } from '../lib/avatar.js';
import store from '../state/store.js';
import * as data from '../state/data.js';
import { Identity, ForumlineAPI } from '@forumline/client-sdk';

let _showView, _renderForumList, _renderDmList, _closeAllDropdowns, _showThread, _showForum, _showSettings;

// Cache for the current user's identity profile loaded from the API.
let _identityProfile = null;
// Track which username/key is currently displayed for tab rendering.
let _currentProfileKey = null;

function animateCounter(el, target) {
  const duration = 600;
  const start = parseInt(el.textContent) || 0;
  const diff = target - start;
  if (diff === 0) return;
  const startTime = performance.now();

  function step(now) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    el.textContent = Math.round(start + diff * eased);
    if (progress < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

export function showProfile(username) {
  store.currentView = 'profile';
  store.currentForum = null;
  store.currentThread = null;
  store.currentDm = null;

  // Determine if viewing own profile
  const currentUserId = ForumlineAPI.getUserId();
  const isOwnProfile = username === 'me' || username === currentUserId || username === _identityProfile?.username;

  // Resolve the profile key for mock data lookups (tabs, badges, etc.)
  // For own profile, try cached API username first, then fall back to session metadata
  let profileKey;
  if (isOwnProfile) {
    const session = JSON.parse(localStorage.getItem('forumline-session') || 'null');
    profileKey = _identityProfile?.username || session?.user?.user_metadata?.username || username;
  } else {
    profileKey = username;
  }
  _currentProfileKey = profileKey;

  _showView('profileView');
  _renderForumList();
  _renderDmList();
  _closeAllDropdowns();

  // For own profile, prefer cached API data or fetch fresh data
  if (isOwnProfile && ForumlineAPI.isAuthenticated()) {
    // Render cached identity immediately if available, otherwise show placeholder
    if (_identityProfile) {
      _renderApiProfileData(_identityProfile, currentUserId, profileKey, isOwnProfile);
    } else {
      // Show placeholder while loading
      $('profileName').textContent = profileKey;
      $('profileBio').textContent = '';
      $('profileAvatar').src = avatarUrl(currentUserId || profileKey);
      $('profileForumCount').textContent = '—';
      $('profileThreadCount').textContent = '—';
      $('profileReplyCount').textContent = '—';
      $('profileJoined').textContent = '';
      const editBtn = $('profileEditBtn');
      editBtn.classList.remove('hidden');
      renderProfileTab('activity', profileKey);
      renderProfileBadges(profileKey);
    }

    // Fetch fresh data from API
    Identity.getProfile().then(profile => {
      _identityProfile = profile;
      _renderApiProfileData(profile, currentUserId, profileKey, isOwnProfile);
    }).catch(() => {
      // If API fails and we have no cache, fall back to mock data
      if (!_identityProfile) {
        const mockProfile = data.profiles[profileKey];
        if (mockProfile) _renderProfileData(mockProfile, profileKey, isOwnProfile);
      }
    });
  } else {
    // Viewing another user's profile — use mock data
    const mockProfile = data.profiles[profileKey] || null;
    _renderProfileData(mockProfile, profileKey, isOwnProfile);
  }
}

/** Returns the cached identity profile (loaded from /api/identity). */
export function getIdentityProfile() {
  return _identityProfile;
}

/** Clears the cached identity profile (call on sign-out). */
export function clearIdentityProfile() {
  _identityProfile = null;
}

function _renderApiProfileData(profile, currentUserId, profileKey, _isOwnProfile) {
  const userId = profile.forumline_id || currentUserId;
  const displayName = profile.display_name || profile.username || profileKey;
  const profileAvatar = profile.avatar_url || avatarUrl(userId);
  const bio = profile.bio || profile.status_message || '';

  $('profileName').textContent = displayName;
  $('profileBio').textContent = bio;
  $('profileAvatar').src = profileAvatar;

  // Stats — API doesn't currently return these, so show '—' placeholders
  $('profileForumCount').textContent = '—';
  $('profileThreadCount').textContent = '—';
  $('profileReplyCount').textContent = '—';
  $('profileJoined').textContent = '';

  // Show edit button for own profile
  const editBtn = $('profileEditBtn');
  editBtn.classList.remove('hidden');

  // Render tabs and badges using the profile key (for mock activity data)
  renderProfileTab('activity', profileKey);
  renderProfileBadges(profileKey);
}

function _renderProfileData(profile, username, isOwnProfile) {
  const currentUserId = ForumlineAPI.getUserId();
  if (profile) {
    $('profileName').textContent = profile.name || profile.display_name || username;
    $('profileBio').textContent = profile.bio || '';
    const seed = isOwnProfile && currentUserId ? currentUserId : (profile.seed || username);
    $('profileAvatar').src = avatarUrl(seed);
    $('profileForumCount').textContent = profile.forums || 0;
    $('profileThreadCount').textContent = profile.threads || 0;
    $('profileReplyCount').textContent = profile.replies || 0;
    $('profileJoined').textContent = profile.joined || '';
  } else {
    $('profileName').textContent = username;
    $('profileBio').textContent = '';
    $('profileAvatar').src = avatarUrl(username);
    $('profileForumCount').textContent = '0';
    $('profileThreadCount').textContent = '0';
    $('profileReplyCount').textContent = '0';
    $('profileJoined').textContent = '';
  }

  // Show edit button only for own profile
  const editBtn = $('profileEditBtn');
  if (isOwnProfile) {
    editBtn.classList.remove('hidden');
  } else {
    editBtn.classList.add('hidden');
  }

  // Render profile activity tab
  renderProfileTab('activity', username);

  // Render badges
  renderProfileBadges(username);

  // Animate the stat counters
  setTimeout(() => {
    if (profile) {
      animateCounter($('profileForumCount'), profile.forums || 0);
      animateCounter($('profileThreadCount'), profile.threads || 0);
      animateCounter($('profileReplyCount'), profile.replies || 0);
    }
  }, 100);
}

/**
 * Composed renderProfileTab -- merges all monkey-patched layers:
 * Handles all 4 tabs: activity, threads, forums, badges
 */
export function renderProfileTab(tab, username) {
  const el = $('profileTabContent');

  if (tab === 'badges') {
    const earned = data.userBadges[username] || [];
    el.innerHTML = '<div class="badges-grid">' + data.badgeDefinitions.map(b => {
      const isEarned = earned.includes(b.id);
      return `
        <div class="badge-card ${isEarned ? '' : 'locked'}">
          <div class="badge-card-icon">${b.icon}</div>
          <div class="badge-card-name">${b.name}</div>
          <div class="badge-card-desc">${b.desc}</div>
          <div class="badge-card-status">${isEarned ? 'Earned' : 'Locked'}</div>
        </div>
      `;
    }).join('') + '</div>';
    return;
  }

  if (tab === 'activity') {
    el.innerHTML = data.activities
      .filter(a => !username || a.user === username)
      .map(a => `
        <div class="activity-item">
          <img src="${avatarUrl(a.seed)}" alt="">
          <div>
            <div class="activity-text">${a.text}</div>
            <div class="activity-time">${a.time}</div>
          </div>
        </div>
      `).join('');
  } else if (tab === 'threads') {
    const userThreads = Object.values(data.threads).flat().filter(t => t.author === username).slice(0, 5);
    if (userThreads.length === 0) {
      el.innerHTML = '<div class="empty-state"><div class="empty-icon">&#x1F4DD;</div><p>No threads yet</p></div>';
    } else {
      el.innerHTML = userThreads.map(t => `
        <div class="thread-item" data-thread="${t.id}" tabindex="0" role="button" style="cursor:pointer;">
          <img class="thread-avatar" src="${avatarUrl(t.id, 'shapes')}" alt="">
          <div class="thread-info">
            <div class="thread-title">${t.title}</div>
            <div class="thread-snippet">${t.snippet}</div>
          </div>
          <div class="thread-meta">
            <div class="thread-time">${t.time}</div>
            <div class="thread-replies">${plural(t.replies, 'reply')}</div>
          </div>
        </div>
      `).join('');
      // Bind click handlers for threads in profile tab
      el.querySelectorAll('.thread-item').forEach(item => {
        item.addEventListener('click', () => _showThread(item.dataset.thread));
      });
    }
  } else if (tab === 'forums') {
    el.innerHTML = data.forums.map(f => `
      <div class="forum-item" data-forum="${f.id}" style="border-left:none;padding:10px 0;cursor:pointer;" tabindex="0" role="button">
        <img src="${avatarUrl(f.seed, 'shapes')}" alt="">
        <div class="forum-item-info">
          <div class="forum-item-name">${f.name}</div>
          <div class="forum-item-count">${plural(f.members, 'member')}</div>
        </div>
      </div>
    `).join('');
    // Bind click handlers for forums in profile tab
    el.querySelectorAll('.forum-item').forEach(item => {
      item.addEventListener('click', () => _showForum(item.dataset.forum));
    });
  }
}

export function renderProfileBadges(username) {
  const el = $('profileBadges');
  if (!el) return;
  const badges = data.userBadges[username] || [];
  if (badges.length === 0) {
    el.innerHTML = '';
    return;
  }
  el.innerHTML = badges.map(id => {
    const b = data.badgeDefinitions.find(d => d.id === id);
    if (!b) return '';
    return `<span class="badge-chip ${b.class}"><span class="badge-chip-icon">${b.icon}</span>${b.name}</span>`;
  }).join('');
}

export function initProfile(deps) {
  _showView = deps.showView;
  _renderForumList = deps.renderForumList;
  _renderDmList = deps.renderDmList;
  _closeAllDropdowns = deps.closeAllDropdowns;
  _showThread = deps.showThread;
  _showForum = deps.showForum;
  _showSettings = deps.showSettings;

  // Profile tab click handlers
  document.querySelectorAll('.profile-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.profile-tab').forEach(t => {
        t.classList.remove('active');
        t.setAttribute('aria-selected', 'false');
      });
      tab.classList.add('active');
      tab.setAttribute('aria-selected', 'true');
      renderProfileTab(tab.dataset.ptab, _currentProfileKey);
    });
  });

  // Profile edit button handler
  $('profileEditBtn').addEventListener('click', () => _showSettings());
}
