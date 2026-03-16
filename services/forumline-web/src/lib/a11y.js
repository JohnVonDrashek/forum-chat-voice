// ========== ACCESSIBILITY ==========

export function protectDoubleClick(btn) {
  if (!btn) return;
  btn.addEventListener('click', (e) => {
    if (btn.dataset.submitting === 'true') {
      e.stopImmediatePropagation();
      e.preventDefault();
      return;
    }
    btn.dataset.submitting = 'true';
    setTimeout(() => { btn.dataset.submitting = 'false'; }, 1000);
  }, true);
}

export function initAccessibility() {
  const $ = id => document.getElementById(id);

  // --- ARIA-SELECTED UPDATES FOR TABS ---

  // Category pills
  document.querySelectorAll('.category-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('.category-pill').forEach(p => p.setAttribute('aria-selected', 'false'));
      pill.setAttribute('aria-selected', 'true');
    });
  });

  // Profile tabs
  document.querySelectorAll('.profile-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.profile-tab').forEach(t => t.setAttribute('aria-selected', 'false'));
      tab.setAttribute('aria-selected', 'true');
    });
  });

  // Login tabs
  document.querySelectorAll('.login-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.login-tab').forEach(t => t.setAttribute('aria-selected', 'false'));
      tab.setAttribute('aria-selected', 'true');
    });
  });

  // Settings nav
  document.querySelectorAll('.settings-nav-item[role="tab"]').forEach(item => {
    item.addEventListener('click', () => {
      document.querySelectorAll('.settings-nav-item[role="tab"]').forEach(i => i.setAttribute('aria-selected', 'false'));
      item.setAttribute('aria-selected', 'true');
    });
  });

  // Filter pills
  document.querySelectorAll('.filter-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('.filter-pill').forEach(p => p.setAttribute('aria-selected', 'false'));
      pill.setAttribute('aria-selected', 'true');
    });
  });

  // Density buttons aria-pressed
  document.querySelectorAll('.density-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.density-btn').forEach(b => b.setAttribute('aria-pressed', 'false'));
      btn.setAttribute('aria-pressed', 'true');
    });
  });

  // Banner swatch aria-checked
  document.querySelectorAll('.banner-swatch').forEach(swatch => {
    swatch.addEventListener('click', () => {
      document.querySelectorAll('.banner-swatch').forEach(s => s.setAttribute('aria-checked', 'false'));
      swatch.setAttribute('aria-checked', 'true');
    });
  });

  // Theme option aria-checked
  document.querySelectorAll('.theme-option').forEach(opt => {
    opt.addEventListener('click', () => {
      document.querySelectorAll('.theme-option').forEach(o => o.setAttribute('aria-checked', 'false'));
      opt.setAttribute('aria-checked', 'true');
    });
  });

  // --- EMOJI PICKER KEYBOARD NAVIGATION ---
  $('emojiGrid').addEventListener('keydown', (e) => {
    const emojis = Array.from($('emojiGrid').querySelectorAll('.emoji-pick'));
    const current = document.activeElement;
    const idx = emojis.indexOf(current);
    if (idx < 0) return;
    const cols = 7; // approximate grid columns
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

  // --- ONBOARDING KEYBOARD NAVIGATION ---
  $('onboardingOverlay').addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      $('onboardNext').click();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      $('onboardingOverlay').classList.add('hidden');
      localStorage.setItem('forumline-onboarded', 'true');
    }
  });

  // --- DOUBLE-CLICK PROTECTION ON FORM BUTTONS ---
  protectDoubleClick($('createForumSubmit'));
  protectDoubleClick($('composerSubmit'));
  protectDoubleClick($('replyBtn'));
  protectDoubleClick($('dmSendBtn'));

}
