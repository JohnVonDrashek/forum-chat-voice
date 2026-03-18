/**
 * @module native-bridge
 *
 * Bridge for communication between the web app and native iOS/Android shells.
 * Detects the native environment via injected globals and uses postMessage
 * for bidirectional communication.
 *
 * @example
 * ```ts
 * if (NativeBridge.isNative()) {
 *   NativeBridge.init({
 *     acceptCall: () => CallManager.acceptCall(),
 *     handleDeepLink: (url) => router.navigate(url),
 *   });
 * }
 * ```
 */

import { ForumlineAPI } from './client.js';

declare const window: Window &
  typeof globalThis & {
    __FORUMLINE_IOS__?: boolean;
    __FORUMLINE_ANDROID__?: boolean;
    forumlineNative?: { postMessage(message: string): void };
    forumlineNativeBridge?: { onMessage?: (msgStr: string) => void };
  };

/** Information about an active or ringing call, passed to native call UI. */
export interface CallInfo {
  /** Server-assigned call ID. */
  callId: string;
  /** DM conversation ID associated with this call. */
  conversationId?: string;
  /** User ID of the remote party. */
  remoteUserId: string;
  /** Display name of the remote party. */
  remoteDisplayName: string;
  /** Avatar URL of the remote party. */
  remoteAvatarUrl?: string | null;
}

interface NativeMessage {
  type: string;
  token?: string;
  url?: string;
  [key: string]: unknown;
}

/** Handlers for messages received from the native shell. */
export interface NativeBridgeHandlers {
  /** Called when the native UI accepts an incoming call. */
  acceptCall?: () => void;
  /** Called when the native UI declines an incoming call. */
  declineCall?: () => void;
  /** Called when the native UI ends an active call. */
  endCall?: () => void;
  /** Called when a deep link URL is received from the native shell. */
  handleDeepLink?: (url: string) => void;
}

/**
 * Native app bridge for iOS/Android shell communication.
 * No-ops gracefully when running in a regular browser.
 */
export const NativeBridge = {
  /** Returns `true` if running inside the Forumline iOS app. */
  isIOS(): boolean {
    return !!window.__FORUMLINE_IOS__;
  },

  /** Returns `true` if running inside the Forumline Android app. */
  isAndroid(): boolean {
    return !!window.__FORUMLINE_ANDROID__;
  },

  /** Returns `true` if running inside any Forumline native app shell. */
  isNative(): boolean {
    return this.isIOS() || this.isAndroid();
  },

  /**
   * Send a message to the native shell via the injected `forumlineNative.postMessage`.
   * No-ops if not running in a native environment.
   * @param message - String or object (will be JSON-stringified).
   */
  postMessage(message: string | object): void {
    const str = typeof message !== 'string' ? JSON.stringify(message) : message;
    if (window.forumlineNative?.postMessage) window.forumlineNative.postMessage(str);
  },

  /**
   * Notify the native shell about a call event (incoming, outgoing, accepted, ended).
   * No-ops if not in a native environment or if callInfo is null.
   */
  sendCallEvent(eventType: string, callInfo: CallInfo | null): void {
    if (!this.isNative() || !callInfo) return;
    this.postMessage({
      type: 'call_event',
      event: eventType,
      callId: callInfo.callId,
      remoteUserId: callInfo.remoteUserId,
      remoteDisplayName: callInfo.remoteDisplayName,
    });
  },

  /**
   * Send a push notification token to the native shell for registration.
   * No-ops if not in a native environment.
   */
  sendPushToken(token: string): void {
    if (!this.isNative()) return;
    this.postMessage({ type: 'push_token', token });
  },

  /**
   * Initialize the native bridge by registering a message handler.
   * The native shell calls `forumlineNativeBridge.onMessage(jsonString)`
   * to send messages into the web app.
   *
   * @param handlers - Callbacks for native-initiated actions.
   */
  init(handlers: NativeBridgeHandlers = {}): void {
    window.forumlineNativeBridge = window.forumlineNativeBridge || {};
    window.forumlineNativeBridge!.onMessage = (msgStr: string) => {
      try {
        const msg: NativeMessage = typeof msgStr === 'string' ? JSON.parse(msgStr) : msgStr;
        this._handleNativeMessage(msg, handlers);
      } catch (err) {
        console.error('[NativeBridge] parse error:', err);
      }
    };
  },

  _handleNativeMessage(msg: NativeMessage, handlers: NativeBridgeHandlers = {}): void {
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
            method: 'POST',
            silent: true,
            body: JSON.stringify({
              action: 'subscribe',
              native_token: msg.token,
              platform: this.isIOS() ? 'ios' : 'android',
            }),
          }).catch((e) => console.warn('[NativeBridge] push token registration failed:', e));
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
