import { $ } from '../lib/utils.js';

let voiceSpeakingInterval = null;

export function renderVoiceParticipants() {
  const participants = [
    { name: 'testcaller', seed: 'testcaller', speaking: true },
    { name: 'testuser_debug', seed: 'testuser_debug', speaking: false },
    { name: 'alice_dev', seed: 'alice-dev', speaking: false },
  ];

  $('voiceParticipants').innerHTML = participants.map(p => `
    <div class="voice-participant ${p.speaking ? 'speaking' : ''}">
      <img src="https://api.dicebear.com/7.x/avataaars/svg?seed=${p.seed}" alt="">
      <span class="voice-participant-name">${p.name}</span>
    </div>
  `).join('');
}

export function startVoiceSpeakingAnimation() {
  if (voiceSpeakingInterval) return;
  voiceSpeakingInterval = setInterval(() => {
    const participants = $('voiceParticipants')?.querySelectorAll('.voice-participant');
    if (participants) {
      participants.forEach(p => {
        if (Math.random() > 0.7) {
          p.classList.toggle('speaking');
        }
      });
    }
  }, 2000);
}

export function stopVoiceSpeakingAnimation() {
  if (voiceSpeakingInterval) {
    clearInterval(voiceSpeakingInterval);
    voiceSpeakingInterval = null;
  }
}

export function initVoiceRoom() {
  $('voiceBtn')?.addEventListener('click', () => {
    $('voiceOverlay').classList.remove('hidden');
    const forumName = $('forumName')?.textContent || 'Lobby';
    $('voiceRoomTitle').textContent = 'Voice Room — ' + forumName;
    renderVoiceParticipants();
    startVoiceSpeakingAnimation();
  });

  $('voiceClose')?.addEventListener('click', () => {
    $('voiceOverlay').classList.add('hidden');
    stopVoiceSpeakingAnimation();
  });

  $('leaveBtn')?.addEventListener('click', () => {
    $('voiceOverlay').classList.add('hidden');
    stopVoiceSpeakingAnimation();
  });

  $('voiceOverlay')?.addEventListener('click', (e) => {
    if (e.target === $('voiceOverlay')) {
      $('voiceOverlay').classList.add('hidden');
      stopVoiceSpeakingAnimation();
    }
  });
}
