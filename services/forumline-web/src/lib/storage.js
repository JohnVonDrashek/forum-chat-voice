// ========== SAFE LOCALSTORAGE WRAPPER ==========

// Override localStorage calls to be safe when disabled (e.g. private browsing, storage quota exceeded)
export function initSafeStorage() {
  const _setItem = localStorage.setItem.bind(localStorage);
  const _getItem = localStorage.getItem.bind(localStorage);
  localStorage.setItem = function (key, value) {
    try {
      _setItem(key, value);
    } catch (e) {
      console.warn('localStorage unavailable:', e.message);
    }
  };
  localStorage.getItem = function (key) {
    try {
      return _getItem(key);
    } catch (e) {
      console.warn('localStorage unavailable:', e.message);
      return null;
    }
  };
}
