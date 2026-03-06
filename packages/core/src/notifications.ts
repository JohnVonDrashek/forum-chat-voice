import type { SupabaseClient } from '@supabase/supabase-js'
import { isTauri, getTauriNotification } from './tauri.js'

interface NativeNotificationOptions {
  table?: string
  filterColumn?: string
}

/**
 * Listens to Supabase Realtime for new DMs and sends native notifications
 * when the window is not focused. Returns a cleanup function.
 */
export function setupNativeNotifications(
  user: { id: string },
  supabaseClient: SupabaseClient,
  options?: NativeNotificationOptions,
): () => void {
  const table = options?.table || 'direct_messages'
  const filterColumn = options?.filterColumn || 'recipient_id'

  const enabled = localStorage.getItem('nativeNotifications') !== 'false'
  if (!enabled) return () => {}

  const sub = supabaseClient
    .channel(`native-notifications-${table}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table,
        filter: `${filterColumn}=eq.${user.id}`,
      },
      async (payload) => {
        if (document.visibilityState === 'visible') return

        const msg = payload.new as { content?: string; sender_id?: string }
        const title = 'New Direct Message'
        const body = msg.content ? msg.content.slice(0, 100) : 'You have a new message'

        if (isTauri()) {
          try {
            const { sendNotification, isPermissionGranted, requestPermission } = await getTauriNotification()
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
        } else if ('Notification' in window) {
          if (Notification.permission === 'default') {
            await Notification.requestPermission()
          }
          if (Notification.permission === 'granted') {
            new Notification(title, { body })
          }
        }
      },
    )
    .subscribe()

  return () => { sub.unsubscribe() }
}
