import { $ } from '../lib/utils.js';

const emojiList = [
  '&#x1F44D;','&#x1F44E;','&#x2764;','&#x1F602;','&#x1F622;','&#x1F60E;',
  '&#x1F389;','&#x1F525;','&#x1F4A1;','&#x1F64F;','&#x1F44F;','&#x1F914;',
  '&#x1F4AF;','&#x2705;','&#x1F4F1;','&#x1F3B5;','&#x1F680;','&#x2B50;',
  '&#x1F440;','&#x1F48E;','&#x26A1;'
];

let emojiTargetPost = null;

export function renderEmojiPicker() {
  const grid = $('emojiGrid');
  if (!grid) return;

  grid.innerHTML = emojiList.map(e =>
    `<button class="emoji-pick" data-emoji="${e}">${e}</button>`
  ).join('');

  grid.querySelectorAll('.emoji-pick').forEach(btn => {
    btn.addEventListener('click', () => {
      if (emojiTargetPost !== null) {
        addReactionToPost(emojiTargetPost, btn.dataset.emoji);
      }
      $('emojiPicker').classList.add('hidden');
    });
  });
}

export function addReactionToPost(postIndex, emoji) {
  const postItems = $('postsList')?.querySelectorAll('.post-item');
  if (!postItems || !postItems[postIndex]) return;
  const footer = postItems[postIndex].querySelector('.post-footer');
  if (!footer) return;

  // Check if this emoji already exists
  const existing = footer.querySelector(`.reaction-btn[data-emoji="${emoji}"]`);
  if (existing) {
    if (!existing.classList.contains('active')) {
      existing.classList.add('active');
      const c = existing.querySelector('.reaction-count');
      c.textContent = parseInt(c.textContent) + 1;
    }
    return;
  }

  const addBtn = footer.querySelector('.add-reaction-btn');
  const newReaction = document.createElement('button');
  newReaction.className = 'reaction-btn active';
  newReaction.dataset.emoji = emoji;
  newReaction.innerHTML = `<span class="reaction-emoji">${emoji}</span><span class="reaction-count">1</span>`;
  if (addBtn) footer.insertBefore(newReaction, addBtn);
  else footer.appendChild(newReaction);

  newReaction.addEventListener('click', () => {
    newReaction.classList.toggle('active');
    const c = newReaction.querySelector('.reaction-count');
    let count = parseInt(c.textContent);
    c.textContent = newReaction.classList.contains('active') ? count + 1 : Math.max(0, count - 1);
    const em = newReaction.querySelector('.reaction-emoji');
    em.style.transform = 'scale(1.4)';
    setTimeout(() => em.style.transform = '', 200);
  });
}

export function initEmojiPicker() {
  renderEmojiPicker();

  // Event delegation for add-reaction buttons
  document.addEventListener('click', (e) => {
    const addBtn = e.target.closest('.add-reaction-btn');
    if (addBtn) {
      e.stopPropagation();
      emojiTargetPost = parseInt(addBtn.dataset.post);
      const picker = $('emojiPicker');
      const rect = addBtn.getBoundingClientRect();
      picker.style.left = Math.min(rect.left, window.innerWidth - 280) + 'px';
      picker.style.top = (rect.top - 200) + 'px';
      picker.classList.remove('hidden');
      return;
    }
    if (!e.target.closest('#emojiPicker')) {
      $('emojiPicker').classList.add('hidden');
    }
  });

  // Keyboard navigation in emoji grid
  $('emojiGrid')?.addEventListener('keydown', (e) => {
    const emojis = Array.from($('emojiGrid').querySelectorAll('.emoji-pick'));
    const current = document.activeElement;
    const idx = emojis.indexOf(current);
    if (idx < 0) return;
    const cols = 7;
    let next = -1;
    if (e.key === 'ArrowRight') next = Math.min(idx + 1, emojis.length - 1);
    else if (e.key === 'ArrowLeft') next = Math.max(idx - 1, 0);
    else if (e.key === 'ArrowDown') next = Math.min(idx + cols, emojis.length - 1);
    else if (e.key === 'ArrowUp') next = Math.max(idx - cols, 0);
    if (next >= 0) {
      e.preventDefault();
      emojis[next].focus();
    }
  });
}
