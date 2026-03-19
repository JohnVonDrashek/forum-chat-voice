/*
 * Forum API Client
 *
 * Generated-types-powered client using openapi-fetch against the forum engine's OpenAPI spec.
 * Auth tokens are injected automatically via middleware — callers never touch headers.
 */

import createClient from 'openapi-fetch';
import { getAccessToken } from './auth.js';

/** @type {import('openapi-fetch').Client<import('./forum-api.gen.js').paths>} */
const client = createClient({ baseUrl: '' });

client.use({
  async onRequest({ request }) {
    const token = await getAccessToken();
    if (token) request.headers.set('Authorization', `Bearer ${token}`);
    return request;
  },
});

async function unwrap(promise) {
  const { data, error, response } = await promise;
  if (error !== undefined || data === undefined) {
    const msg = error?.error ?? `API error: ${response.status}`;
    throw new Error(msg);
  }
  return data;
}

function silentNull(promise) {
  return promise.catch(e => {
    console.error('[API] fetch failed:', e);
    return null;
  });
}

export const api = {
  // --- Reads ---
  getCategories: () => unwrap(client.GET('/api/categories')),
  getChannels: () => unwrap(client.GET('/api/channels')),
  getVoiceRooms: () => unwrap(client.GET('/api/voice-rooms')),
  getThreads: (limit = 20) =>
    unwrap(client.GET('/api/threads', { params: { query: { limit } } })),
  getThreadsByCategory: slug =>
    unwrap(client.GET('/api/categories/{slug}/threads', { params: { path: { slug } } })),
  getThread: id =>
    silentNull(unwrap(client.GET('/api/threads/{id}', { params: { path: { id } } }))),
  getPosts: threadId =>
    unwrap(client.GET('/api/threads/{id}/posts', { params: { path: { id: threadId } } })),
  getCategory: slug =>
    silentNull(unwrap(client.GET('/api/categories/{slug}', { params: { path: { slug } } }))),
  getProfile: id =>
    silentNull(unwrap(client.GET('/api/profiles/{id}', { params: { path: { id } } }))),
  getProfileByUsername: username =>
    silentNull(
      unwrap(
        client.GET('/api/profiles/by-username/{username}', { params: { path: { username } } }),
      ),
    ),
  getChatMessages: slug =>
    unwrap(client.GET('/api/channels/{slug}/messages', { params: { path: { slug } } })),
  getBookmarksWithMeta: () => unwrap(client.GET('/api/bookmarks')),
  isBookmarked: threadId =>
    unwrap(
      client.GET('/api/bookmarks/{threadId}/status', { params: { path: { threadId } } }),
    ).then(r => r.bookmarked),
  getUserThreads: userId =>
    unwrap(client.GET('/api/users/{id}/threads', { params: { path: { id: userId } } })),
  getUserPosts: userId =>
    unwrap(client.GET('/api/users/{id}/posts', { params: { path: { id: userId } } })),
  searchThreads: q =>
    q.trim()
      ? unwrap(client.GET('/api/search/threads', { params: { query: { q } } }))
      : Promise.resolve([]),
  searchPosts: q =>
    q.trim()
      ? unwrap(client.GET('/api/search/posts', { params: { query: { q } } }))
      : Promise.resolve([]),
  getAdminStats: () => unwrap(client.GET('/api/admin/stats')),
  getAdminUsers: () => unwrap(client.GET('/api/admin/users')),
  getNotifications: () => unwrap(client.GET('/api/notifications')),
  getChannelFollows: () =>
    unwrap(client.GET('/api/channel-follows')).catch(e => {
      console.error('[API] channel follows fetch failed:', e);
      return [];
    }),
  getNotificationPreferences: () => unwrap(client.GET('/api/notification-preferences')),

  // --- Writes ---
  createThread: input => unwrap(client.POST('/api/threads', { body: input })),
  updateThread: (id, updates) =>
    unwrap(client.PATCH('/api/threads/{id}', { params: { path: { id } }, body: updates })),
  createPost: input => unwrap(client.POST('/api/posts', { body: input })),
  sendChatMessage: input =>
    unwrap(
      client.POST('/api/channels/_by-id/{id}/messages', {
        params: { path: { id: input.channel_id } },
        body: { content: input.content },
      }),
    ),
  addBookmark: threadId =>
    unwrap(client.POST('/api/bookmarks', { body: { thread_id: threadId } })),
  removeBookmark: threadId =>
    unwrap(client.DELETE('/api/bookmarks/{threadId}', { params: { path: { threadId } } })),
  removeBookmarkById: id =>
    unwrap(client.DELETE('/api/bookmarks/by-id/{id}', { params: { path: { id } } })),
  markNotificationRead: id =>
    unwrap(client.POST('/api/forumline/notifications/read', { body: { id } })),
  markAllNotificationsRead: () =>
    unwrap(client.POST('/api/notifications/read-all')),
  upsertProfile: (userId, data) =>
    unwrap(client.PUT('/api/profiles/{id}', { params: { path: { id: userId } }, body: data })),
  updateProfile: (userId, updates) =>
    unwrap(
      client.PUT('/api/profiles/{id}', { params: { path: { id: userId } }, body: updates }),
    ),
  setVoicePresence: roomSlug =>
    unwrap(client.PUT('/api/voice-presence', { body: { room_slug: roomSlug } })),
  clearVoicePresence: () => unwrap(client.DELETE('/api/voice-presence')),

  // --- Channel follows ---
  followCategory: categoryId =>
    unwrap(client.POST('/api/channel-follows', { body: { category_id: categoryId } })),
  unfollowCategory: categoryId =>
    unwrap(
      client.DELETE('/api/channel-follows', {
        body: { category_id: categoryId },
      }),
    ),

  // --- Notification preferences ---
  updateNotificationPreference: (category, enabled) =>
    unwrap(
      client.PUT('/api/notification-preferences', { body: { category, enabled } }),
    ),
};
