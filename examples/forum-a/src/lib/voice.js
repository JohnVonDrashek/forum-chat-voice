/**
 * Voice module — LiveKit integration with presence tracking.
 */

import { createStore } from '../state.js'
import { authStore, getAccessToken } from './auth.js'
import { connectSSE } from './sse.js'

let livekitModule = null
async function getLivekit() {
  if (!livekitModule) livekitModule = await import('livekit-client')
  return livekitModule
}

export const voiceStore = createStore({
  isConnected: false,
  isConnecting: false,
  isMuted: false,
  isDeafened: false,
  isSpeaking: false,
  connectedRoomSlug: null,
  connectedRoomName: null,
  connectError: null,
  participants: [],
  isScreenSharing: false,
  screenShareParticipant: null,
  screenShareTrack: null,
  roomParticipantCounts: {},
})

let room = null
let accessTokenCached = null
const avatarCache = {}
let presenceSSECleanup = null

function updateParticipants() {
  if (!room || !livekitModule) return
  const lk = livekitModule
  const remotes = Array.from(room.remoteParticipants.values()).map(p => {
    const audioTrack = p.getTrackPublications().find(t => t.track?.source === lk.Track.Source.Microphone)
    return {
      id: p.identity,
      name: p.name || p.identity,
      avatar: (p.name || p.identity).charAt(0).toUpperCase(),
      avatarUrl: avatarCache[p.identity] ?? null,
      isSpeaking: p.isSpeaking,
      isMuted: audioTrack?.isMuted ?? true,
    }
  })
  voiceStore.set({
    participants: remotes,
    isSpeaking: room.localParticipant.isSpeaking,
  })

  // Fetch avatars for uncached participants
  const uncached = remotes.filter(p => avatarCache[p.id] === undefined)
  if (uncached.length > 0) {
    const ids = uncached.map(p => p.id).join(',')
    fetch(`/api/profiles/batch?ids=${encodeURIComponent(ids)}`)
      .then(r => r.json())
      .then(data => {
        for (const profile of data) avatarCache[profile.id] = profile.avatar_url
        for (const p of uncached) {
          if (avatarCache[p.id] === undefined) avatarCache[p.id] = null
        }
        updateParticipants()
      })
      .catch(() => {})
  }
}

function deletePresence() {
  const token = accessTokenCached
  if (token) {
    fetch('/api/voice-presence', {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` },
      keepalive: true,
    }).catch(() => {})
  }
}

export async function fetchVoicePresence() {
  try {
    const res = await fetch('/api/voice-presence')
    if (!res.ok) return
    const data = await res.json()

    const counts = {}
    for (const row of data) {
      if (!counts[row.room_slug]) counts[row.room_slug] = { count: 0, names: [], identities: [] }
      counts[row.room_slug].count++
      counts[row.room_slug].identities.push(row.user_id)
      const name = row.profile?.display_name || row.profile?.username || row.user_id.slice(0, 8)
      counts[row.room_slug].names.push(name)
      if (row.profile && avatarCache[row.user_id] === undefined) {
        avatarCache[row.user_id] = row.profile.avatar_url
      }
    }
    voiceStore.set({ roomParticipantCounts: counts })
  } catch {}
}

export async function joinRoom(slug, name) {
  const { user } = authStore.get()
  if (!user) return

  if (voiceStore.get().connectedRoomSlug === slug && room) return

  if (room) { room.disconnect(); room = null }

  voiceStore.set({ connectError: null, isConnecting: true })

  try {
    const accessToken = await getAccessToken()
    if (!accessToken) { voiceStore.set({ connectError: 'Not authenticated', isConnecting: false }); return }

    const displayName = user.username || user.user_metadata?.username || user.email.split('@')[0]

    const resp = await fetch('/api/livekit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
      body: JSON.stringify({ roomName: slug, participantName: displayName }),
    })
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: 'Failed to get token' }))
      voiceStore.set({ connectError: err.error || 'Failed to get token', isConnecting: false })
      return
    }

    const { token } = await resp.json()
    accessTokenCached = accessToken

    const livekitUrl = import.meta.env.VITE_LIVEKIT_URL
    if (!livekitUrl) { voiceStore.set({ connectError: 'LiveKit URL not configured', isConnecting: false }); return }

    const lk = await getLivekit()
    room = new lk.Room()

    room.on(lk.RoomEvent.ParticipantConnected, updateParticipants)
    room.on(lk.RoomEvent.ParticipantDisconnected, updateParticipants)
    room.on(lk.RoomEvent.TrackMuted, updateParticipants)
    room.on(lk.RoomEvent.TrackUnmuted, updateParticipants)
    room.on(lk.RoomEvent.ActiveSpeakersChanged, updateParticipants)

    room.on(lk.RoomEvent.TrackSubscribed, (track, _pub, participant) => {
      if (track.kind === lk.Track.Kind.Audio) {
        const stream = new MediaStream([track.mediaStreamTrack])
        const ctx = new AudioContext()
        const source = ctx.createMediaStreamSource(stream)
        const merger = ctx.createChannelMerger(2)
        source.connect(merger, 0, 0)
        source.connect(merger, 0, 1)
        const dest = ctx.createMediaStreamDestination()
        merger.connect(dest)
        const el = new Audio()
        el.id = `lk-audio-${track.sid}`
        el.srcObject = dest.stream
        el.autoplay = true
        document.body.appendChild(el)
      }
      if (track.source === lk.Track.Source.ScreenShare && track.kind === lk.Track.Kind.Video) {
        voiceStore.set({
          screenShareTrack: track.mediaStreamTrack,
          screenShareParticipant: { id: participant.identity, name: participant.name || participant.identity },
        })
      }
    })

    room.on(lk.RoomEvent.TrackUnsubscribed, (track) => {
      if (track.source === lk.Track.Source.ScreenShare && track.kind === lk.Track.Kind.Video) {
        voiceStore.set({ screenShareTrack: null, screenShareParticipant: null })
      }
      track.detach().forEach(el => el.remove())
    })

    room.on(lk.RoomEvent.LocalTrackPublished, (pub) => {
      if (pub.track?.source === lk.Track.Source.ScreenShare && pub.track.kind === lk.Track.Kind.Video) {
        voiceStore.set({
          isScreenSharing: true,
          screenShareTrack: pub.track.mediaStreamTrack,
          screenShareParticipant: { id: room.localParticipant.identity, name: room.localParticipant.name || room.localParticipant.identity },
        })
      }
    })

    room.on(lk.RoomEvent.LocalTrackUnpublished, (pub) => {
      if (pub.source === lk.Track.Source.ScreenShare) {
        voiceStore.set({ isScreenSharing: false, screenShareTrack: null, screenShareParticipant: null })
      }
    })

    room.on(lk.RoomEvent.Disconnected, () => {
      voiceStore.set({
        isConnected: false, participants: [], connectedRoomSlug: null, connectedRoomName: null,
        isMuted: false, isDeafened: false, isSpeaking: false,
        isScreenSharing: false, screenShareTrack: null, screenShareParticipant: null,
      })
      room = null
      deletePresence()
    })

    await room.connect(livekitUrl, token)
    await room.localParticipant.setMicrophoneEnabled(true)

    voiceStore.set({
      isConnected: true, isConnecting: false, isMuted: false, isDeafened: false,
      connectedRoomSlug: slug, connectedRoomName: name,
    })
    updateParticipants()

    // Write presence
    const h = await getAccessToken()
    if (h) {
      fetch('/api/voice-presence', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${h}` },
        body: JSON.stringify({ room_slug: slug }),
      }).catch(() => {})
    }
  } catch (err) {
    voiceStore.set({ connectError: err instanceof Error ? err.message : 'Failed to connect', isConnecting: false })
    room = null
  }
}

export function leaveRoom() {
  if (room) {
    room.remoteParticipants.forEach(p => {
      p.getTrackPublications().forEach(pub => {
        if (pub.track) pub.track.detach().forEach(el => el.remove())
      })
    })
    room.disconnect()
    room = null
  }
  deletePresence()
  voiceStore.set({
    isConnected: false, isConnecting: false, participants: [],
    connectedRoomSlug: null, connectedRoomName: null,
    isMuted: false, isDeafened: false, isSpeaking: false,
    isScreenSharing: false, screenShareTrack: null, screenShareParticipant: null, connectError: null,
  })
  accessTokenCached = null
}

export async function toggleMute() {
  if (!room) return
  const newMuted = !voiceStore.get().isMuted
  await room.localParticipant.setMicrophoneEnabled(!newMuted)
  voiceStore.set({ isMuted: newMuted })
}

export function toggleDeafen() {
  if (!room || !livekitModule) return
  const lk = livekitModule
  const newDeafened = !voiceStore.get().isDeafened
  room.remoteParticipants.forEach(p => {
    p.getTrackPublications().forEach(pub => {
      if (pub.track && pub.track.source === lk.Track.Source.Microphone) {
        if (newDeafened) pub.track.detach()
        else {
          const el = pub.track.attach()
          el.id = `audio-${p.identity}`
          if (!document.getElementById(el.id)) document.body.appendChild(el)
        }
      }
    })
  })
  voiceStore.set({ isDeafened: newDeafened })
  if (newDeafened && !voiceStore.get().isMuted) {
    room.localParticipant.setMicrophoneEnabled(false)
    voiceStore.set({ isMuted: true })
  }
}

export async function toggleScreenShare() {
  if (!room) return
  try {
    await room.localParticipant.setScreenShareEnabled(!voiceStore.get().isScreenSharing)
  } catch {}
}

export function getAvatarUrl(identity) {
  return avatarCache[identity] ?? null
}

export function initVoice() {
  fetchVoicePresence()
  presenceSSECleanup = connectSSE('/api/voice-presence/stream', () => fetchVoicePresence(), true)

  window.addEventListener('beforeunload', () => {
    deletePresence()
    if (room) room.disconnect()
  })
}

export function cleanupVoice() {
  if (presenceSSECleanup) presenceSSECleanup()
  if (room) { room.disconnect(); room = null }
}
