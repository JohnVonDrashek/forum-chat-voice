import { avatarUrl } from '../lib/avatar.js';
import { escapeHtml } from '../lib/markdown.js';
import { $, plural } from '../lib/utils.js';
import * as data from '../state/data.js';
import store from '../state/store.js';

let _deps = {
  showForum: () => {},
  showThread: () => {},
  showProfile: () => {},
  showDiscover: () => {},
  showCreateForum: () => {},
  showNewThread: () => {},
  showSettings: () => {},
  showHome: () => {},
  showToast: () => {},
  renderVoiceParticipants: () => {},
  setTheme: () => {},
  closeAllDropdowns: () => {},
  hideHoverCard: () => {},
};

let searchSelectedIdx = -1;

function getCommands() {
  return [
    { icon: '&#x2795;', name: 'Create Forum', action: () => _deps.showCreateForum() },
    {
      icon: '&#x1F4DD;',
      name: 'New Thread',
      action: () => {
        if (store.currentForum) _deps.showNewThread();
        else _deps.showToast('Open a forum first');
      },
      shortcut: '',
    },
    { icon: '&#x2699;', name: 'Settings', action: () => _deps.showSettings(), shortcut: '' },
    { icon: '&#x1F464;', name: 'My Profile', action: () => _deps.showProfile('me') },
    { icon: '&#x1F30D;', name: 'Discover Forums', action: () => _deps.showDiscover() },
    {
      icon: '&#x1F3A4;',
      name: 'Join Voice Room',
      action: () => {
        $('voiceOverlay').classList.remove('hidden');
        _deps.renderVoiceParticipants();
      },
    },
    {
      icon: '&#x1F319;',
      name: 'Toggle Dark Mode',
      action: () => {
        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        _deps.setTheme(isDark ? 'light' : 'dark');
      },
      shortcut: '',
    },
    { icon: '&#x1F3E0;', name: 'Go Home', action: () => _deps.showHome(), shortcut: 'Esc' },
  ];
}

function highlightMatch(text, query) {
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return escapeHtml(text);
  return (
    escapeHtml(text.substring(0, idx)) +
    '<mark>' +
    escapeHtml(text.substring(idx, idx + query.length)) +
    '</mark>' +
    escapeHtml(text.substring(idx + query.length))
  );
}

export function openSearch() {
  $('searchModal').classList.remove('hidden');
  const input = $('searchModalInput');
  input.value = '';
  input.focus();
  $('searchModalResults').innerHTML =
    '<div class="search-modal-hint">Type to search across all forums, threads, and people...</div>';
  _deps.hideHoverCard();
  _deps.closeAllDropdowns();
  $('emojiPicker').classList.add('hidden');
}

export function closeSearch() {
  $('searchModal').classList.add('hidden');
}

export function bindSearchClicks() {
  const commands = getCommands();

  $('searchModalResults')
    .querySelectorAll('.search-result-item')
    .forEach(item => {
      item.addEventListener('click', () => {
        const action = item.dataset.action;
        const id = item.dataset.id;
        closeSearch();
        if (action === 'forum') _deps.showForum(id);
        else if (action === 'thread') _deps.showThread(id);
        else if (action === 'profile') _deps.showProfile(id);
        else if (action === 'discover') _deps.showDiscover();
      });
    });

  $('searchModalResults')
    .querySelectorAll('.search-command-item')
    .forEach(item => {
      item.addEventListener('click', () => {
        const idx = parseInt(item.dataset.cmd);
        closeSearch();
        commands[idx].action();
      });
    });
}

function handleSearchInput(e) {
  const query = e.target.value.trim().toLowerCase();
  const commands = getCommands();
  searchSelectedIdx = -1;

  if (!query) {
    let html =
      '<div class="search-result-group"><div class="search-result-label">Commands — type &gt; for actions</div>';
    html += commands
      .slice(0, 5)
      .map(
        (c, i) => `
      <div class="search-command-item" data-cmd="${i}">
        <div class="search-command-icon">${c.icon}</div>
        <span class="search-command-name">${c.name}</span>
        ${c.shortcut ? `<span class="search-command-shortcut"><kbd>${c.shortcut}</kbd></span>` : ''}
      </div>
    `,
      )
      .join('');
    html += '</div>';
    $('searchModalResults').innerHTML = html;
    bindSearchClicks();
    return;
  }

  // Command mode with >
  if (query.startsWith('>')) {
    const cmdQuery = query.substring(1).trim();
    const filtered = cmdQuery
      ? commands.filter(c => c.name.toLowerCase().includes(cmdQuery))
      : commands;
    let html = '<div class="search-result-group"><div class="search-result-label">Actions</div>';
    html += filtered
      .map(
        (c, i) => `
      <div class="search-command-item" data-cmd="${commands.indexOf(c)}">
        <div class="search-command-icon">${c.icon}</div>
        <span class="search-command-name">${cmdQuery ? highlightMatch(c.name, cmdQuery) : c.name}</span>
        ${c.shortcut ? `<span class="search-command-shortcut"><kbd>${c.shortcut}</kbd></span>` : ''}
      </div>
    `,
      )
      .join('');
    html += '</div>';
    if (!filtered.length) html = '<div class="search-no-results"><p>No matching commands</p></div>';
    $('searchModalResults').innerHTML = html;
    bindSearchClicks();
    return;
  }

  let html = '';
  const forums = data.forums;
  const threads = data.threads;
  const profiles = data.profiles;
  // Search forums
  const matchedForums = forums.filter(f => f.name.toLowerCase().includes(query));
  if (matchedForums.length) {
    html += '<div class="search-result-group"><div class="search-result-label">Forums</div>';
    html += matchedForums
      .map(
        f => `
      <div class="search-result-item" data-action="forum" data-id="${f.id}">
        <img src="${avatarUrl(f.seed, 'shapes')}" alt="">
        <div>
          <div class="search-result-name">${highlightMatch(f.name, query)}</div>
          <div class="search-result-meta">${plural(f.members, 'member')}</div>
        </div>
      </div>
    `,
      )
      .join('');
    html += '</div>';
  }

  // Search threads
  const allThreads = Object.entries(threads).flatMap(([fid, ts]) =>
    ts.map(t => ({ ...t, forumId: fid })),
  );
  const matchedThreads = allThreads
    .filter(t => t.title.toLowerCase().includes(query) || t.snippet.toLowerCase().includes(query))
    .slice(0, 5);
  if (matchedThreads.length) {
    html += '<div class="search-result-group"><div class="search-result-label">Threads</div>';
    html += matchedThreads
      .map(t => {
        const forum = forums.find(f => f.id === t.forumId);
        return `
        <div class="search-result-item" data-action="thread" data-id="${t.id}">
          <img src="${avatarUrl(t.seed)}" class="round" alt="">
          <div>
            <div class="search-result-name">${highlightMatch(t.title, query)}</div>
            <div class="search-result-meta">in ${forum?.name || 'Unknown'} · ${plural(t.replies, 'reply')}</div>
          </div>
        </div>
      `;
      })
      .join('');
    html += '</div>';
  }

  // Search people
  const matchedPeople = Object.values(profiles).filter(p => p.name.toLowerCase().includes(query));
  if (matchedPeople.length) {
    html += '<div class="search-result-group"><div class="search-result-label">People</div>';
    html += matchedPeople
      .map(
        p => `
      <div class="search-result-item" data-action="profile" data-id="${p.name}">
        <img src="${avatarUrl(p.seed)}" class="round" alt="">
        <div>
          <div class="search-result-name">${highlightMatch(p.name, query)}</div>
          <div class="search-result-meta">${p.bio.substring(0, 50)}...</div>
        </div>
      </div>
    `,
      )
      .join('');
    html += '</div>';
  }

  if (!html) {
    const safeQuery = query
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
    html =
      '<div class="search-no-results"><div class="empty-icon">&#x1F50D;</div><p>No results for "' +
      safeQuery +
      '"</p></div>';
  }

  $('searchModalResults').innerHTML = html;
  bindSearchClicks();
}

function handleSearchKeydown(e) {
  const items = $('searchModalResults').querySelectorAll(
    '.search-result-item, .search-command-item',
  );
  if (!items.length) return;

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    searchSelectedIdx = Math.min(searchSelectedIdx + 1, items.length - 1);
    items.forEach((el, i) => el.classList.toggle('selected', i === searchSelectedIdx));
    items[searchSelectedIdx]?.scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    searchSelectedIdx = Math.max(searchSelectedIdx - 1, 0);
    items.forEach((el, i) => el.classList.toggle('selected', i === searchSelectedIdx));
    items[searchSelectedIdx]?.scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'Enter' && searchSelectedIdx >= 0) {
    e.preventDefault();
    items[searchSelectedIdx]?.click();
  }
}

export function initSearch(deps) {
  _deps = { ..._deps, ...deps };

  $('globalSearch')?.addEventListener('click', openSearch);
  $('searchModalBackdrop')?.addEventListener('click', closeSearch);
  $('searchEscBtn')?.addEventListener('click', closeSearch);
  $('searchModalInput')?.addEventListener('input', handleSearchInput);
  $('searchModalInput')?.addEventListener('keydown', handleSearchKeydown);
}
