import { useEffect } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { isTauri, getTauriNotification } from './tauri'

/**
 * Listens to Supabase Realtime for new DMs and sends native notifications
 * when the window is not focused. Uses Tauri notifications in the desktop
 * app and falls back to browser Notification API on the web.
 */
export function useNativeNotifications(
  user: { id: string } | null,
  supabaseClient: SupabaseClient,
) {
  useEffect(() => {
    if (!user) return

    const enabled = localStorage.getItem('nativeNotifications') !== 'false'
    if (!enabled) return

    const sub = supabaseClient
      .channel('native-notifications')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'direct_messages',
          filter: `recipient_id=eq.${user.id}`,
        },
        async (payload) => {
          // Only notify when the window is not focused
          if (document.hasFocus()) return

          const msg = payload.new as {
            content?: string
            sender_id?: string
          }
          const title = 'New Direct Message'
          const body = msg.content
            ? msg.content.slice(0, 100)
            : 'You have a new message'

          if (isTauri()) {
            try {
              const { sendNotification, isPermissionGranted, requestPermission } =
                await getTauriNotification()
              let permitted = await isPermissionGranted()
              if (!permitted) {
                const result = await requestPermission()
                permitted = result === 'granted'
              }
              if (permitted) {
                sendNotification({ title, body })
              }
            } catch (err) {
              console.error('[FLD:Notifications] Tauri notification error:', err)
            }
          } else {
            // Browser fallback
            if ('Notification' in window) {
              if (Notification.permission === 'default') {
                await Notification.requestPermission()
              }
              if (Notification.permission === 'granted') {
                new Notification(title, { body })
              }
            }
          }
        }
      )
      .subscribe()

    return () => {
      sub.unsubscribe()
    }
  }, [user, supabaseClient])
}
