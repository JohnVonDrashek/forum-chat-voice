/**
 * Centralized React Query configuration
 *
 * All query keys, fetchers, and options in one place.
 * This makes it easy to:
 * - Prefetch data on hover
 * - Invalidate related queries
 * - Share fetchers across components
 */

import { supabase } from './supabase'
import type {
  Category,
  ChatChannel,
  VoiceRoom,
  ThreadWithAuthor,
  PostWithAuthor,
  Profile,
  ChatMessageWithAuthor,
} from '../types'

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
}

// ============================================================================
// Fetchers - reusable across components
// ============================================================================

// Helper to log and rethrow fetcher errors
function fetchError(label: string, error: unknown): never {
  console.error(`[FCV:Query] ${label} failed:`, error)
  throw error
}

export const fetchers = {
  // Static data
  categories: async (): Promise<Category[]> => {
    console.log('[FCV:Query] Fetching categories...')
    const { data, error } = await supabase.from('categories').select('*').order('sort_order')
    if (error) fetchError('categories', error)
    console.log('[FCV:Query] Categories loaded:', data?.length)
    return data || []
  },

  channels: async (): Promise<ChatChannel[]> => {
    console.log('[FCV:Query] Fetching channels...')
    const { data, error } = await supabase.from('chat_channels').select('*').order('name')
    if (error) fetchError('channels', error)
    console.log('[FCV:Query] Channels loaded:', data?.length)
    return data || []
  },

  voiceRooms: async (): Promise<VoiceRoom[]> => {
    console.log('[FCV:Query] Fetching voice rooms...')
    const { data, error } = await supabase.from('voice_rooms').select('*').order('name')
    if (error) fetchError('voiceRooms', error)
    console.log('[FCV:Query] Voice rooms loaded:', data?.length)
    return data || []
  },

  // Threads
  threads: async (limit = 20): Promise<ThreadWithAuthor[]> => {
    console.log('[FCV:Query] Fetching threads, limit:', limit)
    const { data, error } = await supabase
      .from('threads')
      .select(`*, author:profiles(*), category:categories(*)`)
      .order('is_pinned', { ascending: false })
      .order('last_post_at', { ascending: false })
      .limit(limit)
    if (error) fetchError('threads', error)
    console.log('[FCV:Query] Threads loaded:', data?.length)
    return (data || []) as ThreadWithAuthor[]
  },

  threadsByCategory: async (categorySlug: string): Promise<ThreadWithAuthor[]> => {
    console.log('[FCV:Query] Fetching threads for category:', categorySlug)
    // First get the category by slug
    const { data: category, error: catError } = await supabase
      .from('categories')
      .select('id')
      .eq('slug', categorySlug)
      .single()

    if (catError) {
      console.error('[FCV:Query] Failed to find category:', categorySlug, catError)
    }
    if (!category) return []

    const { data, error } = await supabase
      .from('threads')
      .select(`*, author:profiles(*), category:categories(*)`)
      .eq('category_id', category.id)
      .order('is_pinned', { ascending: false })
      .order('last_post_at', { ascending: false })
    if (error) fetchError('threadsByCategory', error)
    return (data || []) as ThreadWithAuthor[]
  },

  thread: async (threadId: string): Promise<ThreadWithAuthor | null> => {
    const { data, error } = await supabase
      .from('threads')
      .select(`*, author:profiles(*), category:categories(*)`)
      .eq('id', threadId)
      .single()
    if (error) fetchError(`thread(${threadId})`, error)
    return data as ThreadWithAuthor | null
  },

  // Posts
  posts: async (threadId: string): Promise<PostWithAuthor[]> => {
    const { data, error } = await supabase
      .from('posts')
      .select(`*, author:profiles(*)`)
      .eq('thread_id', threadId)
      .order('created_at', { ascending: true })
    if (error) fetchError(`posts(${threadId})`, error)
    return (data || []) as PostWithAuthor[]
  },

  // Category
  category: async (slug: string): Promise<Category | null> => {
    const { data, error } = await supabase
      .from('categories')
      .select('*')
      .eq('slug', slug)
      .single()
    if (error) fetchError(`category(${slug})`, error)
    return data
  },

  // Profiles
  profile: async (userId: string): Promise<Profile | null> => {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single()
    if (error) fetchError(`profile(${userId})`, error)
    return data
  },

  profileByUsername: async (username: string): Promise<Profile | null> => {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('username', username)
      .single()
    if (error) fetchError(`profileByUsername(${username})`, error)
    return data
  },

  // Chat messages - fetch by channel slug
  chatMessagesBySlug: async (channelSlug: string): Promise<ChatMessageWithAuthor[]> => {
    console.log('[FCV:Query] Fetching chat messages for:', channelSlug)
    // First get the channel by slug
    const { data: channel, error: chanError } = await supabase
      .from('chat_channels')
      .select('id')
      .eq('slug', channelSlug)
      .single()

    if (chanError) {
      console.error('[FCV:Query] Failed to find channel:', channelSlug, chanError)
    }
    if (!channel) return []

    const { data, error } = await supabase
      .from('chat_messages')
      .select(`*, author:profiles(*)`)
      .eq('channel_id', channel.id)
      .order('created_at', { ascending: true })
      .limit(100)
    if (error) fetchError('chatMessagesBySlug', error)
    console.log('[FCV:Query] Chat messages loaded:', data?.length)
    return (data || []) as ChatMessageWithAuthor[]
  },

  // Bookmarks - returns full bookmark with thread data
  bookmarksWithMeta: async (userId: string): Promise<Array<{
    id: string
    created_at: string
    thread: ThreadWithAuthor
  }>> => {
    console.log('[FCV:Query] Fetching bookmarks for user:', userId)
    const { data, error } = await supabase
      .from('bookmarks')
      .select(`id, created_at, thread:threads(*, author:profiles(*), category:categories(*))`)
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
    if (error) fetchError('bookmarksWithMeta', error)
    return (data?.map((b) => ({
      id: b.id,
      created_at: b.created_at,
      thread: b.thread as unknown as ThreadWithAuthor,
    })) || [])
  },

  // Legacy - just thread list
  bookmarks: async (userId: string): Promise<ThreadWithAuthor[]> => {
    const { data, error } = await supabase
      .from('bookmarks')
      .select(`thread:threads(*, author:profiles(*), category:categories(*))`)
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
    if (error) fetchError('bookmarks', error)
    return (data?.map((b: { thread: ThreadWithAuthor }) => b.thread) || []) as ThreadWithAuthor[]
  },

  isBookmarked: async (userId: string, threadId: string): Promise<boolean> => {
    const { data } = await supabase
      .from('bookmarks')
      .select('id')
      .eq('user_id', userId)
      .eq('thread_id', threadId)
      .maybeSingle()
    return !!data
  },

  // Profile activity
  userThreads: async (userId: string): Promise<ThreadWithAuthor[]> => {
    const { data, error } = await supabase
      .from('threads')
      .select(`*, author:profiles(*), category:categories(*)`)
      .eq('author_id', userId)
      .order('created_at', { ascending: false })
      .limit(10)
    if (error) fetchError('userThreads', error)
    return (data || []) as ThreadWithAuthor[]
  },

  userPosts: async (userId: string): Promise<PostWithAuthor[]> => {
    const { data, error } = await supabase
      .from('posts')
      .select(`*, author:profiles(*)`)
      .eq('author_id', userId)
      .order('created_at', { ascending: false })
      .limit(20)
    if (error) fetchError('userPosts', error)
    return (data || []) as PostWithAuthor[]
  },

  // Search
  searchThreads: async (query: string): Promise<ThreadWithAuthor[]> => {
    if (!query.trim()) return []
    const pattern = `%${query}%`
    const { data, error } = await supabase
      .from('threads')
      .select('*, author:profiles(*), category:categories(*)')
      .ilike('title', pattern)
      .order('created_at', { ascending: false })
      .limit(20)
    if (error) fetchError('searchThreads', error)
    return (data || []) as ThreadWithAuthor[]
  },

  searchPosts: async (query: string): Promise<PostWithAuthor[]> => {
    if (!query.trim()) return []
    const pattern = `%${query}%`
    const { data, error } = await supabase
      .from('posts')
      .select('*, author:profiles(*)')
      .ilike('content', pattern)
      .order('created_at', { ascending: false })
      .limit(20)
    if (error) fetchError('searchPosts', error)
    return (data || []) as PostWithAuthor[]
  },

  // DM conversations list
  dmConversations: async (userId: string): Promise<Array<{
    recipientId: string
    recipientName: string
    recipientAvatarUrl: string | null
    lastMessage: string
    lastMessageTime: string
    unreadCount: number
  }>> => {
    console.log('[FCV:Query] Fetching DM conversations for:', userId)
    // Get all DMs involving this user
    const { data, error } = await supabase
      .from('direct_messages')
      .select('*, sender:profiles!direct_messages_sender_id_fkey(*), recipient:profiles!direct_messages_recipient_id_fkey(*)')
      .or(`sender_id.eq.${userId},recipient_id.eq.${userId}`)
      .order('created_at', { ascending: false })

    if (error) fetchError('dmConversations', error)
    if (!data) return []

    // Group by other user
    const convMap = new Map<string, {
      recipientId: string
      recipientName: string
      recipientAvatarUrl: string | null
      lastMessage: string
      lastMessageTime: string
      unreadCount: number
    }>()

    for (const dm of data) {
      const other: Profile = dm.sender_id === userId ? dm.recipient : dm.sender
      if (!convMap.has(other.id)) {
        convMap.set(other.id, {
          recipientId: other.id,
          recipientName: other.display_name || other.username,
          recipientAvatarUrl: other.avatar_url,
          lastMessage: dm.content,
          lastMessageTime: dm.created_at,
          unreadCount: 0,
        })
      }
    }

    // Count unreads
    const { data: unreads } = await supabase
      .from('direct_messages')
      .select('sender_id')
      .eq('recipient_id', userId)
      .eq('read', false)

    if (unreads) {
      for (const u of unreads) {
        const conv = convMap.get(u.sender_id)
        if (conv) conv.unreadCount++
      }
    }

    return Array.from(convMap.values())
  },
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
