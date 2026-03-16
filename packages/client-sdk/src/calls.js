// ========== CALL MANAGER (Voice Calls via LiveKit) ==========
// Call state machine, LiveKit room connection, signaling via SSE.
// UI rendering (overlays, ringtones) is handled by the consuming application.

import { ForumlineAPI } from './client.js';
import { NativeBridge } from './native-bridge.js';
import { EventStream } from './event-stream.js';

const RING_TIMEOUT_MS = 30000;

// --- Call state ---
const callState = {
  state: 'idle',
  callInfo: null,
  muted: false,
  duration: 0,
};

let room = null;
let livekitModule = null;
let callTimer = null;
let callSseUnsub = null;
let durationInterval = null;

const callStateListeners = [];
function onCallStateChange(fn) { callStateListeners.push(fn); }
function notifyCallStateChange() {
  callStateListeners.forEach(fn => { try { fn(callState); } catch(e) { console.error(e); } });
}

function setCallState(newState, info) {
  callState.state = newState;
  if (info !== undefined) callState.callInfo = info;
  if (newState === 'idle') { callState.callInfo = null; callState.muted = false; callState.duration = 0; }
  notifyCallStateChange();
}

async function getLiveKit() {
  if (!livekitModule) livekitModule = await import('livekit-client');
  return livekitModule;
}

// --- Call signal subscription via unified event stream ---
function connectCallSSE() {
  if (callSseUnsub) return;
  callSseUnsub = EventStream.subscribeCall((signal) => {
    handleCallSignal(signal);
  });
}

function reconnectCallSSE() {
  if (callSseUnsub) { callSseUnsub(); callSseUnsub = null; }
  connectCallSSE();
}

async function handleCallSignal(signal) {
  const { type } = signal;

  if (type === 'incoming_call') {
    if (callState.state !== 'idle') return;
    setCallState('ringing-incoming', {
      callId: signal.call_id, conversationId: signal.conversation_id,
      remoteUserId: signal.caller_id,
      remoteDisplayName: signal.caller_display_name || signal.caller_username || 'Unknown',
      remoteAvatarUrl: signal.caller_avatar_url || null,
    });
    NativeBridge.sendCallEvent('incoming', callState.callInfo);
    callTimer = setTimeout(() => { if (callState.state === 'ringing-incoming') callCleanup(); }, RING_TIMEOUT_MS);
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
async function connectLiveKit() {
  if (!callState.callInfo) return;

  try {
    const resp = await ForumlineAPI.apiFetch('/api/calls/' + callState.callInfo.callId + '/token', { method: 'POST' });
    const { token, url } = resp;

    const lk = await getLiveKit();
    room = new lk.Room();

    room.on(lk.RoomEvent.TrackSubscribed, (track) => {
      if (track.kind === lk.Track.Kind.Audio) {
        const el = track.attach();
        el.id = `call-audio-${track.sid}`;
        document.body.appendChild(el);
      }
    });

    room.on(lk.RoomEvent.TrackUnsubscribed, (track) => {
      track.detach().forEach(el => el.remove());
    });

    room.on(lk.RoomEvent.Disconnected, () => {
      if (callState.state === 'active') endCall();
    });

    room.on(lk.RoomEvent.ParticipantConnected, () => {
      // Remote party joined — start the duration timer
      if (!durationInterval) startDurationTimer();
    });

    await room.connect(url, token);
    await room.localParticipant.setMicrophoneEnabled(true);
    startDurationTimer();
  } catch (err) {
    console.error('[Call] LiveKit connect failed:', err);
    endCall();
  }
}

// --- Call lifecycle ---
async function initiateCall(conversationId, remoteUserId, remoteDisplayName, remoteAvatarUrl) {
  if (callState.state !== 'idle' || !ForumlineAPI.isAuthenticated()) return;
  try {
    const result = await ForumlineAPI.apiFetch('/api/calls', {
      method: 'POST', body: JSON.stringify({ conversation_id: conversationId, callee_id: remoteUserId }),
    });
    setCallState('ringing-outgoing', {
      callId: result.id, conversationId, remoteUserId,
      remoteDisplayName, remoteAvatarUrl: remoteAvatarUrl || null,
    });
    NativeBridge.sendCallEvent('outgoing', callState.callInfo);
    callTimer = setTimeout(() => { if (callState.state === 'ringing-outgoing') endCall(); }, RING_TIMEOUT_MS);
  } catch (err) {
    console.error('[Call] initiate failed:', err);
  }
}

async function acceptCall() {
  if (callState.state !== 'ringing-incoming' || !callState.callInfo) return;
  if (callTimer) { clearTimeout(callTimer); callTimer = null; }
  try {
    await ForumlineAPI.apiFetch('/api/calls/' + callState.callInfo.callId + '/respond', {
      method: 'POST', body: JSON.stringify({ action: 'accept' }),
    });
    setCallState('active');
    NativeBridge.sendCallEvent('accepted', callState.callInfo);
    await connectLiveKit();
  } catch { callCleanup(); }
}

async function declineCall() {
  if (callState.state !== 'ringing-incoming' || !callState.callInfo) return;
  if (callTimer) { clearTimeout(callTimer); callTimer = null; }
  try { await ForumlineAPI.apiFetch('/api/calls/' + callState.callInfo.callId + '/respond', { method: 'POST', body: JSON.stringify({ action: 'decline' }) }); } catch {}
  NativeBridge.sendCallEvent('ended', callState.callInfo);
  callCleanup();
}

async function endCall() {
  if (!callState.callInfo) return;
  try { await ForumlineAPI.apiFetch('/api/calls/' + callState.callInfo.callId + '/end', { method: 'POST' }); } catch {}
  NativeBridge.sendCallEvent('ended', callState.callInfo);
  callCleanup();
}

function toggleCallMute() {
  callState.muted = !callState.muted;
  if (room) room.localParticipant.setMicrophoneEnabled(!callState.muted);
  notifyCallStateChange();
  return callState.muted;
}

function startDurationTimer() {
  if (durationInterval) clearInterval(durationInterval);
  callState.duration = 0;
  durationInterval = setInterval(() => { callState.duration++; notifyCallStateChange(); }, 1000);
}

function callCleanup() {
  if (callTimer) { clearTimeout(callTimer); callTimer = null; }
  if (durationInterval) { clearInterval(durationInterval); durationInterval = null; }
  if (room) {
    room.disconnect();
    room = null;
  }
  setCallState('idle', null);
}

function destroyCallManager() {
  callCleanup();
  if (callSseUnsub) { callSseUnsub(); callSseUnsub = null; }
}

// --- Init ---
function init() {
  if (ForumlineAPI.isAuthenticated()) {
    connectCallSSE();
  }
}

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
