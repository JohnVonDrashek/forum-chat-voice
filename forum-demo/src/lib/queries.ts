/**
 * Centralized React Query configuration
 *
 * All query keys, fetchers, and options in one place.
 * Fetchers delegate to the active ForumDataProvider.
 */

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

  // Category
  category: (slug: string) => ['category', slug] as const,

  // Search
  searchThreads: (query: string) => ['search', 'threads', query] as const,
  searchPosts: (query: string) => ['search', 'posts', query] as const,

  // Bookmarks
  bookmarks: (userId: string) => ['bookmarks', userId] as const,
  isBookmarked: (userId: string, threadId: string) => ['bookmark', userId, threadId] as const,

  // Profile activity
  userThreads: (userId: string) => ['userThreads', userId] as const,
  userPosts: (userId: string) => ['userPosts', userId] as const,

  // Admin
  adminStats: ['admin', 'stats'] as const,
  adminUsers: ['admin', 'users'] as const,

  // Notifications
  notifications: (userId: string) => ['notifications', userId] as const,

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

  // Chat - very fresh, but real-time handles most updates
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
