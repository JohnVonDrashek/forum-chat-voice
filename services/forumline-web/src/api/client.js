// ========== FORUMLINE API CLIENT ==========
// HTTP client singleton — base module for all API calls.

let _accessToken = null;
let _userId = null;
let _baseUrl = '';

function configure({ baseUrl, accessToken, userId }) {
  if (baseUrl !== undefined) _baseUrl = baseUrl;
  if (accessToken !== undefined) _accessToken = accessToken;
  if (userId !== undefined) _userId = userId;
}

function getToken() { return _accessToken; }
function getUserId() { return _userId; }
function isAuthenticated() { return !!_accessToken; }

async function apiFetch(path, options = {}) {
  if (!_accessToken) throw new Error('Not authenticated');
  const { silent, ...fetchOpts } = options;
  try {
    const res = await fetch(`${_baseUrl}${path}`, {
      ...fetchOpts,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${_accessToken}`,
        ...fetchOpts.headers,
      },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `API error: ${res.status}`);
    }
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  } catch (err) {
    if (!silent) console.error('[ForumlineAPI]', err.message);
    throw err;
  }
}

function getConversations() { return apiFetch('/api/conversations'); }
function getConversation(id) { return apiFetch(`/api/conversations/${id}`); }

function getMessages(id, opts = {}) {
  const params = new URLSearchParams();
  if (opts.before) params.set('before', opts.before);
  if (opts.limit) params.set('limit', String(opts.limit));
  const qs = params.toString();
  return apiFetch(`/api/conversations/${id}/messages${qs ? '?' + qs : ''}`);
}

function sendMessage(id, content) {
  return apiFetch(`/api/conversations/${id}/messages`, {
    method: 'POST', body: JSON.stringify({ content }),
  });
}

function markRead(id) {
  return apiFetch(`/api/conversations/${id}/read`, { method: 'POST', silent: true });
}

function getOrCreateDM(userId) {
  return apiFetch('/api/conversations/dm', {
    method: 'POST', body: JSON.stringify({ userId }),
  });
}

function createGroupConversation(memberIds, name) {
  return apiFetch('/api/conversations', {
    method: 'POST', body: JSON.stringify({ memberIds, name }),
  });
}

function updateConversation(id, updates) {
  return apiFetch(`/api/conversations/${id}`, {
    method: 'PATCH', body: JSON.stringify(updates),
  });
}

function leaveConversation(id) {
  return apiFetch(`/api/conversations/${id}/leave`, { method: 'POST' });
}

function searchProfiles(query) {
  return apiFetch(`/api/profiles/search?q=${encodeURIComponent(query)}`);
}

function searchIdentity(query) {
  return apiFetch(`/api/identity/search?q=${encodeURIComponent(query)}`);
}

function getActivity() { return apiFetch('/api/activity'); }

function getNotifications() { return apiFetch('/api/notifications'); }

function getUnreadCount() { return apiFetch('/api/notifications/unread'); }

function markNotificationRead(id) {
  return apiFetch('/api/notifications/read', {
    method: 'POST', body: JSON.stringify({ id }),
  });
}

function markAllNotificationsRead() {
  return apiFetch('/api/notifications/read-all', { method: 'POST' });
}

function presenceHeartbeat() {
  return apiFetch('/api/presence/heartbeat', { method: 'POST', silent: true });
}

function getPresenceStatus(userIds) {
  if (!userIds.length) return Promise.resolve({});
  return apiFetch(`/api/presence/status?userIds=${userIds.join(',')}`);
}

export const ForumlineAPI = {
  configure, getToken, getUserId, isAuthenticated, apiFetch,
  getConversations, getConversation, getMessages, sendMessage, markRead,
  getOrCreateDM, createGroupConversation, updateConversation, leaveConversation,
  searchProfiles, searchIdentity, getActivity, presenceHeartbeat, getPresenceStatus,
  getNotifications, getUnreadCount, markNotificationRead, markAllNotificationsRead,
};
