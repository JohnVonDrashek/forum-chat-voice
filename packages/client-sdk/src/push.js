// ========== PUSH NOTIFICATIONS ==========
// Service worker registration, VAPID subscription, push token management.

import { ForumlineAPI } from './client.js';
import { NativeBridge } from './native-bridge.js';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; ++i) arr[i] = raw.charCodeAt(i);
  return arr;
}

export const PushNotifications = {
  swRegistration: null,
  _onNotificationClick: null,

  async registerServiceWorker(onNotificationClick) {
    if (!('serviceWorker' in navigator)) return null;
    if (onNotificationClick) this._onNotificationClick = onNotificationClick;
    try {
      this.swRegistration = await navigator.serviceWorker.register('/sw.js');
      console.log('[Push] SW registered');
      navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data?.type === 'notification-click' && this._onNotificationClick) {
          this._onNotificationClick({ forum: event.data.forum_domain, path: event.data.link || '/' });
        }
      });
      return this.swRegistration;
    } catch (err) { console.error('[Push] SW failed:', err); return null; }
  },

  async subscribe() {
    if (!this.swRegistration) await this.registerServiceWorker();
    if (!this.swRegistration) return;
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return;
    try {
      const config = await ForumlineAPI.apiFetch('/api/push/config', { silent: true }).catch(() => null);
      if (!config?.vapid_public_key) return;
      const vapidKey = urlBase64ToUint8Array(config.vapid_public_key);
      const sub = await this.swRegistration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapidKey });
      await ForumlineAPI.apiFetch('/api/push', { method: 'POST', body: JSON.stringify({ action: 'subscribe', subscription: sub.toJSON() }) });
      console.log('[Push] Subscribed');
      NativeBridge.sendPushToken(JSON.stringify(sub.toJSON()));
    } catch (err) { console.error('[Push] Subscribe failed:', err); }
  },
};
