import { $, plural } from '../lib/utils.js';
import { escapeHtml } from '../lib/markdown.js';
import store from '../state/store.js';
import * as data from '../state/data.js';
import { ForumlineAPI } from '../api/client.js';
import { ForumDiscoveryAPI } from '../api/forum-discovery.js';
import { ForumStore } from '../api/forum-store.js';

let _showView, _renderForumList, _renderDmList, _showToast;

// Discovery state for real API integration
let discoveryQuery = '';
let discoveryActiveTag = null;
let discoveryTags = [];
let discoveryForumsApi = null; // null = not loaded, [] = empty results
let discoveryRecommended = [];
let discoveryLoading = false;
let discoverySearchTimeout = null;

function renderDiscoverCard(f, showJoined) {
  const isJoined = ForumStore.forums.some(rf => rf.domain === f.domain);
  const iconUrl = f.icon_url
    ? (f.icon_url.startsWith('/') ? (f.web_base || '') + f.icon_url : f.icon_url)
    : `https://api.dicebear.com/7.x/shapes/svg?seed=${f.domain || f.seed || 'unknown'}`;
  const banner = f.screenshot_url
    ? `background-image:url(${f.screenshot_url});background-size:cover;background-position:center;`
    : `background: linear-gradient(135deg, #667eea 0%, #764ba2 100%)`;

  return `
    <div class="discover-card" data-domain="${f.domain || ''}">
      <div class="discover-card-banner" style="${banner}">
        <img class="discover-card-avatar" src="${iconUrl}" alt="" onerror="this.style.display='none'">
      </div>
      <div class="discover-card-body">
        <div class="discover-card-name">${escapeHtml(f.name)}</div>
        <div class="discover-card-desc">${escapeHtml(f.description || f.desc || '')}</div>
        <div class="discover-card-footer">
          <span class="discover-card-members">${f.member_count ? plural(f.member_count, 'member') : (f.members ? plural(f.members, 'member') : '')}${f.shared_member_count ? ' · ' + f.shared_member_count + ' in common' : ''}</span>
          ${isJoined
            ? '<button class="aqua-btn join-btn joined" disabled>Joined</button>'
            : `<button class="aqua-btn join-btn" data-join-domain="${f.domain || ''}">Join</button>`}
        </div>
        ${(f.tags && f.tags.length > 0) ? '<div style="margin-top:4px">' + f.tags.slice(0, 3).map(t => '<span class="discover-tag-pill" style="font-size:10px;padding:2px 6px;pointer-events:none">' + escapeHtml(t) + '</span>').join(' ') + '</div>' : ''}
      </div>
    </div>
  `;
}

export function showDiscover() {
  store.currentView = 'discover';
  store.currentForum = null;
  store.currentThread = null;
  store.currentDm = null;
  _showView('discoverView');
  renderDiscover();
  _renderForumList();
  _renderDmList();

  // Fetch real discovery data from API
  void fetchDiscoveryTags();
  void fetchDiscoveryForums();
  void fetchDiscoveryRecommended();
}

export function renderDiscover() {
  const el = $('discoverGrid');

  // If we have real API data, render it; otherwise fall back to mock
  if (discoveryForumsApi !== null) {
    let html = '';

    // Recommended section
    if (discoveryRecommended.length > 0) {
      html += '<div class="discover-recommended"><h2>Recommended for you</h2><p>Popular with people in your forums</p></div>';
      html += discoveryRecommended.map(f => renderDiscoverCard(f, true)).join('');
      html += '<div style="margin:16px 0;border-top:1px solid #ddd"></div>';
    }

    // Main results
    if (discoveryLoading) {
      html += '<div style="text-align:center;padding:40px;color:#999">Loading...</div>';
    } else if (discoveryForumsApi.length === 0) {
      html += '<div style="text-align:center;padding:40px;color:#999">' + (discoveryQuery ? 'No forums found' : 'No forums available yet') + '</div>';
    } else {
      html += discoveryForumsApi.map(f => renderDiscoverCard(f)).join('');
    }

    el.innerHTML = html;
  } else {
    // Fallback to mock data
    el.innerHTML = data.discoverForums.map(f => renderDiscoverCard({
      name: f.name, description: f.desc, domain: f.seed,
      member_count: f.members, seed: f.seed,
    })).join('');
  }

  // Bind join buttons
  el.querySelectorAll('.join-btn[data-join-domain]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const domain = btn.dataset.joinDomain;
      if (!domain || btn.disabled) return;
      btn.disabled = true;
      btn.textContent = 'Joining...';
      try {
        await ForumStore.addForum(domain);
        btn.textContent = 'Joined';
        btn.classList.add('joined');
        _showToast('Forum joined!');
        // Refresh discovery
        void fetchDiscoveryForums();
        void fetchDiscoveryRecommended();
      } catch (err) {
        btn.disabled = false;
        btn.textContent = 'Join';
        _showToast('Failed to join: ' + err.message);
      }
    });
  });

  // Render tags row if we have real tags
  renderDiscoverTags();
}

function renderDiscoverTags() {
  // Insert or update tags row after the discover header
  let tagsRow = document.getElementById('discoverTagsRow');
  if (!tagsRow) {
    tagsRow = document.createElement('div');
    tagsRow.id = 'discoverTagsRow';
    tagsRow.className = 'discover-tags-row';
    const categories = document.querySelector('#discoverView .discover-categories');
    if (categories) {
      categories.after(tagsRow);
    }
  }

  if (discoveryTags.length === 0) {
    tagsRow.innerHTML = '';
    return;
  }

  tagsRow.innerHTML = discoveryTags.map(tag =>
    `<button class="discover-tag-pill ${discoveryActiveTag === tag ? 'active' : ''}" data-tag="${tag}">${escapeHtml(tag)}</button>`
  ).join('');

  tagsRow.querySelectorAll('.discover-tag-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      discoveryActiveTag = discoveryActiveTag === pill.dataset.tag ? null : pill.dataset.tag;
      if (discoverySearchTimeout) clearTimeout(discoverySearchTimeout);
      void fetchDiscoveryForums();
      renderDiscoverTags();
    });
  });
}

async function fetchDiscoveryForums() {
  discoveryLoading = true;
  renderDiscover();
  const results = await ForumDiscoveryAPI.searchForums({
    query: discoveryQuery, tag: discoveryActiveTag || '',
  });
  if (results !== null) {
    discoveryForumsApi = results;
  }
  discoveryLoading = false;
  renderDiscover();
}

async function fetchDiscoveryRecommended() {
  const token = ForumlineAPI.isAuthenticated() ? ForumlineAPI.getToken() : null;
  discoveryRecommended = await ForumDiscoveryAPI.fetchRecommended(token);
  renderDiscover();
}

async function fetchDiscoveryTags() {
  discoveryTags = await ForumDiscoveryAPI.fetchTags();
  renderDiscoverTags();
}

export function initDiscover(deps) {
  _showView = deps.showView;
  _renderForumList = deps.renderForumList;
  _renderDmList = deps.renderDmList;
  _showToast = deps.showToast;

  // Discover search input
  const searchInput = $('discoverSearchInput');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      discoveryQuery = e.target.value.trim();
      if (discoverySearchTimeout) clearTimeout(discoverySearchTimeout);
      discoverySearchTimeout = setTimeout(() => void fetchDiscoveryForums(), 300);
    });
  }

  // Category pills as tag filters
  document.querySelectorAll('#discoverView .category-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      const text = pill.textContent.trim();
      if (text === 'All') {
        discoveryActiveTag = null;
      } else {
        discoveryActiveTag = discoveryActiveTag === text ? null : text;
      }
      if (discoverySearchTimeout) clearTimeout(discoverySearchTimeout);
      void fetchDiscoveryForums();
    });
  });

  // Join button click handler (event delegation for mock data fallback)
  document.addEventListener('click', (e) => {
    const joinBtn = e.target.closest('.join-btn');
    if (joinBtn && !joinBtn.classList.contains('joined') && !joinBtn.disabled && !joinBtn.dataset.joinDomain) {
      joinBtn.classList.add('joined');
      joinBtn.textContent = 'Joined';
      _showToast('Forum joined!');
    }
  });
}
