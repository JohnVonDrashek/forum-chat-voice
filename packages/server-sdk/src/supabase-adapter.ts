/**
 * ForumlineSupabaseAdapter — Adapter for Supabase-based forums.
 *
 * Bridges Supabase data models to Forumline protocol types.
 */

import type {
  ForumlineIdentity,
  ForumNotification,
  ForumNotificationType,
} from '@forumline/protocol'

export interface SupabaseAdapterConfig {
  /** The forum's domain (for notifications) */
  domain: string
}

export class ForumlineSupabaseAdapter {
  private domain: string

  constructor(config: SupabaseAdapterConfig) {
    this.domain = config.domain
  }

  /** Convert a Supabase profile to a ForumlineIdentity */
  profileToIdentity(profile: {
    id: string
    username: string
    display_name: string | null
    avatar_url: string | null
    bio?: string | null
  }): ForumlineIdentity {
    return {
      forumline_id: profile.id,
      username: profile.username,
      display_name: profile.display_name || profile.username,
      avatar_url: profile.avatar_url || '',
      bio: profile.bio || undefined,
    }
  }

  /** Convert a Supabase notification to a ForumNotification */
  notificationToProtocol(notification: {
    id: string
    type: string
    title: string
    message: string
    link: string | null
    read: boolean
    created_at: string
  }): ForumNotification {
    return {
      id: notification.id,
      type: notification.type as ForumNotificationType,
      title: notification.title,
      body: notification.message,
      link: notification.link || '/',
      read: notification.read,
      timestamp: notification.created_at,
      forum_domain: this.domain,
    }
  }

  /** Convert a Supabase notification row to unread counts */
  computeUnreadCounts(notifications: Array<{
    type: string
    read: boolean
  }>, unreadDmCount: number): { notifications: number; chat_mentions: number; dms: number } {
    let notifCount = 0
    let chatMentions = 0

    for (const n of notifications) {
      if (n.read) continue
      if (n.type === 'chat_mention') {
        chatMentions++
      } else {
        notifCount++
      }
    }

    return {
      notifications: notifCount,
      chat_mentions: chatMentions,
      dms: unreadDmCount,
    }
  }
}
