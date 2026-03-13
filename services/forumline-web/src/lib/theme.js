// ========== DARK MODE / THEME SWITCHER ==========

export function setTheme(theme) {
  if (theme === 'light') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', theme);
  }
  localStorage.setItem('forumline-theme', theme);
}

// Load saved theme on module init
const savedTheme = localStorage.getItem('forumline-theme');
if (savedTheme) setTheme(savedTheme);

// Wire up theme picker clicks
export function initThemePicker() {
  document.querySelectorAll('.theme-option').forEach(opt => {
    opt.addEventListener('click', () => {
      document.querySelectorAll('.theme-option').forEach(o => o.classList.remove('active'));
      opt.classList.add('active');
      setTheme(opt.dataset.theme);
    });
  });
}
