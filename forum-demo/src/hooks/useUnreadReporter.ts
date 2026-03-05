/**
 * useUnreadReporter — Reports unread counts to the parent hub via postMessage.
 *
 * Only active when the forum is embedded in an iframe (i.e. running inside the hub).
 * Polls /api/forumline/unread every 30s and also listens for Supabase Realtime
 * notification inserts for instant updates.
 */

import { useEffect, useRef, useCallback } from 'react'
import type { ForumToHubMessage, HubToForumMessage } from '@johnvondrashek/forumline-protocol'
import { supabase } from '../lib/supabase'

const POLL_INTERVAL = 30_000

export function useUnreadReporter(userId: string | null) {
  const parentOriginRef = useRef<string | null>(null)
  const isEmbedded = window.parent !== window

  const sendUnreadCounts = useCallback(async () => {
    if (!isEmbedded || !userId) return

    try {
      const res = await fetch('/api/forumline/unread', {
        headers: { Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}` },
      })
      if (!res.ok) return

      const counts = await res.json()
      const msg: ForumToHubMessage = { type: 'forumline:unread_counts', counts }
      const targetOrigin = parentOriginRef.current || '*'
      window.parent.postMessage(msg, targetOrigin)
    } catch {
      // Non-critical — will retry on next poll
    }
  }, [isEmbedded, userId])

  useEffect(() => {
    if (!isEmbedded || !userId) return

    // Listen for request_unread_counts from parent
    const handleMessage = (event: MessageEvent) => {
      const msg = event.data as HubToForumMessage
      if (msg?.type === 'forumline:request_unread_counts') {
        parentOriginRef.current = event.origin
        sendUnreadCounts()
      }
    }
    window.addEventListener('message', handleMessage)

    // Poll unread counts periodically
    sendUnreadCounts()
    const intervalId = setInterval(sendUnreadCounts, POLL_INTERVAL)

    // Subscribe to Realtime notification inserts for instant updates
    const channel = supabase
      .channel('unread-reporter')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${userId}`,
        },
        () => sendUnreadCounts(),
      )
      .subscribe()

    return () => {
      window.removeEventListener('message', handleMessage)
      clearInterval(intervalId)
      supabase.removeChannel(channel)
    }
  }, [isEmbedded, userId, sendUnreadCounts])
}
