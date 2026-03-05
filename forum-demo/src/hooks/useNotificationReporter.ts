/**
 * useNotificationReporter — Forwards new notifications to the parent hub via postMessage.
 *
 * Only active when the forum is embedded in an iframe.
 * Subscribes to Supabase Realtime on the notifications table and sends
 * each new notification to the parent frame as a `forumline:notification` message.
 */

import { useEffect } from 'react'
import type { ForumToHubMessage } from '@johnvondrashek/forumline-protocol'
import type { ForumNotification } from '@johnvondrashek/forumline-protocol'
import { supabase } from '../lib/supabase'

export function useNotificationReporter(userId: string | null) {
  const isEmbedded = window.parent !== window

  useEffect(() => {
    if (!isEmbedded || !userId) return

    const channel = supabase
      .channel('notification-reporter')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const row = payload.new as {
            id: string
            type: string
            title: string
            body: string
            created_at: string
            read: boolean
            link: string
          }

          const notification: ForumNotification = {
            id: row.id,
            type: row.type as ForumNotification['type'],
            title: row.title,
            body: row.body,
            timestamp: row.created_at,
            read: row.read,
            link: row.link || '',
            forum_domain: window.location.hostname,
          }

          const msg: ForumToHubMessage = { type: 'forumline:notification', notification }
          window.parent.postMessage(msg, '*')
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [isEmbedded, userId])
}
