// ========== CALL UI (Overlays & Ringtone) ==========
// Visual call overlay rendering and Web Audio ringtone.
// Subscribes to CallManager state changes from @forumline/client-sdk.

import { CallManager } from '@forumline/client-sdk';
import { avatarUrl } from '../lib/avatar.js';

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
  let stopped = false,
    timeout = null,
    curOsc = null,
    curGain = null;

  function tone(freq, dur) {
    return new Promise(resolve => {
      if (stopped) {
        resolve();
        return;
      }
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.value = 0.15;
      osc.connect(gain);
      gain.connect(ctx.destination);
      curOsc = osc;
      curGain = gain;
      osc.start();
      timeout = setTimeout(() => {
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.05);
        setTimeout(() => {
          osc.stop();
          osc.disconnect();
          gain.disconnect();
          curOsc = null;
          curGain = null;
          resolve();
        }, 50);
      }, dur);
    });
  }
  function pause(ms) {
    return new Promise(r => {
      if (stopped) {
        r();
        return;
      }
      timeout = setTimeout(r, ms);
    });
  }

  async function loop() {
    while (!stopped) {
      if (type === 'incoming') {
        await tone(440, 200);
        await pause(100);
        await tone(440, 200);
        await pause(2000);
      } else {
        await tone(440, 1000);
        await pause(3000);
      }
    }
  }
  ctx.resume().then(loop);

  return () => {
    stopped = true;
    if (timeout) clearTimeout(timeout);
    if (curOsc) {
      try {
        curOsc.stop();
      } catch {}
      curOsc.disconnect();
    }
    if (curGain) curGain.disconnect();
  };
}

// --- Call UI overlays ---
let stopRingtoneRef = null;

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDuration(s) {
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

function renderCallUI() {
  const callState = CallManager.callState;
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
      el.style.cssText =
        'position:fixed;top:16px;right:16px;z-index:10000;display:flex;background:rgba(30,30,30,0.95);flex-direction:column;align-items:center;padding:1.25rem 1.5rem;gap:0.75rem;border-radius:16px;box-shadow:0 8px 32px rgba(0,0,0,0.4);min-width:220px;backdrop-filter:blur(12px);';
      document.body.appendChild(el);
    }
    el.classList.remove('hidden');
    const callAvatar = info.remoteAvatarUrl || avatarUrl(info.remoteDisplayName);
    const isIncoming = s === 'ringing-incoming';
    el.innerHTML =
      '<img src="' +
      callAvatar +
      '" alt="" style="width:56px;height:56px;border-radius:50%;" onerror="this.style.display=\'none\'">' +
      '<div style="font-size:0.95rem;font-weight:600;color:white;">' +
      escapeHtml(info.remoteDisplayName) +
      '</div>' +
      '<div style="font-size:0.75rem;color:rgba(255,255,255,0.5);">' +
      (isIncoming ? 'Incoming call' : 'Calling...') +
      '</div>' +
      '<div style="display:flex;gap:1rem;margin-top:0.5rem;">' +
      '<button id="callDeclineBtn" style="width:40px;height:40px;border-radius:50%;border:none;background:#ef4444;cursor:pointer;color:white;font-size:16px;">&#x2716;</button>' +
      (isIncoming
        ? '<button id="callAcceptBtn" style="width:40px;height:40px;border-radius:50%;border:none;background:#22c55e;cursor:pointer;color:white;font-size:16px;">&#x260E;</button>'
        : '') +
      '</div>';
    el.querySelector('#callDeclineBtn').addEventListener('click', () =>
      isIncoming ? CallManager.declineCall() : CallManager.endCall(),
    );
    if (isIncoming)
      el.querySelector('#callAcceptBtn').addEventListener('click', () => CallManager.acceptCall());
    return;
  }

  if (s === 'active') {
    const overlay = document.getElementById('incomingCallOverlay');
    if (overlay) overlay.classList.add('hidden');
    let bar = document.getElementById('activeCallBar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'activeCallBar';
      bar.style.cssText =
        'position:fixed;top:0;left:0;right:0;z-index:10001;display:flex;align-items:center;gap:0.75rem;padding:0.5rem 1rem;background:#22c55e;color:white;font-size:0.875rem;';
      document.body.appendChild(bar);
    }
    bar.classList.remove('hidden');
    bar.innerHTML =
      '<span style="font-weight:600;">' +
      formatDuration(callState.duration) +
      '</span>' +
      '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' +
      escapeHtml(info.remoteDisplayName) +
      '</span>' +
      '<button id="callMuteBtn" style="background:none;border:none;color:white;cursor:pointer;padding:0.25rem;opacity:' +
      (callState.muted ? '0.5' : '1') +
      ';" title="' +
      (callState.muted ? 'Unmute' : 'Mute') +
      '">' +
      (callState.muted ? '&#x1F507;' : '&#x1F3A4;') +
      '</button>' +
      '<button id="callEndBtn" style="background:#ef4444;border:none;color:white;cursor:pointer;padding:0.25rem 0.5rem;border-radius:1rem;font-size:0.75rem;font-weight:600;">End</button>';
    bar.querySelector('#callMuteBtn').addEventListener('click', e => {
      e.stopPropagation();
      CallManager.toggleCallMute();
    });
    bar.querySelector('#callEndBtn').addEventListener('click', e => {
      e.stopPropagation();
      CallManager.endCall();
    });
  }
}

// React to call state changes for ringtone and UI
let prevCallUIState = 'idle';
CallManager.onCallStateChange(() => {
  const s = CallManager.callState.state;
  if (prevCallUIState !== s && stopRingtoneRef) {
    stopRingtoneRef();
    stopRingtoneRef = null;
  }
  if (s === 'ringing-outgoing' && prevCallUIState !== 'ringing-outgoing')
    stopRingtoneRef = playRingtone('outgoing');
  else if (s === 'ringing-incoming' && prevCallUIState !== 'ringing-incoming')
    stopRingtoneRef = playRingtone('incoming');
  prevCallUIState = s;
  renderCallUI();
});

export function initCallUI() {
  warmAudioContext();
}
