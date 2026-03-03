/**
 * ForumDataProvider — Abstract data layer for Forumline forums.
 *
 * Decouples the app from any specific backend (Supabase, REST API, etc.).
 * Each forum implementation provides its own data provider.
 */

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

// ============================================================================
// Data Provider Interface
// ============================================================================

export interface ForumDataProvider {
  // --- Reads ---

  // Static data
  getCategories(): Promise<Category[]>
  getChannels(): Promise<ChatChannel[]>
  getVoiceRooms(): Promise<VoiceRoom[]>

  // Threads
  getThreads(limit?: number): Promise<ThreadWithAuthor[]>
  getThreadsByCategory(categorySlug: string): Promise<ThreadWithAuthor[]>
  getThread(threadId: string): Promise<ThreadWithAuthor | null>

  // Posts
  getPosts(threadId: string): Promise<PostWithAuthor[]>

  // Categories
  getCategory(slug: string): Promise<Category | null>

  // Profiles
  getProfile(userId: string): Promise<Profile | null>
  getProfileByUsername(username: string): Promise<Profile | null>

  // Chat
  getChatMessages(channelSlug: string): Promise<ChatMessageWithAuthor[]>

  // Bookmarks
  getBookmarksWithMeta(userId: string): Promise<Array<{
    id: string
    created_at: string
    thread: ThreadWithAuthor
  }>>
  getBookmarks(userId: string): Promise<ThreadWithAuthor[]>
  isBookmarked(userId: string, threadId: string): Promise<boolean>

  // User activity
  getUserThreads(userId: string): Promise<ThreadWithAuthor[]>
  getUserPosts(userId: string): Promise<PostWithAuthor[]>

  // Search
  searchThreads(query: string): Promise<ThreadWithAuthor[]>
  searchPosts(query: string): Promise<PostWithAuthor[]>

  // Admin
  getAdminStats(): Promise<{ totalUsers: number; totalThreads: number; totalPosts: number }>
  getAdminUsers(): Promise<Profile[]>

  // Notifications
  getNotifications(userId: string): Promise<Notification[]>

  // DMs
  getDmMessages(userId: string, recipientId: string): Promise<Array<{
    id: string
    sender_id: string
    recipient_id: string
    content: string
    created_at: string
    read: boolean
  }>>
  getDmConversations(userId: string): Promise<Array<{
    recipientId: string
    recipientName: string
    recipientAvatarUrl: string | null
    lastMessage: string
    lastMessageTime: string
    unreadCount: number
  }>>

  // --- Writes ---

  // Threads
  createThread(input: {
    category_id: string
    author_id: string
    title: string
    slug: string
    content?: string
    image_url?: string
  }): Promise<{ id: string } | null>
  updateThread(threadId: string, updates: {
    image_url?: string
    last_post_at?: string
    post_count?: number
    is_pinned?: boolean
    is_locked?: boolean
  }): Promise<void>

  // Posts
  createPost(input: {
    thread_id: string
    author_id: string
    content: string
    reply_to_id?: string
  }): Promise<{ id: string } | null>

  // Chat
  sendChatMessage(input: {
    channel_id: string
    author_id: string
    content: string
  }): Promise<void>

  // DMs
  sendDm(input: {
    sender_id: string
    recipient_id: string
    content: string
  }): Promise<{ id: string } | null>
  markDmRead(messageId: string): Promise<void>
  markDmsReadFrom(senderId: string, recipientId: string): Promise<void>

  // Bookmarks
  addBookmark(userId: string, threadId: string): Promise<void>
  removeBookmark(userId: string, threadId: string): Promise<void>
  removeBookmarkById(bookmarkId: string): Promise<void>

  // Notifications
  markNotificationRead(notificationId: string): Promise<void>
  markAllNotificationsRead(userId: string): Promise<void>

  // Profiles
  upsertProfile(userId: string, data: {
    username: string
    display_name?: string | null
    avatar_url?: string | null
  }): Promise<void>
  updateProfile(userId: string, updates: {
    display_name?: string | null
    bio?: string | null
    website?: string | null
    avatar_url?: string | null
  }): Promise<void>

  // Voice presence
  setVoicePresence(userId: string, roomSlug: string): Promise<void>
  clearVoicePresence(userId: string): Promise<void>
}

// ============================================================================
// Provider Registry
// ============================================================================

let _provider: ForumDataProvider | null = null

/** Set the active data provider (called once at app startup) */
export function setDataProvider(provider: ForumDataProvider): void {
  _provider = provider
}

/** Get the active data provider */
export function getDataProvider(): ForumDataProvider {
  if (!_provider) {
    throw new Error(
      'ForumDataProvider not initialized. Call setDataProvider() before using data operations.'
    )
  }
  return _provider
}
