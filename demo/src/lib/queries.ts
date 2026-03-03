/**
 * Centralized React Query configuration
 *
 * All query keys, fetchers, and options in one place.
 * Fetchers delegate to the active ForumDataProvider.
 */

import { getDataProvider } from './data-provider'

// ============================================================================
// Query Keys - centralized for easy invalidation
// ============================================================================

export const queryKeys = {
  // Static data (rarely changes)
  categories: ['categories'] as const,
  channels: ['channels'] as const,
  voiceRooms: ['voiceRooms'] as const,

  // Threads
  threads: (limit?: number) => ['threads', { limit }] as const,
  threadsByCategory: (categorySlug: string) => ['threads', 'category', categorySlug] as const,
  thread: (threadId: string) => ['thread', threadId] as const,

  // Posts
  posts: (threadId: string) => ['posts', threadId] as const,

  // Profiles
  profile: (userId: string) => ['profile', userId] as const,
  profileByUsername: (username: string) => ['profile', 'username', username] as const,

  // Chat
  chatMessages: (channelSlug: string) => ['chat', channelSlug] as const,

  // DM
  dmConversations: (userId: string) => ['dm', 'conversations', userId] as const,
  dmMessages: (recipientId: string) => ['dm', 'messages', recipientId] as const,

  // Category
  category: (slug: string) => ['category', slug] as const,

  // Search
  search: (query: string, filter: string) => ['search', query, filter] as const,
  searchThreads: (query: string) => ['search', 'threads', query] as const,
  searchPosts: (query: string) => ['search', 'posts', query] as const,

  // Bookmarks
  bookmarks: (userId: string) => ['bookmarks', userId] as const,
  isBookmarked: (userId: string, threadId: string) => ['bookmark', userId, threadId] as const,

  // Profile activity
  userThreads: (userId: string) => ['userThreads', userId] as const,
  userPosts: (userId: string) => ['userPosts', userId] as const,

  // DM conversations
  dmConversationsList: (userId: string) => ['dm', 'list', userId] as const,

  // Admin
  adminStats: ['admin', 'stats'] as const,
  adminUsers: ['admin', 'users'] as const,

  // Notifications
  notifications: (userId: string) => ['notifications', userId] as const,

  // Hub DMs
  hubDmConversations: ['hub', 'dm', 'conversations'] as const,
  hubDmMessages: (recipientId: string) => ['hub', 'dm', 'messages', recipientId] as const,
  hubProfileSearch: (query: string) => ['hub', 'profiles', 'search', query] as const,
}

// ============================================================================
// Fetchers - delegate to the active ForumDataProvider
// ============================================================================

export const fetchers = {
  // Static data
  categories: () => getDataProvider().getCategories(),
  channels: () => getDataProvider().getChannels(),
  voiceRooms: () => getDataProvider().getVoiceRooms(),

  // Threads
  threads: (limit = 20) => getDataProvider().getThreads(limit),
  threadsByCategory: (categorySlug: string) => getDataProvider().getThreadsByCategory(categorySlug),
  thread: (threadId: string) => getDataProvider().getThread(threadId),

  // Posts
  posts: (threadId: string) => getDataProvider().getPosts(threadId),

  // Category
  category: (slug: string) => getDataProvider().getCategory(slug),

  // Profiles
  profile: (userId: string) => getDataProvider().getProfile(userId),
  profileByUsername: (username: string) => getDataProvider().getProfileByUsername(username),

  // Chat messages
  chatMessagesBySlug: (channelSlug: string) => getDataProvider().getChatMessages(channelSlug),

  // Bookmarks
  bookmarksWithMeta: (userId: string) => getDataProvider().getBookmarksWithMeta(userId),
  bookmarks: (userId: string) => getDataProvider().getBookmarks(userId),
  isBookmarked: (userId: string, threadId: string) => getDataProvider().isBookmarked(userId, threadId),

  // Profile activity
  userThreads: (userId: string) => getDataProvider().getUserThreads(userId),
  userPosts: (userId: string) => getDataProvider().getUserPosts(userId),

  // Search
  searchThreads: (query: string) => getDataProvider().searchThreads(query),
  searchPosts: (query: string) => getDataProvider().searchPosts(query),

  // Admin
  adminStats: () => getDataProvider().getAdminStats(),
  adminUsers: () => getDataProvider().getAdminUsers(),

  // Notifications
  notifications: (userId: string) => getDataProvider().getNotifications(userId),

  // DM messages
  dmMessages: (userId: string, recipientId: string) => getDataProvider().getDmMessages(userId, recipientId),

  // DM conversations list
  dmConversations: (userId: string) => getDataProvider().getDmConversations(userId),
}

// ============================================================================
// Query Options - stale times for different data types
// ============================================================================

export const queryOptions = {
  // Static data - rarely changes, cache for a long time
  static: {
    staleTime: 1000 * 60 * 60, // 1 hour
    gcTime: 1000 * 60 * 60 * 2, // 2 hours (garbage collection)
  },

  // Threads - moderate freshness needed
  threads: {
    staleTime: 1000 * 30, // 30 seconds
    gcTime: 1000 * 60 * 5, // 5 minutes
  },

  // Posts - need fresher data due to real-time
  posts: {
    staleTime: 1000 * 15, // 15 seconds
    gcTime: 1000 * 60 * 2, // 2 minutes
  },

  // Chat/DM - very fresh, but real-time handles most updates
  realtime: {
    staleTime: 1000 * 10, // 10 seconds
    gcTime: 1000 * 60, // 1 minute
  },

  // Profiles - moderate
  profiles: {
    staleTime: 1000 * 60 * 5, // 5 minutes
    gcTime: 1000 * 60 * 15, // 15 minutes
  },

  // Search - cache for quick navigation back
  search: {
    staleTime: 1000 * 30, // 30 seconds
    gcTime: 1000 * 60 * 2, // 2 minutes
  },
}
