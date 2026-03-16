import { $ } from '../lib/utils.js';
import { avatarUrl } from '../lib/avatar.js';
import store from '../state/store.js';
import * as data from '../state/data.js';

let _deps = {
  showProfile: () => {},
};

export function renderMemberList(members) {
  $('memberList').innerHTML = members.map(m => `
    <div class="member-item" data-name="${m.name}" role="listitem" tabindex="0" aria-label="${m.name}, ${m.role}, ${m.online ? 'online' : 'offline'}">
      <img src="${avatarUrl(m.seed)}" alt="" onerror="this.style.display='none'">
      <div class="member-item-info">
        <div class="member-item-name">${m.name}</div>
        <div class="member-item-role">${m.role}</div>
      </div>
      <div class="member-online-indicator ${m.online ? 'online' : 'offline'}" aria-hidden="true"></div>
    </div>
  `).join('');

  $('memberList').querySelectorAll('.member-item').forEach(item => {
    item.addEventListener('click', () => {
      const name = item.dataset.name;
      if (data.profiles[name]) {
        $('memberPanel').classList.add('hidden');
        _deps.showProfile(name);
      }
    });
  });
}

export function renderMemberPanel(forumId) {
  const members = data.forumMembers[forumId] || [];
  const forum = data.forums.find(f => f.id === forumId);
  $('memberCount').textContent = forum ? forum.members : members.length;

  // Sort: online first, then by role
  const roleOrder = { Owner: 0, Moderator: 1, Member: 2 };
  const sorted = [...members].sort((a, b) => {
    if (a.online !== b.online) return b.online ? 1 : -1;
    return (roleOrder[a.role] || 2) - (roleOrder[b.role] || 2);
  });

  renderMemberList(sorted);
}

export function initMemberPanel(deps) {
  _deps = { ..._deps, ...deps };

  // Members button click handler
  $('membersBtn')?.addEventListener('click', () => {
    const panel = $('memberPanel');
    if (panel.classList.contains('hidden')) {
      panel.classList.remove('hidden');
      renderMemberPanel(store.currentForum);
    } else {
      panel.classList.add('hidden');
    }
  });

  // Member panel close handler
  $('memberPanelClose')?.addEventListener('click', () => {
    $('memberPanel').classList.add('hidden');
  });

  // Member search input handler
  $('memberSearch')?.addEventListener('input', (e) => {
    const query = e.target.value.trim().toLowerCase();
    const currentForum = store.currentForum;
    const members = data.forumMembers[currentForum] || [];
    const filtered = query ? members.filter(m => m.name.toLowerCase().includes(query)) : members;
    renderMemberList(filtered);
  });
}
