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

  // Bookmarks
  bookmarks: (userId: string) => ['bookmarks', userId] as const,
  isBookmarked: (userId: string, threadId: string) => ['bookmark', userId, threadId] as const,
}

// ============================================================================
// Fetchers - reusable across components
// ============================================================================

export const fetchers = {
  // Static data
  categories: async (): Promise<Category[]> => {
    const { data } = await supabase.from('categories').select('*').order('sort_order')
    return data || []
  },

  channels: async (): Promise<ChatChannel[]> => {
    const { data } = await supabase.from('chat_channels').select('*').order('name')
    return data || []
  },

  voiceRooms: async (): Promise<VoiceRoom[]> => {
    const { data } = await supabase.from('voice_rooms').select('*').order('name')
    return data || []
  },

  // Threads
  threads: async (limit = 20): Promise<ThreadWithAuthor[]> => {
    const { data } = await supabase
      .from('threads')
      .select(`*, author:profiles(*), category:categories(*)`)
      .order('is_pinned', { ascending: false })
      .order('last_post_at', { ascending: false })
      .limit(limit)
    return (data || []) as ThreadWithAuthor[]
  },

  threadsByCategory: async (categorySlug: string): Promise<ThreadWithAuthor[]> => {
    // First get the category by slug
    const { data: category } = await supabase
      .from('categories')
      .select('id')
      .eq('slug', categorySlug)
      .single()

    if (!category) return []

    const { data } = await supabase
      .from('threads')
      .select(`*, author:profiles(*), category:categories(*)`)
      .eq('category_id', category.id)
      .order('is_pinned', { ascending: false })
      .order('last_post_at', { ascending: false })
    return (data || []) as ThreadWithAuthor[]
  },

  thread: async (threadId: string): Promise<ThreadWithAuthor | null> => {
    const { data } = await supabase
      .from('threads')
      .select(`*, author:profiles(*), category:categories(*)`)
      .eq('id', threadId)
      .single()
    return data as ThreadWithAuthor | null
  },

  // Posts
  posts: async (threadId: string): Promise<PostWithAuthor[]> => {
    const { data } = await supabase
      .from('posts')
      .select(`*, author:profiles(*)`)
      .eq('thread_id', threadId)
      .order('created_at', { ascending: true })
    return (data || []) as PostWithAuthor[]
  },

  // Category
  category: async (slug: string): Promise<Category | null> => {
    const { data } = await supabase
      .from('categories')
      .select('*')
      .eq('slug', slug)
      .single()
    return data
  },

  // Profiles
  profile: async (userId: string): Promise<Profile | null> => {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single()
    return data
  },

  profileByUsername: async (username: string): Promise<Profile | null> => {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('username', username)
      .single()
    return data
  },

  // Chat messages - fetch by channel slug
  chatMessagesBySlug: async (channelSlug: string): Promise<ChatMessageWithAuthor[]> => {
    // First get the channel by slug
    const { data: channel } = await supabase
      .from('chat_channels')
      .select('id')
      .eq('slug', channelSlug)
      .single()

    if (!channel) return []

    const { data } = await supabase
      .from('chat_messages')
      .select(`*, author:profiles(*)`)
      .eq('channel_id', channel.id)
      .order('created_at', { ascending: true })
      .limit(100)
    return (data || []) as ChatMessageWithAuthor[]
  },

  // Bookmarks
  bookmarks: async (userId: string): Promise<ThreadWithAuthor[]> => {
    const { data } = await supabase
      .from('bookmarks')
      .select(`thread:threads(*, author:profiles(*), category:categories(*))`)
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
    // Extract threads from the nested structure
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
}
