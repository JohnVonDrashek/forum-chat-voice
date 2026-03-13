// ========== APPLICATION STATE STORE ==========
// Single mutable state object — importers can read and write properties directly.

const store = {
  currentView: 'home',
  currentForum: null,
  currentThread: null,
  currentDm: null,
  currentSort: 'default',
  currentFilter: 'all',
  threadDensity: 'comfortable',
  searchSelectedIdx: -1,
  onboardStep: 0,
};

export default store;
