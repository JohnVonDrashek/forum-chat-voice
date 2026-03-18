/**
 * @module calls
 *
 * Voice call state machine backed by LiveKit SFU.
 * Manages the full call lifecycle: initiate, ring, accept/decline, active audio,
 * and cleanup. Call signaling arrives via {@link EventStream}, audio via LiveKit.
 *
 * UI rendering (overlays, ringtones, etc.) is the caller's responsibility —
 * subscribe to state changes with {@link CallManager.onCallStateChange}.
 *
 * @example
 * ```ts
 * CallManager.init();
 * CallManager.onCallStateChange((state) => renderCallUI(state));
 * await CallManager.initiateCall(convoId, remoteId, 'Alice');
 * ```
 */

import { ForumlineAPI } from './client.js';
import type { CallSignal } from './event-stream.js';
import { EventStream } from './event-stream.js';
import type { CallInfo } from './native-bridge.js';
import { NativeBridge } from './native-bridge.js';

const RING_TIMEOUT_MS = 30000;

// --- Call state ---

/** Possible states of the call state machine. */
export type CallStateValue = 'idle' | 'ringing-incoming' | 'ringing-outgoing' | 'active';

/** Snapshot of the current call state, passed to {@link CallStateListener} callbacks. */
export interface CallState {
  /** Current phase of the call. */
  state: CallStateValue;
  /** Info about the active/ringing call, or `null` when idle. */
  callInfo: CallInfo | null;
  /** Whether the local microphone is muted. */
  muted: boolean;
  /** Call duration in seconds (ticks every second while active). */
  duration: number;
}

/** Callback signature for {@link CallManager.onCallStateChange}. */
export type CallStateListener = (state: CallState) => void;

const callState: CallState = {
  state: 'idle',
  callInfo: null,
  muted: false,
  duration: 0,
};

// LiveKit types (dynamically imported)
interface LiveKitModule {
  Room: new () => LiveKitRoom;
  RoomEvent: Record<string, string>;
  Track: { Kind: { Audio: string } };
}

interface LiveKitRoom {
  on(event: string, handler: (...args: unknown[]) => void): void;
  connect(url: string, token: string): Promise<void>;
  disconnect(): void;
  localParticipant: {
    setMicrophoneEnabled(enabled: boolean): Promise<void>;
  };
}

let room: LiveKitRoom | null = null;
let livekitModule: LiveKitModule | null = null;
let callTimer: ReturnType<typeof setTimeout> | null = null;
let callSseUnsub: (() => void) | null = null;
let durationInterval: ReturnType<typeof setInterval> | null = null;

const callStateListeners: CallStateListener[] = [];

/**
 * Register a callback that fires on every call state transition.
 * There is no unsubscribe — listeners persist for the app's lifetime.
 */
function onCallStateChange(fn: CallStateListener): void {
  callStateListeners.push(fn);
}
function notifyCallStateChange(): void {
  callStateListeners.forEach(fn => {
    try {
      fn(callState);
    } catch (e) {
      console.error(e);
    }
  });
}

function setCallState(newState: CallStateValue, info?: CallInfo | null): void {
  callState.state = newState;
  if (info !== undefined) callState.callInfo = info;
  if (newState === 'idle') {
    callState.callInfo = null;
    callState.muted = false;
    callState.duration = 0;
  }
  notifyCallStateChange();
}

async function getLiveKit(): Promise<LiveKitModule> {
  if (!livekitModule) livekitModule = (await import('livekit-client')) as unknown as LiveKitModule;
  return livekitModule;
}

// --- Call signal subscription via unified event stream ---
function connectCallSSE(): void {
  if (callSseUnsub) return;
  callSseUnsub = EventStream.subscribeCall((signal: CallSignal) => {
    void handleCallSignal(signal);
  });
}

/**
 * Tear down and re-establish the call signaling subscription.
 * Useful after a token refresh or SSE reconnect.
 */
function reconnectCallSSE(): void {
  if (callSseUnsub) {
    callSseUnsub();
    callSseUnsub = null;
  }
  connectCallSSE();
}

async function handleCallSignal(signal: CallSignal): Promise<void> {
  const { type } = signal;

  if (type === 'incoming_call') {
    if (callState.state !== 'idle') return;
    setCallState('ringing-incoming', {
      callId: signal.call_id!,
      conversationId: signal.conversation_id,
      remoteUserId: signal.caller_id!,
      remoteDisplayName: signal.caller_display_name || signal.caller_username || 'Unknown',
      remoteAvatarUrl: signal.caller_avatar_url || null,
    });
    NativeBridge.sendCallEvent('incoming', callState.callInfo);
    callTimer = setTimeout(() => {
      if (callState.state === 'ringing-incoming') callCleanup();
    }, RING_TIMEOUT_MS);
    return;
  }
  if (type === 'call_accepted') {
    if (callState.state !== 'ringing-outgoing') return;
    setCallState('active');
    NativeBridge.sendCallEvent('accepted', callState.callInfo);
    await connectLiveKit();
    return;
  }
  if (type === 'call_declined' || type === 'call_ended') {
    NativeBridge.sendCallEvent('ended', callState.callInfo);
    callCleanup();
    return;
  }
}

// --- LiveKit connection ---
async function connectLiveKit(): Promise<void> {
  if (!callState.callInfo) return;

  try {
    const resp = await ForumlineAPI.apiFetch<{ token: string; url: string }>(
      '/api/calls/' + callState.callInfo.callId + '/token',
      { method: 'POST' },
    );
    const { token, url } = resp;

    const lk = await getLiveKit();
    room = new lk.Room();

    room.on(lk.RoomEvent.TrackSubscribed, (track: unknown) => {
      const t = track as { kind: string; sid: string; attach(): HTMLMediaElement };
      if (t.kind === lk.Track.Kind.Audio) {
        const el = t.attach();
        el.id = `call-audio-${t.sid}`;
        document.body.appendChild(el);
      }
    });

    room.on(lk.RoomEvent.TrackUnsubscribed, (track: unknown) => {
      const t = track as { detach(): HTMLMediaElement[] };
      t.detach().forEach(el => el.remove());
    });

    room.on(lk.RoomEvent.Disconnected, () => {
      if (callState.state === 'active') void endCall();
    });

    room.on(lk.RoomEvent.ParticipantConnected, () => {
      if (!durationInterval) startDurationTimer();
    });

    await room.connect(url, token);
    await room.localParticipant.setMicrophoneEnabled(true);
    startDurationTimer();
  } catch (err) {
    console.error('[Call] LiveKit connect failed:', err);
    void endCall();
  }
}

// --- Call lifecycle ---

/**
 * Start an outbound call to another user.
 * Transitions state to `ringing-outgoing` and waits for the remote party to accept.
 * Times out after 30 seconds.
 *
 * @param conversationId - DM conversation ID for this call.
 * @param remoteUserId - User ID of the person being called.
 * @param remoteDisplayName - Display name shown in the call UI.
 * @param remoteAvatarUrl - Optional avatar URL for the call UI.
 */
async function initiateCall(
  conversationId: string,
  remoteUserId: string,
  remoteDisplayName: string,
  remoteAvatarUrl?: string | null,
): Promise<void> {
  if (callState.state !== 'idle' || !ForumlineAPI.isAuthenticated()) return;
  try {
    const result = await ForumlineAPI.apiFetch<{ id: string }>('/api/calls', {
      method: 'POST',
      body: JSON.stringify({ conversation_id: conversationId, callee_id: remoteUserId }),
    });
    setCallState('ringing-outgoing', {
      callId: result.id,
      conversationId,
      remoteUserId,
      remoteDisplayName,
      remoteAvatarUrl: remoteAvatarUrl || null,
    });
    NativeBridge.sendCallEvent('outgoing', callState.callInfo);
    callTimer = setTimeout(() => {
      if (callState.state === 'ringing-outgoing') void endCall();
    }, RING_TIMEOUT_MS);
  } catch (err) {
    console.error('[Call] initiate failed:', err);
  }
}

/** Accept an incoming call. Transitions to `active` and connects to LiveKit. */
async function acceptCall(): Promise<void> {
  if (callState.state !== 'ringing-incoming' || !callState.callInfo) return;
  if (callTimer) {
    clearTimeout(callTimer);
    callTimer = null;
  }
  try {
    await ForumlineAPI.apiFetch('/api/calls/' + callState.callInfo.callId + '/respond', {
      method: 'POST',
      body: JSON.stringify({ action: 'accept' }),
    });
    setCallState('active');
    NativeBridge.sendCallEvent('accepted', callState.callInfo);
    await connectLiveKit();
  } catch (e) {
    console.error('[Calls] accept failed:', e);
    callCleanup();
  }
}

/** Decline an incoming call. Notifies the caller and resets to idle. */
async function declineCall(): Promise<void> {
  if (callState.state !== 'ringing-incoming' || !callState.callInfo) return;
  if (callTimer) {
    clearTimeout(callTimer);
    callTimer = null;
  }
  try {
    await ForumlineAPI.apiFetch('/api/calls/' + callState.callInfo.callId + '/respond', {
      method: 'POST',
      body: JSON.stringify({ action: 'decline' }),
    });
  } catch (e) {
    console.error('[Calls] decline failed:', e);
  }
  NativeBridge.sendCallEvent('ended', callState.callInfo);
  callCleanup();
}

/** End an active or outgoing call. Disconnects LiveKit and resets to idle. */
async function endCall(): Promise<void> {
  if (!callState.callInfo) return;
  try {
    await ForumlineAPI.apiFetch('/api/calls/' + callState.callInfo.callId + '/end', {
      method: 'POST',
    });
  } catch (e) {
    console.error('[Calls] end failed:', e);
  }
  NativeBridge.sendCallEvent('ended', callState.callInfo);
  callCleanup();
}

/**
 * Toggle the local microphone mute state.
 * @returns The new muted state (`true` = muted).
 */
function toggleCallMute(): boolean {
  callState.muted = !callState.muted;
  if (room) room.localParticipant.setMicrophoneEnabled(!callState.muted);
  notifyCallStateChange();
  return callState.muted;
}

function startDurationTimer(): void {
  if (durationInterval) clearInterval(durationInterval);
  callState.duration = 0;
  durationInterval = setInterval(() => {
    callState.duration++;
    notifyCallStateChange();
  }, 1000);
}

function callCleanup(): void {
  if (callTimer) {
    clearTimeout(callTimer);
    callTimer = null;
  }
  if (durationInterval) {
    clearInterval(durationInterval);
    durationInterval = null;
  }
  if (room) {
    room.disconnect();
    room = null;
  }
  setCallState('idle', null);
}

/**
 * Fully tear down the call manager: end any active call, disconnect LiveKit,
 * and unsubscribe from SSE call signals.
 */
function destroyCallManager(): void {
  callCleanup();
  if (callSseUnsub) {
    callSseUnsub();
    callSseUnsub = null;
  }
}

/**
 * Initialize the call manager. Subscribes to SSE call signals
 * if the user is already authenticated. Call once on app startup.
 */
function init(): void {
  if (ForumlineAPI.isAuthenticated()) {
    connectCallSSE();
  }
}

/**
 * Voice call manager. Handles the full 1:1 call lifecycle over LiveKit SFU.
 * Subscribe to {@link CallManager.onCallStateChange} to drive your call UI.
 */
export const CallManager = {
  init,
  callState,
  initiateCall,
  acceptCall,
  declineCall,
  endCall,
  toggleCallMute,
  onCallStateChange,
  reconnectCallSSE,
  destroyCallManager,
};
