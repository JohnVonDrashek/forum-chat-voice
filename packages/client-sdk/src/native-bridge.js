// ========== NATIVE APP BRIDGE ==========
// iOS/Android detection, postMessage send/receive.

import { ForumlineAPI } from './client.js';

export const NativeBridge = {
  isIOS() { return !!window.__FORUMLINE_IOS__; },
  isAndroid() { return !!window.__FORUMLINE_ANDROID__; },
  isNative() { return this.isIOS() || this.isAndroid(); },

  postMessage(message) {
    if (typeof message !== 'string') message = JSON.stringify(message);
    if (window.forumlineNative?.postMessage) window.forumlineNative.postMessage(message);
  },

  sendCallEvent(eventType, callInfo) {
    if (!this.isNative() || !callInfo) return;
    this.postMessage({ type: 'call_event', event: eventType, callId: callInfo.callId, remoteUserId: callInfo.remoteUserId, remoteDisplayName: callInfo.remoteDisplayName });
  },

  sendPushToken(token) {
    if (!this.isNative()) return;
    this.postMessage({ type: 'push_token', token: token });
  },

  init(handlers = {}) {
    window.forumlineNativeBridge = window.forumlineNativeBridge || {};
    window.forumlineNativeBridge.onMessage = (msgStr) => {
      try {
        const msg = typeof msgStr === 'string' ? JSON.parse(msgStr) : msgStr;
        this._handleNativeMessage(msg, handlers);
      } catch (err) { console.error('[NativeBridge] parse error:', err); }
    };
  },

  _handleNativeMessage(msg, handlers = {}) {
    switch (msg.type) {
      case 'call_accept':
        if (handlers.acceptCall) handlers.acceptCall();
        break;
      case 'call_decline':
        if (handlers.declineCall) handlers.declineCall();
        break;
      case 'call_end':
        if (handlers.endCall) handlers.endCall();
        break;
      case 'push_token_native':
        if (msg.token && ForumlineAPI.isAuthenticated()) {
          ForumlineAPI.apiFetch('/api/push', {
            method: 'POST', silent: true,
            body: JSON.stringify({ action: 'subscribe', native_token: msg.token, platform: this.isIOS() ? 'ios' : 'android' }),
          }).catch(() => {});
        }
        break;
      case 'deep_link':
        if (msg.url && handlers.handleDeepLink) {
          handlers.handleDeepLink(msg.url);
        }
        break;
      default:
        console.log('[NativeBridge] unknown:', msg.type);
    }
  },
};
