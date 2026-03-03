/**
 * SupabaseForumDataProvider — Supabase implementation of ForumDataProvider.
 *
 * This wraps all existing Supabase queries and mutations from the original
 * queries.ts and page components into a single provider class.
 */

import { supabase } from './supabase'
import type { ForumDataProvider } from './data-provider'
import type {
  Category,
  ChatChannel,
  ChatMessageWithAuthor,
  Notification,
  PostWithAuthor,
  Profile,
  ThreadWithAuthor,
  VoiceRoom,
} from '../types'

function fetchError(label: string, error: unknown): never {
  console.error(`[Forumline:Supabase] ${label} failed:`, error)
  throw error
}

export class SupabaseForumDataProvider implements ForumDataProvider {
  // ========================================================================
  // Reads
  // ========================================================================

  async getCategories(): Promise<Category[]> {
    const { data, error } = await supabase.from('categories').select('*').order('sort_order')
    if (error) fetchError('getCategories', error)
    return data || []
  }

  async getChannels(): Promise<ChatChannel[]> {
    const { data, error } = await supabase.from('chat_channels').select('*').order('name')
    if (error) fetchError('getChannels', error)
    return data || []
  }

  async getVoiceRooms(): Promise<VoiceRoom[]> {
    const { data, error } = await supabase.from('voice_rooms').select('*').order('name')
    if (error) fetchError('getVoiceRooms', error)
    return data || []
  }

  async getThreads(limit = 20): Promise<ThreadWithAuthor[]> {
    const { data, error } = await supabase
      .from('threads')
      .select(`*, author:profiles(*), category:categories(*)`)
      .order('is_pinned', { ascending: false })
      .order('last_post_at', { ascending: false })
      .limit(limit)
    if (error) fetchError('getThreads', error)
    return (data || []) as ThreadWithAuthor[]
  }

  async getThreadsByCategory(categorySlug: string): Promise<ThreadWithAuthor[]> {
    const { data: category, error: catError } = await supabase
      .from('categories')
      .select('id')
      .eq('slug', categorySlug)
      .single()

    if (catError) {
      console.error('[Forumline:Supabase] Failed to find category:', categorySlug, catError)
    }
    if (!category) return []

    const { data, error } = await supabase
      .from('threads')
      .select(`*, author:profiles(*), category:categories(*)`)
      .eq('category_id', category.id)
      .order('is_pinned', { ascending: false })
      .order('last_post_at', { ascending: false })
    if (error) fetchError('getThreadsByCategory', error)
    return (data || []) as ThreadWithAuthor[]
  }

  async getThread(threadId: string): Promise<ThreadWithAuthor | null> {
    const { data, error } = await supabase
      .from('threads')
      .select(`*, author:profiles(*), category:categories(*)`)
      .eq('id', threadId)
      .single()
    if (error) fetchError(`getThread(${threadId})`, error)
    return data as ThreadWithAuthor | null
  }

  async getPosts(threadId: string): Promise<PostWithAuthor[]> {
    const { data, error } = await supabase
      .from('posts')
      .select(`*, author:profiles(*)`)
      .eq('thread_id', threadId)
      .order('created_at', { ascending: true })
    if (error) fetchError(`getPosts(${threadId})`, error)
    return (data || []) as PostWithAuthor[]
  }

  async getCategory(slug: string): Promise<Category | null> {
    const { data, error } = await supabase
      .from('categories')
      .select('*')
      .eq('slug', slug)
      .single()
    if (error) fetchError(`getCategory(${slug})`, error)
    return data
  }

  async getProfile(userId: string): Promise<Profile | null> {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single()
    if (error) fetchError(`getProfile(${userId})`, error)
    return data
  }

  async getProfileByUsername(username: string): Promise<Profile | null> {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('username', username)
      .single()
    if (error) fetchError(`getProfileByUsername(${username})`, error)
    return data
  }

  async getChatMessages(channelSlug: string): Promise<ChatMessageWithAuthor[]> {
    const { data: channel, error: chanError } = await supabase
      .from('chat_channels')
      .select('id')
      .eq('slug', channelSlug)
      .single()

    if (chanError) {
      console.error('[Forumline:Supabase] Failed to find channel:', channelSlug, chanError)
    }
    if (!channel) return []

    const { data, error } = await supabase
      .from('chat_messages')
      .select(`*, author:profiles(*)`)
      .eq('channel_id', channel.id)
      .order('created_at', { ascending: true })
      .limit(100)
    if (error) fetchError('getChatMessages', error)
    return (data || []) as ChatMessageWithAuthor[]
  }

  async getBookmarksWithMeta(userId: string): Promise<Array<{
    id: string
    created_at: string
    thread: ThreadWithAuthor
  }>> {
    const { data, error } = await supabase
      .from('bookmarks')
      .select(`id, created_at, thread:threads(*, author:profiles(*), category:categories(*))`)
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
    if (error) fetchError('getBookmarksWithMeta', error)
    return (data?.map((b) => ({
      id: b.id,
      created_at: b.created_at,
      thread: b.thread as unknown as ThreadWithAuthor,
    })) || [])
  }

  async getBookmarks(userId: string): Promise<ThreadWithAuthor[]> {
    const { data, error } = await supabase
      .from('bookmarks')
      .select(`thread:threads(*, author:profiles(*), category:categories(*))`)
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
    if (error) fetchError('getBookmarks', error)
    return (data?.map((b: { thread: ThreadWithAuthor }) => b.thread) || []) as ThreadWithAuthor[]
  }

  async isBookmarked(userId: string, threadId: string): Promise<boolean> {
    const { data } = await supabase
      .from('bookmarks')
      .select('id')
      .eq('user_id', userId)
      .eq('thread_id', threadId)
      .maybeSingle()
    return !!data
  }

  async getUserThreads(userId: string): Promise<ThreadWithAuthor[]> {
    const { data, error } = await supabase
      .from('threads')
      .select(`*, author:profiles(*), category:categories(*)`)
      .eq('author_id', userId)
      .order('created_at', { ascending: false })
      .limit(10)
    if (error) fetchError('getUserThreads', error)
    return (data || []) as ThreadWithAuthor[]
  }

  async getUserPosts(userId: string): Promise<PostWithAuthor[]> {
    const { data, error } = await supabase
      .from('posts')
      .select(`*, author:profiles(*)`)
      .eq('author_id', userId)
      .order('created_at', { ascending: false })
      .limit(20)
    if (error) fetchError('getUserPosts', error)
    return (data || []) as PostWithAuthor[]
  }

  async searchThreads(query: string): Promise<ThreadWithAuthor[]> {
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
  }

  async searchPosts(query: string): Promise<PostWithAuthor[]> {
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
  }

  async getAdminStats(): Promise<{ totalUsers: number; totalThreads: number; totalPosts: number }> {
    const [usersRes, threadsRes, postsRes] = await Promise.all([
      supabase.from('profiles').select('*', { count: 'exact', head: true }),
      supabase.from('threads').select('*', { count: 'exact', head: true }),
      supabase.from('posts').select('*', { count: 'exact', head: true }),
    ])
    return {
      totalUsers: usersRes.count ?? 0,
      totalThreads: threadsRes.count ?? 0,
      totalPosts: postsRes.count ?? 0,
    }
  }

  async getAdminUsers(): Promise<Profile[]> {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50)
    if (error) fetchError('getAdminUsers', error)
    return data || []
  }

  async getNotifications(userId: string): Promise<Notification[]> {
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(20)
    if (error) fetchError('getNotifications', error)
    return data || []
  }

  async getDmMessages(userId: string, recipientId: string): Promise<Array<{
    id: string
    sender_id: string
    recipient_id: string
    content: string
    created_at: string
    read: boolean
  }>> {
    const { data, error } = await supabase
      .from('direct_messages')
      .select('*')
      .or(`and(sender_id.eq.${userId},recipient_id.eq.${recipientId}),and(sender_id.eq.${recipientId},recipient_id.eq.${userId})`)
      .order('created_at')
    if (error) fetchError('getDmMessages', error)
    return data || []
  }

  async getDmConversations(userId: string): Promise<Array<{
    recipientId: string
    recipientName: string
    recipientAvatarUrl: string | null
    lastMessage: string
    lastMessageTime: string
    unreadCount: number
  }>> {
    const { data, error } = await supabase
      .from('direct_messages')
      .select('*, sender:profiles!direct_messages_sender_id_fkey(*), recipient:profiles!direct_messages_recipient_id_fkey(*)')
      .or(`sender_id.eq.${userId},recipient_id.eq.${userId}`)
      .order('created_at', { ascending: false })

    if (error) fetchError('getDmConversations', error)
    if (!data) return []

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
  }

  // ========================================================================
  // Writes
  // ========================================================================

  async createThread(input: {
    category_id: string
    author_id: string
    title: string
    slug: string
    content?: string
    image_url?: string
  }): Promise<{ id: string } | null> {
    const { data, error } = await supabase
      .from('threads')
      .insert({
        category_id: input.category_id,
        author_id: input.author_id,
        title: input.title,
        slug: input.slug,
        content: input.content || null,
        image_url: input.image_url || null,
        post_count: 1,
        last_post_at: new Date().toISOString(),
      })
      .select('id')
      .single()
    if (error) fetchError('createThread', error)
    return data
  }

  async updateThread(threadId: string, updates: {
    image_url?: string
    last_post_at?: string
    post_count?: number
    is_pinned?: boolean
    is_locked?: boolean
  }): Promise<void> {
    const { error } = await supabase
      .from('threads')
      .update(updates)
      .eq('id', threadId)
    if (error) fetchError('updateThread', error)
  }

  async createPost(input: {
    thread_id: string
    author_id: string
    content: string
    reply_to_id?: string
  }): Promise<{ id: string } | null> {
    const { data, error } = await supabase
      .from('posts')
      .insert({
        thread_id: input.thread_id,
        author_id: input.author_id,
        content: input.content,
        reply_to_id: input.reply_to_id || null,
      })
      .select('id')
      .single()
    if (error) fetchError('createPost', error)
    return data
  }

  async sendChatMessage(input: {
    channel_id: string
    author_id: string
    content: string
  }): Promise<void> {
    const { error } = await supabase
      .from('chat_messages')
      .insert(input)
    if (error) fetchError('sendChatMessage', error)
  }

  async sendDm(input: {
    sender_id: string
    recipient_id: string
    content: string
  }): Promise<{ id: string } | null> {
    const { data, error } = await supabase
      .from('direct_messages')
      .insert(input)
      .select('id')
      .single()
    if (error) fetchError('sendDm', error)
    return data
  }

  async markDmRead(messageId: string): Promise<void> {
    const { error } = await supabase
      .from('direct_messages')
      .update({ read: true })
      .eq('id', messageId)
    if (error) fetchError('markDmRead', error)
  }

  async markDmsReadFrom(senderId: string, recipientId: string): Promise<void> {
    const { error } = await supabase
      .from('direct_messages')
      .update({ read: true })
      .eq('sender_id', senderId)
      .eq('recipient_id', recipientId)
    if (error) fetchError('markDmsReadFrom', error)
  }

  async addBookmark(userId: string, threadId: string): Promise<void> {
    const { error } = await supabase
      .from('bookmarks')
      .insert({ user_id: userId, thread_id: threadId })
    if (error) fetchError('addBookmark', error)
  }

  async removeBookmark(userId: string, threadId: string): Promise<void> {
    const { error } = await supabase
      .from('bookmarks')
      .delete()
      .eq('user_id', userId)
      .eq('thread_id', threadId)
    if (error) fetchError('removeBookmark', error)
  }

  async removeBookmarkById(bookmarkId: string): Promise<void> {
    const { error } = await supabase
      .from('bookmarks')
      .delete()
      .eq('id', bookmarkId)
    if (error) fetchError('removeBookmarkById', error)
  }

  async markNotificationRead(notificationId: string): Promise<void> {
    const { error } = await supabase
      .from('notifications')
      .update({ read: true })
      .eq('id', notificationId)
    if (error) fetchError('markNotificationRead', error)
  }

  async markAllNotificationsRead(userId: string): Promise<void> {
    const { error } = await supabase
      .from('notifications')
      .update({ read: true })
      .eq('user_id', userId)
      .eq('read', false)
    if (error) fetchError('markAllNotificationsRead', error)
  }

  async upsertProfile(userId: string, data: {
    username: string
    display_name?: string | null
    avatar_url?: string | null
  }): Promise<void> {
    const { error } = await supabase.from('profiles').upsert({
      id: userId,
      username: data.username,
      display_name: data.display_name || null,
      avatar_url: data.avatar_url || null,
    }, { onConflict: 'id' })
    if (error) fetchError('upsertProfile', error)
  }

  async updateProfile(userId: string, updates: {
    display_name?: string | null
    bio?: string | null
    website?: string | null
    avatar_url?: string | null
  }): Promise<void> {
    const { error } = await supabase
      .from('profiles')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', userId)
    if (error) fetchError('updateProfile', error)
  }

  async setVoicePresence(userId: string, roomSlug: string): Promise<void> {
    const { error } = await supabase
      .from('voice_presence')
      .upsert({
        user_id: userId,
        room_slug: roomSlug,
        joined_at: new Date().toISOString(),
      }, { onConflict: 'user_id' })
    if (error) fetchError('setVoicePresence', error)
  }

  async clearVoicePresence(userId: string): Promise<void> {
    const { error } = await supabase
      .from('voice_presence')
      .delete()
      .eq('user_id', userId)
    if (error) fetchError('clearVoicePresence', error)
  }
}
