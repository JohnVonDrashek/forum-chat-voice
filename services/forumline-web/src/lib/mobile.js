// ========== MOBILE SUPPORT ==========

export function isMobile() {
  return window.innerWidth <= 640;
}

export function initMobile(navFunctions) {
  const { $, showHome, showForum, showThread, showDm, showDiscover } = navFunctions;

  const hamburger = $('hamburger');
  const sidebar = $('sidebar');
  const backdrop = $('sidebarBackdrop');

  // --- Sidebar open/close/toggle ---
  function openSidebar() {
    sidebar.classList.add('open');
    backdrop.classList.remove('hidden');
    backdrop.classList.add('visible');
    hamburger.classList.add('open');
  }

  function closeSidebar() {
    sidebar.classList.remove('open');
    backdrop.classList.add('hidden');
    backdrop.classList.remove('visible');
    hamburger.classList.remove('open');
  }

  function toggleSidebar() {
    if (sidebar.classList.contains('open')) {
      closeSidebar();
    } else {
      openSidebar();
    }
  }

  // --- Hamburger event listener ---
  hamburger.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleSidebar();
  });

  // --- Backdrop click handler ---
  backdrop.addEventListener('click', closeSidebar);

  // --- Tab bar ---
  function updateTabBar(activeTab) {
    document.querySelectorAll('.tab-item').forEach(t => {
      t.classList.toggle('active', t.dataset.tab === activeTab);
    });
  }

  document.querySelectorAll('.tab-item').forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;
      switch (target) {
        case 'home':
          showHome();
          break;
        case 'forums':
          // Open sidebar to show forum list
          if (isMobile()) {
            openSidebar();
            updateTabBar('forums');
          }
          break;
        case 'discover':
          showDiscover();
          break;
        case 'messages':
          // Open sidebar to show DM list
          if (isMobile()) {
            openSidebar();
            updateTabBar('messages');
          }
          break;
      }
    });
  });

  // Prevent body scroll when sidebar is open on mobile
  sidebar.addEventListener('touchmove', (e) => e.stopPropagation(), { passive: true });

  // --- Visual viewport resize handler ---
  if ('visualViewport' in window) {
    window.visualViewport.addEventListener('resize', () => {
      document.documentElement.style.setProperty(
        '--vh',
        `${window.visualViewport.height * 0.01}px`
      );
    });
  }

  // --- Touch/swipe handlers ---
  let touchStartX = 0;
  let touchStartY = 0;

  document.addEventListener('touchstart', (e) => {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  }, { passive: true });

  document.addEventListener('touchend', (e) => {
    if (!isMobile()) return;
    const deltaX = e.changedTouches[0].clientX - touchStartX;
    const deltaY = e.changedTouches[0].clientY - touchStartY;

    // Swipe right from left edge to open
    if (touchStartX < 30 && deltaX > 60 && Math.abs(deltaY) < 80) {
      openSidebar();
    }

    // Swipe left to close
    if (sidebar.classList.contains('open') && deltaX < -60 && Math.abs(deltaY) < 80) {
      closeSidebar();
    }
  }, { passive: true });

  // Return helpers so navigation wrappers can use them
  return { closeSidebar, openSidebar, updateTabBar, isMobile };
}
