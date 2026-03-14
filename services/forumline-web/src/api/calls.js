// ========== CALL MANAGER (Voice Calls) ==========
// Call lifecycle, ringtone, call overlay UI, native bridge.
// WebRTC handled by @forumline/shared-voice.

import { ForumlineAPI } from './client.js';
import { NativeBridge } from './native-bridge.js';
import { VoiceSession } from '@forumline/shared-voice';

let session = null;
let durationInterval = null;

// --- Call state (kept for UI compatibility) ---
const callState = {
  state: 'idle',
  callInfo: null,
  muted: false,
  duration: 0,
};

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

function getOrCreateSession() {
  if (session) return session;
  session = new VoiceSession({
    mode: 'p2p-only',
    invitation: { timeoutMs: 30000 },
    getAuthToken: () => ForumlineAPI.getToken(),
  });

  session.onStateChange((state) => {
    if (state.status === 'invited' && state.invitation) {
      const meta = state.invitation.metadata;
      setCallState('ringing-incoming', {
        callId: meta.call_id,
        conversationId: meta.conversation_id,
        remoteUserId: state.invitation.remoteUserId,
        remoteDisplayName: meta.caller_display_name || meta.caller_username || 'Unknown',
        remoteAvatarUrl: meta.caller_avatar_url || null,
      });
      NativeBridge.sendCallEvent('incoming', callState.callInfo);
    } else if (state.status === 'inviting') {
      // Already handled in initiateCall
    } else if (state.status === 'active') {
      if (callState.state !== 'active') {
        setCallState('active');
        NativeBridge.sendCallEvent('accepted', callState.callInfo);
        startDurationTimer();
      }
    } else if (state.status === 'connected' && callState.state !== 'idle') {
      // Invitation was declined/cancelled/timed out
      NativeBridge.sendCallEvent('ended', callState.callInfo);
      callCleanup();
    } else if (state.status === 'disconnected' && callState.state !== 'idle') {
      NativeBridge.sendCallEvent('ended', callState.callInfo);
      callCleanup();
    }
  });

  return session;
}

// --- Call lifecycle ---
async function initiateCall(conversationId, remoteUserId, remoteDisplayName, remoteAvatarUrl) {
  if (callState.state !== 'idle' || !ForumlineAPI.isAuthenticated()) return;

  // Create call record on server
  let result;
  try {
    result = await ForumlineAPI.apiFetch('/api/calls', {
      method: 'POST', body: JSON.stringify({ conversation_id: conversationId, callee_id: remoteUserId }),
    });
  } catch (err) {
    console.error('[Call] initiate failed:', err);
    return;
  }

  setCallState('ringing-outgoing', {
    callId: result.id, conversationId, remoteUserId,
    remoteDisplayName, remoteAvatarUrl: remoteAvatarUrl || null,
  });
  NativeBridge.sendCallEvent('outgoing', callState.callInfo);

  // Connect session and send invitation
  const s = getOrCreateSession();
  const userId = ForumlineAPI.getUserId();

  try {
    await s.connect(userId, remoteDisplayName, conversationId);
    await s.invite(remoteUserId, {
      call_id: result.id,
      conversation_id: conversationId,
      caller_display_name: remoteDisplayName,
    });
  } catch {
    callCleanup();
  }
}

async function acceptCall() {
  if (callState.state !== 'ringing-incoming' || !callState.callInfo) return;

  // Tell server we accepted
  try {
    await ForumlineAPI.apiFetch('/api/calls/' + callState.callInfo.callId + '/respond', {
      method: 'POST', body: JSON.stringify({ action: 'accept' }),
    });
  } catch { callCleanup(); return; }

  // Accept the voice session invitation (starts WebRTC)
  if (session) await session.accept();
}

async function declineCall() {
  if (callState.state !== 'ringing-incoming' || !callState.callInfo) return;

  try {
    await ForumlineAPI.apiFetch('/api/calls/' + callState.callInfo.callId + '/respond', {
      method: 'POST', body: JSON.stringify({ action: 'decline' }),
    });
  } catch {}

  if (session) await session.decline();
  NativeBridge.sendCallEvent('ended', callState.callInfo);
  callCleanup();
}

async function endCall() {
  if (!callState.callInfo) return;
  try {
    await ForumlineAPI.apiFetch('/api/calls/' + callState.callInfo.callId + '/end', { method: 'POST' });
  } catch {}
  NativeBridge.sendCallEvent('ended', callState.callInfo);
  callCleanup();
}

function toggleCallMute() {
  callState.muted = !callState.muted;
  if (session) session.setMuted(callState.muted);
  notifyCallStateChange();
  return callState.muted;
}

function startDurationTimer() {
  if (durationInterval) clearInterval(durationInterval);
  callState.duration = 0;
  durationInterval = setInterval(() => { callState.duration++; notifyCallStateChange(); }, 1000);
}

function callCleanup() {
  if (durationInterval) { clearInterval(durationInterval); durationInterval = null; }
  if (session) { session.destroy(); session = null; }
  setCallState('idle', null);
}

function destroyCallManager() {
  callCleanup();
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
    const avatarUrl = info.remoteAvatarUrl || 'https://api.dicebear.com/7.x/avataaars/svg?seed=' + encodeURIComponent(info.remoteDisplayName);
    const isIncoming = s === 'ringing-incoming';
    el.innerHTML =
      '<img src="' + avatarUrl + '" alt="" style="width:56px;height:56px;border-radius:50%;" onerror="this.style.display=\'none\'">' +
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
    const userId = ForumlineAPI.getUserId();
    if (userId) {
      const s = getOrCreateSession();
      s.connect(userId, userId).catch(() => {});
    }
  }
}

function reconnectCallSSE() {
  if (session) { session.destroy(); session = null; }
  if (ForumlineAPI.isAuthenticated()) {
    const userId = ForumlineAPI.getUserId();
    if (userId) {
      const s = getOrCreateSession();
      s.connect(userId, userId).catch(() => {});
    }
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
