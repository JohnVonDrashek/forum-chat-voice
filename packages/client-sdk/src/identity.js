// ========== IDENTITY / PROFILE API ==========
// Profile CRUD, search, heartbeat, and batch presence status.

import { ForumlineAPI } from './client.js';

export const Identity = {
  getProfile() {
    return ForumlineAPI.apiFetch('/api/identity');
  },

  updateProfile(data) {
    return ForumlineAPI.apiFetch('/api/identity', { method: 'PUT', body: JSON.stringify(data) });
  },

  deleteAccount() {
    return ForumlineAPI.apiFetch('/api/identity', { method: 'DELETE' });
  },

  searchProfiles(q) {
    return ForumlineAPI.apiFetch('/api/identity/search?q=' + encodeURIComponent(q));
  },

  heartbeat() {
    return ForumlineAPI.apiFetch('/api/identity/heartbeat', { method: 'POST', silent: true });
  },

  batchPresenceStatus(userIds) {
    if (!userIds || !userIds.length) return Promise.resolve({});
    return ForumlineAPI.apiFetch('/api/identity/status', {
      method: 'POST',
      body: JSON.stringify({ user_ids: userIds.slice(0, 200) }),
      silent: true,
    });
  },
};
