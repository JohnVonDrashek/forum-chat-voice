// ========== CALL MANAGER (Voice Calls via LiveKit) ==========
// Call state machine, LiveKit room connection, ringtone generation,
// signaling via SSE (lifecycle events only — media handled by LiveKit).

import { ForumlineAPI } from './client.js';
import { avatarUrl } from '../lib/avatar.js';
import { NativeBridge } from './native-bridge.js';

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
let callSignalSSE = null;
let callTimer = null;
let sseReconnectTimer = null;
let sseReconnectAttempts = 0;
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

// --- SSE for call lifecycle events ---
function connectCallSSE() {
  if (callSignalSSE) return;
  const token = ForumlineAPI.getToken();
  if (!token) return;
  callSignalSSE = new EventSource('/api/calls/stream?access_token=' + encodeURIComponent(token));
  callSignalSSE.onopen = () => { sseReconnectAttempts = 0; };
  callSignalSSE.onmessage = (event) => {
    try {
      const signal = JSON.parse(event.data);
      handleCallSignal(signal);
    } catch (err) { console.error('[Call] SSE parse error:', err); }
  };
  callSignalSSE.onerror = () => {
    callSignalSSE?.close(); callSignalSSE = null;
    if (!ForumlineAPI.getToken()) return;
    const base = Math.min(1000 * Math.pow(2, sseReconnectAttempts), 30000);
    sseReconnectAttempts++;
    sseReconnectTimer = setTimeout(connectCallSSE, base + Math.random() * base * 0.3);
  };
}

function reconnectCallSSE() {
  if (sseReconnectTimer) { clearTimeout(sseReconnectTimer); sseReconnectTimer = null; }
  callSignalSSE?.close(); callSignalSSE = null;
  sseReconnectAttempts = 0;
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
  if (sseReconnectTimer) { clearTimeout(sseReconnectTimer); sseReconnectTimer = null; }
  if (callSignalSSE) { callSignalSSE.close(); callSignalSSE = null; }
}

// --- Ringtone (Web Audio, no external files) ---
let ringtoneCtx = null;
let ringtoneWarmed = false;

function warmAudioContext() {
  if (ringtoneWarmed) return;
  ringtoneWarmed = true;
  const handler = () => {
    if (!ringtoneCtx) ringtoneCtx = new AudioContext();
    if (ringtoneCtx.state === 'suspended') ringtoneCtx.resume();
    document.removeEventListener('click', handler);
    document.removeEventListener('keydown', handler);
    document.removeEventListener('touchstart', handler);
  };
  document.addEventListener('click', handler);
  document.addEventListener('keydown', handler);
  document.addEventListener('touchstart', handler);
}

function playRingtone(type) {
  if (!ringtoneCtx) ringtoneCtx = new AudioContext();
  const ctx = ringtoneCtx;
  let stopped = false, timeout = null, curOsc = null, curGain = null;

  function tone(freq, dur) {
    return new Promise(resolve => {
      if (stopped) { resolve(); return; }
      const osc = ctx.createOscillator(); const gain = ctx.createGain();
      osc.type = 'sine'; osc.frequency.value = freq; gain.gain.value = 0.15;
      osc.connect(gain); gain.connect(ctx.destination);
      curOsc = osc; curGain = gain; osc.start();
      timeout = setTimeout(() => {
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.05);
        setTimeout(() => { osc.stop(); osc.disconnect(); gain.disconnect(); curOsc = null; curGain = null; resolve(); }, 50);
      }, dur);
    });
  }
  function pause(ms) { return new Promise(r => { if (stopped) { r(); return; } timeout = setTimeout(r, ms); }); }

  async function loop() {
    while (!stopped) {
      if (type === 'incoming') { await tone(440, 200); await pause(100); await tone(440, 200); await pause(2000); }
      else { await tone(440, 1000); await pause(3000); }
    }
  }
  ctx.resume().then(loop);

  return () => {
    stopped = true;
    if (timeout) clearTimeout(timeout);
    if (curOsc) { try { curOsc.stop(); } catch {} curOsc.disconnect(); }
    if (curGain) curGain.disconnect();
  };
}

// --- Call UI overlays ---
let stopRingtoneRef = null;

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatDuration(s) {
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

function renderCallUI() {
  const s = callState.state;
  const info = callState.callInfo;

  if (s === 'idle') {
    const el = document.getElementById('incomingCallOverlay');
    if (el) el.classList.add('hidden');
    const bar = document.getElementById('activeCallBar');
    if (bar) bar.classList.add('hidden');
    return;
  }

  if (s === 'ringing-incoming' || s === 'ringing-outgoing') {
    let el = document.getElementById('incomingCallOverlay');
    if (!el) {
      el = document.createElement('div');
      el.id = 'incomingCallOverlay';
      el.style.cssText = 'position:fixed;top:16px;right:16px;z-index:10000;display:flex;background:rgba(30,30,30,0.95);flex-direction:column;align-items:center;padding:1.25rem 1.5rem;gap:0.75rem;border-radius:16px;box-shadow:0 8px 32px rgba(0,0,0,0.4);min-width:220px;backdrop-filter:blur(12px);';
      document.body.appendChild(el);
    }
    el.classList.remove('hidden');
    const callAvatar = info.remoteAvatarUrl || avatarUrl(info.remoteDisplayName);
    const isIncoming = s === 'ringing-incoming';
    el.innerHTML =
      '<img src="' + callAvatar + '" alt="" style="width:56px;height:56px;border-radius:50%;" onerror="this.style.display=\'none\'">' +
      '<div style="font-size:0.95rem;font-weight:600;color:white;">' + escapeHtml(info.remoteDisplayName) + '</div>' +
      '<div style="font-size:0.75rem;color:rgba(255,255,255,0.5);">' + (isIncoming ? 'Incoming call' : 'Calling...') + '</div>' +
      '<div style="display:flex;gap:1rem;margin-top:0.5rem;">' +
        '<button id="callDeclineBtn" style="width:40px;height:40px;border-radius:50%;border:none;background:#ef4444;cursor:pointer;color:white;font-size:16px;">&#x2716;</button>' +
        (isIncoming ? '<button id="callAcceptBtn" style="width:40px;height:40px;border-radius:50%;border:none;background:#22c55e;cursor:pointer;color:white;font-size:16px;">&#x260E;</button>' : '') +
      '</div>';
    el.querySelector('#callDeclineBtn').addEventListener('click', () => isIncoming ? declineCall() : endCall());
    if (isIncoming) el.querySelector('#callAcceptBtn').addEventListener('click', () => acceptCall());
    return;
  }

  if (s === 'active') {
    const overlay = document.getElementById('incomingCallOverlay');
    if (overlay) overlay.classList.add('hidden');
    let bar = document.getElementById('activeCallBar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'activeCallBar';
      bar.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:10001;display:flex;align-items:center;gap:0.75rem;padding:0.5rem 1rem;background:#22c55e;color:white;font-size:0.875rem;';
      document.body.appendChild(bar);
    }
    bar.classList.remove('hidden');
    bar.innerHTML =
      '<span style="font-weight:600;">' + formatDuration(callState.duration) + '</span>' +
      '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escapeHtml(info.remoteDisplayName) + '</span>' +
      '<button id="callMuteBtn" style="background:none;border:none;color:white;cursor:pointer;padding:0.25rem;opacity:' + (callState.muted ? '0.5' : '1') + ';" title="' + (callState.muted ? 'Unmute' : 'Mute') + '">' + (callState.muted ? '&#x1F507;' : '&#x1F3A4;') + '</button>' +
      '<button id="callEndBtn" style="background:#ef4444;border:none;color:white;cursor:pointer;padding:0.25rem 0.5rem;border-radius:1rem;font-size:0.75rem;font-weight:600;">End</button>';
    bar.querySelector('#callMuteBtn').addEventListener('click', (e) => { e.stopPropagation(); toggleCallMute(); });
    bar.querySelector('#callEndBtn').addEventListener('click', (e) => { e.stopPropagation(); endCall(); });
  }
}

// React to call state changes for ringtone and UI
let prevCallUIState = 'idle';
onCallStateChange(() => {
  const s = callState.state;
  if (prevCallUIState !== s && stopRingtoneRef) { stopRingtoneRef(); stopRingtoneRef = null; }
  if (s === 'ringing-outgoing' && prevCallUIState !== 'ringing-outgoing') stopRingtoneRef = playRingtone('outgoing');
  else if (s === 'ringing-incoming' && prevCallUIState !== 'ringing-incoming') stopRingtoneRef = playRingtone('incoming');
  prevCallUIState = s;
  renderCallUI();
});

// --- Init ---
function init() {
  warmAudioContext();
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
