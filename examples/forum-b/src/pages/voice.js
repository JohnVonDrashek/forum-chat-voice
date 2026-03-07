import { api } from '../lib/api.js'
import { authStore } from '../lib/auth.js'
import { voiceStore, joinRoom, leaveRoom, toggleMute, toggleDeafen, toggleScreenShare, getAvatarUrl } from '../lib/voice.js'
import { avatarHTML } from '../components/avatar.js'

export function renderVoice(container, { roomId } = {}) {
  const { user } = authStore.get()

  function render() {
    const voice = voiceStore.get()
    api.getVoiceRooms().then(rooms => {
      const selectedRoom = roomId ? rooms.find(r => r.id === roomId || r.slug === roomId) : null
      if (selectedRoom) renderFocusedRoom(container, selectedRoom, voice, user)
      else renderRoomList(container, rooms, voice, user)
      bindEventHandlers(container, voice)
    })
  }

  render()
  const unsub = voiceStore.subscribe(render)
  return () => unsub()
}

function renderRoomList(container, rooms, voice, user) {
  container.innerHTML = `
    <div class="gothic-box">
      <div class="gothic-box-header">~ Voice Rooms ~</div>
      <div class="gothic-box-content">
        ${voice.isConnected ? renderActiveRoomBar(voice) : ''}
        ${voice.connectError ? `<div style="margin-bottom:8px;padding:6px;border:1px solid var(--accent-red);color:var(--accent-red);font-size:12px">${escapeHTML(voice.connectError)}</div>` : ''}
        <div style="display:grid;gap:8px;grid-template-columns:repeat(auto-fill,minmax(200px,1fr))">
          ${rooms.map(r => renderRoomCard(r, voice, user)).join('')}
        </div>
      </div>
    </div>
  `
}

function renderFocusedRoom(container, room, voice, user) {
  const isConnected = voice.isConnected && voice.connectedRoomSlug === room.slug
  const info = voice.roomParticipantCounts[room.slug]

  container.innerHTML = `
    <div style="margin-bottom:8px"><a href="/voice" class="link-pink" style="font-size:12px">&larr; All Voice Rooms</a></div>
    <div class="gothic-box">
      <div class="gothic-box-header" style="display:flex;align-items:center;gap:6px">
        <svg style="width:14px;height:14px;color:${isConnected ? 'var(--accent-green)' : 'var(--text-muted)'}" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"/></svg>
        ~ ${escapeHTML(room.name)} ~
        ${isConnected ? `<span style="color:var(--accent-green);font-size:10px;margin-left:auto">${voice.participants.length + 1} connected</span>`
          : info && info.count > 0 ? `<span style="color:var(--text-muted);font-size:10px;margin-left:auto">${info.count} online</span>`
          : '<span style="color:var(--text-muted);font-size:10px;margin-left:auto">Empty</span>'}
      </div>
      <div class="gothic-box-content">
        ${isConnected ? renderConnectedView(voice, user) : renderDisconnectedView(room, voice, user, info)}
      </div>
    </div>
    ${voice.connectError ? `<div style="margin-top:8px;padding:6px;border:1px solid var(--accent-red);color:var(--accent-red);font-size:12px">${escapeHTML(voice.connectError)}</div>` : ''}
  `
}

function renderConnectedView(voice, user) {
  return `
    ${voice.screenShareTrack ? `
      <div style="margin-bottom:8px;background:black;border:1px solid var(--border-main)">
        <div style="font-size:10px;color:var(--text-muted);padding:4px 8px">${escapeHTML(voice.screenShareParticipant?.name || '')} is sharing their screen</div>
        <video id="screen-share-video" autoplay playsinline style="width:100%"></video>
      </div>
    ` : ''}
    <div class="voice-participant-grid" style="margin-bottom:12px">
      <div class="voice-participant ${voice.isSpeaking ? 'speaking' : ''} ${voice.isMuted ? 'muted' : ''}">
        ${avatarHTML({ avatarUrl: user?.avatar, size: 32 })}
        <div class="voice-participant-name">${escapeHTML(user?.username || 'You')}</div>
      </div>
      ${voice.participants.map(p => `
        <div class="voice-participant ${p.isSpeaking ? 'speaking' : ''} ${p.isMuted ? 'muted' : ''}">
          ${avatarHTML({ avatarUrl: p.avatarUrl, size: 32 })}
          <div class="voice-participant-name">${escapeHTML(p.name)}</div>
        </div>
      `).join('')}
    </div>
    <div class="voice-controls">
      <button id="voice-mute" class="btn btn-small ${voice.isMuted ? 'btn-danger' : ''}">${voice.isMuted ? 'Unmute' : 'Mute'}</button>
      <button id="voice-deafen" class="btn btn-small ${voice.isDeafened ? 'btn-danger' : ''}">${voice.isDeafened ? 'Undeafen' : 'Deafen'}</button>
      <button id="voice-share" class="btn btn-small" ${voice.isScreenSharing ? 'style="border-color:var(--accent-green);color:var(--accent-green)"' : ''}>${voice.isScreenSharing ? 'Stop Share' : 'Share Screen'}</button>
      <button id="voice-disconnect" class="btn btn-danger btn-small">Disconnect</button>
    </div>
  `
}

function renderDisconnectedView(room, voice, user, info) {
  return `
    ${info && info.count > 0 ? `
      <div style="margin-bottom:12px">
        <div style="font-size:12px;color:var(--text-muted);margin-bottom:6px">Currently in this room:</div>
        <div class="flex flex-wrap gap-1">
          ${info.identities.map((id, i) => `
            <div class="flex items-center gap-1" style="background:var(--bg-input);border:1px solid var(--border-main);padding:4px 8px;font-size:12px">
              ${avatarHTML({ avatarUrl: getAvatarUrl(id), size: 20 })}
              ${escapeHTML(info.names?.[i] || 'User')}
            </div>
          `).join('')}
        </div>
      </div>
    ` : `<div class="empty-state" style="padding:16px"><p>No one is here yet. Be the first to join!</p></div>`}
    ${user ? `
      <button class="join-btn btn btn-primary" style="width:100%" data-slug="${room.slug}" data-name="${escapeHTML(room.name)}" data-is-active="false">
        ${voice.isConnecting ? 'Connecting...' : 'Join Voice'}
      </button>
    ` : '<p style="text-align:center;font-size:12px;color:var(--text-muted)"><a href="/login" class="link-pink">Sign in</a> to join voice rooms</p>'}
  `
}

function renderActiveRoomBar(voice) {
  return `
    <div style="margin-bottom:8px;padding:6px 8px;border:1px dashed var(--accent-green);display:flex;align-items:center;justify-content:space-between">
      <div class="flex items-center gap-1">
        <span style="width:6px;height:6px;border-radius:50%;background:var(--accent-green);display:inline-block"></span>
        <span style="font-size:12px;color:var(--accent-green)">Connected to ${escapeHTML(voice.connectedRoomName || '')}</span>
        <span style="font-size:10px;color:var(--text-muted)">${voice.participants.length + 1} participants</span>
      </div>
      <button id="voice-disconnect" style="font-size:10px;color:var(--accent-red);background:none;border:none;font-family:var(--font-main);cursor:pointer">[disconnect]</button>
    </div>
  `
}

function renderRoomCard(r, voice, user) {
  const info = voice.roomParticipantCounts[r.slug]
  const isActive = voice.connectedRoomSlug === r.slug
  return `
    <a href="/voice/${r.id}" class="voice-room-card ${isActive ? 'active' : ''}">
      <div class="flex items-center justify-between" style="margin-bottom:4px">
        <div class="flex items-center gap-1">
          <svg style="width:14px;height:14px;color:${isActive ? 'var(--accent-green)' : 'var(--text-muted)'}" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"/></svg>
          <span style="font-weight:bold;font-size:13px">${escapeHTML(r.name)}</span>
        </div>
        ${info && info.count > 0 ? `<span style="font-size:11px;color:var(--accent-green)">${info.count} online</span>` : ''}
      </div>
      ${info && info.count > 0 ? `
        <div class="flex flex-wrap gap-1">
          ${info.identities.slice(0, 5).map(id => avatarHTML({ avatarUrl: getAvatarUrl(id), size: 20 })).join('')}
          ${info.count > 5 ? `<span style="font-size:10px;color:var(--text-muted);align-self:center">+${info.count - 5}</span>` : ''}
        </div>
      ` : `<span style="font-size:10px;color:var(--text-muted)">Empty</span>`}
    </a>
  `
}

function bindEventHandlers(container, voice) {
  container.querySelectorAll('.join-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault()
      if (btn.dataset.isActive === 'true') leaveRoom()
      else joinRoom(btn.dataset.slug, btn.dataset.name)
    })
  })
  container.querySelector('#voice-mute')?.addEventListener('click', toggleMute)
  container.querySelector('#voice-deafen')?.addEventListener('click', toggleDeafen)
  container.querySelector('#voice-share')?.addEventListener('click', toggleScreenShare)
  container.querySelector('#voice-disconnect')?.addEventListener('click', leaveRoom)

  if (voice.screenShareTrack) {
    const video = container.querySelector('#screen-share-video')
    if (video) video.srcObject = new MediaStream([voice.screenShareTrack])
  }
}

function escapeHTML(str) {
  const div = document.createElement('div')
  div.textContent = str || ''
  return div.innerHTML
}
