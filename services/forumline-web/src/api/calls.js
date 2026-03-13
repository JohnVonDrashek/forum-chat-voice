// ========== CALL MANAGER (Voice Calls + WebRTC) ==========
// Call state machine, WebRTC peer connection, ICE handling,
// signaling via SSE, ringtone generation, call overlay UI.

import { ForumlineAPI } from './client.js';
import { NativeBridge } from './native-bridge.js';

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];
const RING_TIMEOUT_MS = 30000;
const WEBRTC_CONNECT_TIMEOUT_MS = 15000;

// --- Call state ---
const callState = {
  state: 'idle',
  callInfo: null,
  muted: false,
  duration: 0,
};

let pc = null;
let localStream = null;
let remoteAudioEl = null;
let callSignalSSE = null;
let callTimer = null;
let sseReconnectTimer = null;
let sseReconnectAttempts = 0;
let pendingCandidates = [];
let webrtcStarted = false;
let signalQueue = Promise.resolve();
let iceRestartAttempted = false;
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

// --- Microphone with silent fallback ---
async function acquireMic() {
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const dest = ctx.createMediaStreamDestination();
    const gain = ctx.createGain();
    gain.gain.value = 0;
    osc.connect(gain); gain.connect(dest); osc.start();
    return dest.stream;
  }
}

// --- SSE for incoming call signals ---
function connectCallSSE() {
  if (callSignalSSE) return;
  const token = ForumlineAPI.getToken();
  if (!token) return;
  callSignalSSE = new EventSource('/api/calls/stream?access_token=' + encodeURIComponent(token));
  callSignalSSE.onopen = () => { sseReconnectAttempts = 0; };
  callSignalSSE.onmessage = (event) => {
    try {
      const signal = JSON.parse(event.data);
      signalQueue = signalQueue.then(() => handleCallSignal(signal)).catch(err => console.error('[Call] signal error:', err));
    } catch (err) { console.error('[Call] SSE parse error:', err); }
  };
  callSignalSSE.onerror = () => {
    callSignalSSE?.close(); callSignalSSE = null;
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
    await startWebRTC(true);
    return;
  }
  if (type === 'call_declined' || type === 'call_ended') {
    NativeBridge.sendCallEvent('ended', callState.callInfo);
    callCleanup();
    return;
  }
  // WebRTC signaling
  if (type === 'offer') {
    if (!pc) await startWebRTC(false);
    if (!pc) return;
    await pc.setRemoteDescription(new RTCSessionDescription(signal.payload));
    for (const c of pendingCandidates) await pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
    pendingCandidates = [];
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await sendWebRTCSignal('answer', { sdp: pc.localDescription.sdp, type: pc.localDescription.type });
    return;
  }
  if (type === 'answer') {
    if (!pc) return;
    await pc.setRemoteDescription(new RTCSessionDescription(signal.payload));
    for (const c of pendingCandidates) await pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
    pendingCandidates = [];
    return;
  }
  if (type === 'ice-candidate') {
    if (!pc || !pc.remoteDescription) { pendingCandidates.push(signal.payload); return; }
    await pc.addIceCandidate(new RTCIceCandidate(signal.payload)).catch(() => {});
  }
}

// --- Call lifecycle ---
async function initiateCall(conversationId, remoteUserId, remoteDisplayName, remoteAvatarUrl) {
  if (callState.state !== 'idle' || !ForumlineAPI.isAuthenticated()) return;
  try { localStream = await acquireMic(); } catch { return; }
  try {
    const result = await ForumlineAPI.apiFetch('/api/calls/initiate', {
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
    if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
  }
}

async function acceptCall() {
  if (callState.state !== 'ringing-incoming' || !callState.callInfo) return;
  if (callTimer) { clearTimeout(callTimer); callTimer = null; }
  if (!localStream) { try { localStream = await acquireMic(); } catch { callCleanup(); return; } }
  try {
    await ForumlineAPI.apiFetch('/api/calls/' + callState.callInfo.callId + '/respond', {
      method: 'POST', body: JSON.stringify({ action: 'accept' }),
    });
    setCallState('active');
    NativeBridge.sendCallEvent('accepted', callState.callInfo);
    // Offer arrives via SSE -- don't start WebRTC here
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
  if (localStream) localStream.getAudioTracks().forEach(t => { t.enabled = !callState.muted; });
  notifyCallStateChange();
  return callState.muted;
}

// --- WebRTC peer connection ---
async function startWebRTC(isInitiator) {
  if (!callState.callInfo || webrtcStarted) return;
  webrtcStarted = true;
  if (!localStream) { try { localStream = await acquireMic(); } catch { endCall(); return; } }
  callState.muted = false;

  pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  localStream.getTracks().forEach(t => pc.addTrack(t, localStream));

  pc.ontrack = (event) => {
    const stream = event.streams[0] || new MediaStream([event.track]);
    if (!remoteAudioEl) {
      remoteAudioEl = new Audio();
      remoteAudioEl.autoplay = true;
      remoteAudioEl.playsInline = true;
      document.body.appendChild(remoteAudioEl);
    }
    remoteAudioEl.srcObject = stream;
    remoteAudioEl.play().catch(() => {});
  };

  pc.onicecandidate = (event) => {
    if (event.candidate) sendWebRTCSignal('ice-candidate', event.candidate.toJSON());
  };

  pc.oniceconnectionstatechange = () => {
    if (pc?.iceConnectionState === 'disconnected' && !iceRestartAttempted) {
      iceRestartAttempted = true;
      pc.createOffer({ iceRestart: true })
        .then(offer => pc.setLocalDescription(offer))
        .then(() => sendWebRTCSignal('offer', { sdp: pc.localDescription.sdp, type: pc.localDescription.type }))
        .catch(err => console.error('[Call] ICE restart failed:', err));
    }
  };

  const connectTimeout = setTimeout(() => {
    if (pc && pc.connectionState !== 'connected') { console.error('[Call] WebRTC timed out'); endCall(); }
  }, WEBRTC_CONNECT_TIMEOUT_MS);

  pc.onconnectionstatechange = () => {
    if (pc?.connectionState === 'connected') { clearTimeout(connectTimeout); startDurationTimer(); }
    if (pc?.connectionState === 'failed' || pc?.connectionState === 'closed') { clearTimeout(connectTimeout); endCall(); }
  };

  if (isInitiator) {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await sendWebRTCSignal('offer', { sdp: pc.localDescription.sdp, type: pc.localDescription.type });
  }
}

async function sendWebRTCSignal(type, payload) {
  if (!callState.callInfo) return;
  try {
    await ForumlineAPI.apiFetch('/api/calls/' + callState.callInfo.callId + '/signal', {
      method: 'POST', silent: true,
      body: JSON.stringify({ call_id: callState.callInfo.callId, target_user_id: callState.callInfo.remoteUserId, type, payload }),
    });
  } catch (err) { console.error('[Call] signal send failed:', err); }
}

function startDurationTimer() {
  if (durationInterval) clearInterval(durationInterval);
  callState.duration = 0;
  durationInterval = setInterval(() => { callState.duration++; notifyCallStateChange(); }, 1000);
}

function callCleanup() {
  if (callTimer) { clearTimeout(callTimer); callTimer = null; }
  if (durationInterval) { clearInterval(durationInterval); durationInterval = null; }
  if (pc) { pc.close(); pc = null; }
  if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
  if (remoteAudioEl) { remoteAudioEl.remove(); remoteAudioEl = null; }
  webrtcStarted = false; iceRestartAttempted = false;
  pendingCandidates = []; signalQueue = Promise.resolve();
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
      el.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:10000;display:flex;background:rgba(0,0,0,0.85);flex-direction:column;align-items:center;justify-content:center;gap:1.5rem;';
      document.body.appendChild(el);
    }
    el.classList.remove('hidden');
    const avatarUrl = info.remoteAvatarUrl || 'https://api.dicebear.com/7.x/avataaars/svg?seed=' + encodeURIComponent(info.remoteDisplayName);
    const isIncoming = s === 'ringing-incoming';
    el.innerHTML =
      '<img src="' + avatarUrl + '" alt="" style="width:96px;height:96px;border-radius:50%;" onerror="this.style.display=\'none\'">' +
      '<div style="font-size:1.25rem;font-weight:600;color:white;">' + escapeHtml(info.remoteDisplayName) + '</div>' +
      '<div style="font-size:0.875rem;color:rgba(255,255,255,0.6);">' + (isIncoming ? 'Incoming call' : 'Calling...') + '</div>' +
      '<div style="display:flex;gap:2rem;margin-top:1rem;">' +
        '<button id="callDeclineBtn" style="width:56px;height:56px;border-radius:50%;border:none;background:#ef4444;cursor:pointer;color:white;font-size:20px;">&#x2716;</button>' +
        (isIncoming ? '<button id="callAcceptBtn" style="width:56px;height:56px;border-radius:50%;border:none;background:#22c55e;cursor:pointer;color:white;font-size:20px;">&#x260E;</button>' : '') +
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
