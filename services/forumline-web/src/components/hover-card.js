import { avatarUrl } from '../lib/avatar.js';
import { $ } from '../lib/utils.js';
import * as data from '../state/data.js';

let _deps = {
  showProfile: () => {},
  showDm: () => {},
  showToast: () => {},
};

let hoverCardTimeout = null;
let hoverCardVisible = false;

export function showHoverCard(username, anchorEl) {
  const profile = data.profiles[username];
  if (!profile) return;

  const card = $('hoverCard');
  $('hoverCardAvatar').src = avatarUrl(profile.seed);
  $('hoverCardName').textContent = profile.name;
  $('hoverCardBio').textContent = profile.bio;
  $('hoverCardForums').textContent = profile.forums;
  $('hoverCardThreads').textContent = profile.threads;
  $('hoverCardReplies').textContent = profile.replies;

  const rect = anchorEl.getBoundingClientRect();
  const cardWidth = 280;
  const cardHeight = 260;

  let left = rect.left + rect.width / 2 - cardWidth / 2;
  let top = rect.bottom + 8;

  // Keep in viewport
  if (left < 8) left = 8;
  if (left + cardWidth > window.innerWidth - 8) left = window.innerWidth - cardWidth - 8;
  if (top + cardHeight > window.innerHeight - 8) top = rect.top - cardHeight - 8;

  card.style.left = left + 'px';
  card.style.top = top + 'px';
  card.classList.remove('hidden');
  hoverCardVisible = true;

  // Wire up buttons
  $('hoverCardViewProfile').onclick = () => {
    hideHoverCard();
    _deps.showProfile(username);
  };
  $('hoverCardDm').onclick = () => {
    hideHoverCard();
    const dm = data.dms.find(d => d.name === username);
    if (dm) {
      _deps.showDm(dm.id);
    } else {
      // Create a new DM conversation
      const newDm = {
        id: 'dm' + Date.now(),
        name: username,
        seed: data.profiles[username]?.seed || username,
        preview: '',
        unread: false,
        online: true,
      };
      data.dms.push(newDm);
      data.messages[newDm.id] = [];
      _deps.showDm(newDm.id);
      _deps.showToast(`Started conversation with ${username}`);
    }
  };
}

export function hideHoverCard() {
  $('hoverCard').classList.add('hidden');
  hoverCardVisible = false;
}

export function initHoverCard(deps) {
  _deps = { ..._deps, ...deps };

  // Listen for hover on post avatars and author names
  document.addEventListener('mouseover', e => {
    const avatar = e.target.closest('.post-avatar');
    const author = e.target.closest('.post-author');

    let username = null;
    let anchor = null;

    if (avatar) {
      const postItem = avatar.closest('.post-item');
      if (postItem) {
        const authorEl = postItem.querySelector('.post-author');
        if (authorEl) {
          username = authorEl.textContent.split(' ')[0].trim();
          anchor = avatar;
        }
      }
    } else if (author) {
      username = author.textContent.split(' ')[0].trim();
      anchor = author;
    }

    if (username && data.profiles[username]) {
      clearTimeout(hoverCardTimeout);
      hoverCardTimeout = setTimeout(() => showHoverCard(username, anchor), 400);
    }
  });

  document.addEventListener('mouseout', e => {
    const isLeavingAvatar = e.target.closest('.post-avatar') || e.target.closest('.post-author');
    if (isLeavingAvatar) {
      clearTimeout(hoverCardTimeout);
      hoverCardTimeout = setTimeout(() => {
        if (!$('hoverCard').matches(':hover')) {
          hideHoverCard();
        }
      }, 300);
    }
  });

  $('hoverCard')?.addEventListener('mouseleave', () => {
    hideHoverCard();
  });
}
