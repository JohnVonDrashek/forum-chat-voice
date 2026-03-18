// ========== KEYBOARD SHORTCUTS ==========

export function initKeyboardShortcuts(deps) {
  const {
    openSearch,
    closeSearch,
    closeLightbox,
    closeAllDropdowns,
    _hideHoverCard,
    _showForum,
    showHome,
    stopVoiceSpeakingAnimation,
    $,
    getCurrentView,
    getCurrentForum,
  } = deps;

  document.addEventListener('keydown', e => {
    // Cmd+K or Ctrl+K -> open search
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      if ($('searchModal').classList.contains('hidden')) {
        openSearch();
      } else {
        closeSearch();
      }
      return;
    }

    // Escape -> close modals/go back
    if (e.key === 'Escape') {
      if (!$('lightbox').classList.contains('hidden')) {
        closeLightbox();
        return;
      }
      if (!$('searchModal').classList.contains('hidden')) {
        closeSearch();
        return;
      }
      if (!$('emojiPicker').classList.contains('hidden')) {
        $('emojiPicker').classList.add('hidden');
        return;
      }
      if (!$('statusModal').classList.contains('hidden')) {
        $('statusModal').classList.add('hidden');
        return;
      }
      if (!$('voiceOverlay').classList.contains('hidden')) {
        $('voiceOverlay').classList.add('hidden');
        stopVoiceSpeakingAnimation();
        return;
      }
      if (!$('memberPanel').classList.contains('hidden')) {
        $('memberPanel').classList.add('hidden');
        return;
      }
      if (!$('notifDropdown').classList.contains('hidden')) {
        closeAllDropdowns();
        return;
      }
      if (!$('userDropdown').classList.contains('hidden')) {
        closeAllDropdowns();
        return;
      }
      // Go back in navigation
      const currentView = getCurrentView();
      const currentForum = getCurrentForum();
      if (currentView === 'thread' && currentForum) {
        _showForum(currentForum);
        return;
      }
      if (currentView === 'newThread' && currentForum) {
        _showForum(currentForum);
        return;
      }
      if (currentView !== 'home') {
        showHome();
      }
    }
  });
}
