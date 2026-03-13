import { $ } from '../lib/utils.js';

let toastHideTimer = null;
let toastFadeTimer = null;
let audioCtx = null;

function playNotifSound() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(440, audioCtx.currentTime + 0.15);
    gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.3);
    osc.start(audioCtx.currentTime);
    osc.stop(audioCtx.currentTime + 0.3);
  } catch (e) {
    // Audio context may not be available
  }
}

export function showToast(message) {
  const toast = $('toast');
  if (!toast) return;

  clearTimeout(toastHideTimer);
  clearTimeout(toastFadeTimer);

  $('toastMessage').textContent = message;
  toast.classList.remove('hidden');
  requestAnimationFrame(() => toast.classList.add('show'));

  toastHideTimer = setTimeout(() => {
    toast.classList.remove('show');
    toastFadeTimer = setTimeout(() => toast.classList.add('hidden'), 300);
  }, 3000);

  playNotifSound();
}
