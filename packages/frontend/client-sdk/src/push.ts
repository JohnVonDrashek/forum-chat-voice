/**
 * @module push
 *
 * Web Push notification support via service workers and VAPID.
 * Registers the service worker, subscribes to push with the server's VAPID key,
 * and routes notification clicks back to the app.
 *
 * @example
 * ```ts
 * await PushNotifications.registerServiceWorker((data) => {
 *   ForumStore.switchForum(data.forum, data.path);
 * });
 * await PushNotifications.subscribe();
 * ```
 */

import { ForumlineAPI } from './client.js';
import { NativeBridge } from './native-bridge.js';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; ++i) arr[i] = raw.charCodeAt(i);
  return arr;
}

/** Data passed to the notification click handler. */
export interface NotificationClickData {
  /** Domain of the forum that sent the notification. */
  forum: string;
  /** Deep link path within the forum (e.g. `"/thread/123"`). */
  path: string;
}

type NotificationClickHandler = (data: NotificationClickData) => void;

/** Web Push notification manager. Handles service worker registration and VAPID subscription. */
export const PushNotifications = {
  /** The active service worker registration, or `null` if not registered. */
  swRegistration: null as ServiceWorkerRegistration | null,
  _onNotificationClick: null as NotificationClickHandler | null,

  /**
   * Register the push service worker (`/sw.js`) and set up notification click routing.
   * @param onNotificationClick - Optional callback invoked when the user clicks a push notification.
   * @returns The service worker registration, or `null` if service workers aren't supported.
   */
  async registerServiceWorker(
    onNotificationClick?: NotificationClickHandler,
  ): Promise<ServiceWorkerRegistration | null> {
    if (!('serviceWorker' in navigator)) return null;
    if (onNotificationClick) this._onNotificationClick = onNotificationClick;
    try {
      this.swRegistration = await navigator.serviceWorker.register('/sw.js');
      console.log('[Push] SW registered');
      navigator.serviceWorker.addEventListener('message', (event: MessageEvent) => {
        if (event.data?.type === 'notification-click' && this._onNotificationClick) {
          this._onNotificationClick({
            forum: event.data.forum_domain,
            path: event.data.link || '/',
          });
        }
      });
      return this.swRegistration;
    } catch (err) {
      console.error('[Push] SW failed:', err);
      return null;
    }
  },

  /**
   * Request notification permission and subscribe to Web Push.
   * Fetches the server's VAPID public key, creates a push subscription,
   * and registers it with the Forumline API. Also forwards the subscription
   * to the native shell if running in a native app.
   *
   * No-ops silently if permission is denied or the service worker isn't registered.
   */
  async subscribe(): Promise<void> {
    if (!this.swRegistration) await this.registerServiceWorker();
    if (!this.swRegistration) return;
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return;
    try {
      const config = await ForumlineAPI.apiFetch<{ vapid_public_key?: string }>(
        '/api/push/config',
        { silent: true },
      ).catch((e) => { console.error('[Push] VAPID config fetch failed:', e); return null; });
      if (!config?.vapid_public_key) return;
      const vapidKey = urlBase64ToUint8Array(config.vapid_public_key) as Uint8Array<ArrayBuffer>;
      const sub = await this.swRegistration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: vapidKey,
      });
      const subJson = sub.toJSON();
      await ForumlineAPI.apiFetch('/api/push?action=subscribe', {
        method: 'POST',
        body: JSON.stringify({
          endpoint: subJson.endpoint,
          keys: subJson.keys,
        }),
      });
      console.log('[Push] Subscribed');
      NativeBridge.sendPushToken(JSON.stringify(subJson));
    } catch (err) {
      console.error('[Push] Subscribe failed:', err);
    }
  },
};
