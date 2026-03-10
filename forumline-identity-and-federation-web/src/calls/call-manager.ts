/*
 * Voice call manager
 *
 * This file manages the entire lifecycle of 1:1 voice calls between Forumline users.
 *
 * It must:
 * - Maintain a call state machine (idle, ringing-outgoing, ringing-incoming, active)
 * - Listen for incoming call signals via a persistent SSE connection with auto-reconnect
 * - Initiate outgoing calls by acquiring the microphone and notifying the server
 * - Accept or decline incoming calls and notify the server of the response
 * - Establish peer-to-peer audio via WebRTC with STUN servers for NAT traversal
 * - Exchange WebRTC offers, answers, and ICE candidates through the Forumline signaling API
 * - Handle ICE restarts for transient network disruptions
 * - Time out unanswered calls after 30 seconds (both incoming and outgoing)
 * - Time out WebRTC connections that fail to establish within 15 seconds
 * - Provide mute/unmute toggle for the local microphone
 * - Fall back to a synthetic silent audio stream when no microphone is available
 * - Expose a VanX reactive object so UI consumers can bind directly to call state
 * - Clean up all WebRTC, media, and SSE resources when a call ends
 */
import { forumlineAuth } from '../app.js'
import type { ForumlineStore } from '../shared/forumline-store.js'
import { reactive, noreactive } from 'vanjs-ext'

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
]

/**
 * Acquire microphone, falling back to a synthetic silent audio stream
 * when no mic is available (e.g., iOS Simulator, CI environments).
 */
async function acquireMic(): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: true })
  } catch {
    // No mic available — generate a silent audio stream so the call
    // flow (signaling, UI, WebRTC negotiation) still works.
    const ctx = new AudioContext()
    const oscillator = ctx.createOscillator()
    const dest = ctx.createMediaStreamDestination()
    const gain = ctx.createGain()
    gain.gain.value = 0 // silent
    oscillator.connect(gain)
    gain.connect(dest)
    oscillator.start()
    return dest.stream
  }
}

export type CallState = 'idle' | 'ringing-outgoing' | 'ringing-incoming' | 'active'

export interface CallInfo {
  callId: string
  conversationId: string
  remoteUserId: string
  remoteDisplayName: string
  remoteAvatarUrl: string | null
}

// --- Reactive state (UI reads from this directly) ---

export const callState = reactive({
  state: 'idle' as CallState,
  callInfo: null as CallInfo | null,
  muted: false,
})

// --- Non-reactive module variables (WebRTC, media, timers) ---

let pc: RTCPeerConnection | null = null
let localStream: MediaStream | null = null
let remoteAudioEl: HTMLAudioElement | null = null
let signalSSE: EventSource | null = null
let callTimer: ReturnType<typeof setTimeout> | null = null
let sseReconnectTimer: ReturnType<typeof setTimeout> | null = null
let sseReconnectAttempts = 0
let forumlineStore: ForumlineStore | null = null
let pendingCandidates: RTCIceCandidateInit[] = []
let webrtcStarted = false
let signalQueue: Promise<void> = Promise.resolve()
let iceRestartAttempted = false

export function initCallManager(store: ForumlineStore) {
  forumlineStore = store
  connectSignalSSE()
}

function setState(newState: CallState, info: CallInfo | null = callState.callInfo) {
  callState.state = newState
  callState.callInfo = info ? noreactive(info) : null
}

// --- SSE for incoming call signals ---

function connectSignalSSE() {
  if (signalSSE) return
  const session = forumlineAuth.getSession()
  if (!session) return

  const url = `/api/calls/stream?access_token=${encodeURIComponent(session.access_token)}`
  signalSSE = new EventSource(url)

  signalSSE.onopen = () => { sseReconnectAttempts = 0 }

  signalSSE.onmessage = (event) => {
    try {
      const signal = JSON.parse(event.data)
      // Serialize signal handling — each signal must fully complete before
      // the next starts. WebRTC operations (setRemoteDescription, createAnswer,
      // addIceCandidate) must not run concurrently or Safari drops the connection.
      signalQueue = signalQueue.then(() => handleSignal(signal)).catch(err => {
        console.error('[Call] handleSignal error:', err)
      })
    } catch (err) {
      console.error('[Call] SSE parse error:', err)
    }
  }

  signalSSE.onerror = () => {
    signalSSE?.close()
    signalSSE = null
    // Exponential backoff with jitter: 1s, 2s, 4s... capped at 30s
    const base = Math.min(1000 * Math.pow(2, sseReconnectAttempts), 30000)
    const jitter = Math.random() * base * 0.3
    sseReconnectAttempts++
    sseReconnectTimer = setTimeout(connectSignalSSE, base + jitter)
  }
}

async function handleSignal(signal: Record<string, unknown>) {
  const { type } = signal

  if (type === 'incoming_call') {
    if (callState.state !== 'idle') return // busy
    setState('ringing-incoming', {
      callId: signal.call_id,
      conversationId: signal.conversation_id,
      remoteUserId: signal.caller_id,
      remoteDisplayName: signal.caller_display_name || signal.caller_username || 'Unknown',
      remoteAvatarUrl: signal.caller_avatar_url || null,
    })
    // Auto-dismiss after 30s
    callTimer = setTimeout(() => {
      if (callState.state === 'ringing-incoming') cleanup()
    }, 30000)
    return
  }

  if (type === 'call_accepted') {
    if (callState.state !== 'ringing-outgoing') return
    setState('active')
    await startWebRTC(true)
    return
  }

  if (type === 'call_declined' || type === 'call_ended') {
    cleanup()
    return
  }

  // WebRTC signaling
  if (type === 'offer') {
    if (!pc) await startWebRTC(false)
    if (!pc) return
    await pc.setRemoteDescription(new RTCSessionDescription(signal.payload))
    // Apply any ICE candidates that arrived before the offer
    for (const candidate of pendingCandidates) {
      await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {})
    }
    pendingCandidates = []
    const answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)
    await sendSignal('answer', { sdp: pc.localDescription!.sdp, type: pc.localDescription!.type })
    return
  }

  if (type === 'answer') {
    if (!pc) return
    await pc.setRemoteDescription(new RTCSessionDescription(signal.payload))
    // Apply any ICE candidates that arrived before the answer
    for (const candidate of pendingCandidates) {
      await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {})
    }
    pendingCandidates = []
    return
  }

  if (type === 'ice-candidate') {
    if (!pc || !pc.remoteDescription) {
      pendingCandidates.push(signal.payload)
      return
    }
    await pc.addIceCandidate(new RTCIceCandidate(signal.payload)).catch(() => {})
    return
  }
}

// --- Outgoing call ---

export async function initiateCall(conversationId: string, remoteUserId: string, remoteDisplayName: string, remoteAvatarUrl: string | null) {
  if (callState.state !== 'idle') return
  const { forumlineClient } = forumlineStore!.get()
  if (!forumlineClient) return

  // Acquire mic NOW while we have the user gesture (click on call button).
  // This avoids permission issues when call_accepted arrives via SSE later.
  try {
    localStream = await acquireMic()
  } catch (err) {
    console.error('[Call] Microphone access denied:', err)
    return
  }

  try {
    const result = await forumlineClient.initiateCall(conversationId)
    setState('ringing-outgoing', {
      callId: result.id,
      conversationId,
      remoteUserId,
      remoteDisplayName,
      remoteAvatarUrl,
    })

    // Auto-cancel after 30s if not answered
    callTimer = setTimeout(() => {
      if (callState.state === 'ringing-outgoing') void endCall()
    }, 30000)
  } catch (err: unknown) {
    console.error('[Call] Failed to initiate call:', err)
    // Release mic if call initiation failed
    if (localStream) {
      localStream.getTracks().forEach(t => t.stop())
      localStream = null
    }
  }
}

// --- Respond to incoming call ---

export async function acceptCall() {
  if (callState.state !== 'ringing-incoming' || !callState.callInfo) return
  const { forumlineClient } = forumlineStore!.get()
  if (!forumlineClient) return

  if (callTimer) { clearTimeout(callTimer); callTimer = null }

  // Acquire mic NOW while we have the user gesture (Accept button click).
  // Must happen before any await, or Safari drops the gesture context.
  if (!localStream) {
    try {
      localStream = await acquireMic()
    } catch (err) {
      console.error('[Call] Microphone access denied:', err)
      cleanup()
      return
    }
  }

  try {
    await forumlineClient.respondToCall(callState.callInfo.callId, 'accept')
    setState('active')
    // We are the callee — DON'T start WebRTC here.
    // The offer will arrive via SSE and the offer handler will call startWebRTC(false).
    // This prevents a race where startWebRTC gets called twice.
  } catch (err) {
    console.error('[Call] Failed to accept call:', err)
    cleanup()
  }
}

export async function declineCall() {
  if (callState.state !== 'ringing-incoming' || !callState.callInfo) return
  const { forumlineClient } = forumlineStore!.get()
  if (!forumlineClient) return

  if (callTimer) { clearTimeout(callTimer); callTimer = null }

  try {
    await forumlineClient.respondToCall(callState.callInfo.callId, 'decline')
  } catch {}
  cleanup()
}

// --- End call ---

export async function endCall() {
  if (!callState.callInfo) return
  const { forumlineClient } = forumlineStore!.get()
  if (!forumlineClient) return

  try {
    await forumlineClient.endCall(callState.callInfo.callId)
  } catch {}
  cleanup()
}

// --- Toggle mute ---

export function toggleMute(): boolean {
  callState.muted = !callState.muted
  if (localStream) {
    localStream.getAudioTracks().forEach(t => { t.enabled = !callState.muted })
  }
  return callState.muted
}

// --- WebRTC ---

async function startWebRTC(isInitiator: boolean) {
  if (!callState.callInfo) return
  if (webrtcStarted) return
  webrtcStarted = true

  // Reuse localStream if already acquired (caller pre-acquires on button click)
  if (!localStream) {
    try {
      localStream = await acquireMic()
    } catch (err) {
      console.error('[Call] Failed to get microphone:', err)
      void endCall()
      return
    }
  }

  callState.muted = false

  pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })

  localStream.getTracks().forEach(t => pc!.addTrack(t, localStream!))

  pc.ontrack = (event) => {
    const stream = event.streams[0] || new MediaStream([event.track])
    if (!remoteAudioEl) {
      remoteAudioEl = new Audio()
      remoteAudioEl.autoplay = true
      // Safari: needed for audio to play even with autoplay attribute
      remoteAudioEl.playsInline = true
      document.body.appendChild(remoteAudioEl)
    }
    remoteAudioEl.srcObject = stream
    // Safari requires explicit play() — autoplay attribute alone is not enough
    // when the user gesture context has been consumed by getUserMedia earlier.
    remoteAudioEl.play().catch(err => {
      console.warn('[Call] Audio play() failed (autoplay policy):', err)
    })
  }

  pc.onicecandidate = (event) => {
    if (event.candidate) void sendSignal('ice-candidate', event.candidate.toJSON())
  }

  pc.oniceconnectionstatechange = () => {
    // ICE restart: if connection drops to "disconnected", try one restart
    // before giving up. Handles transient network blips and Safari quirks.
    if (pc?.iceConnectionState === 'disconnected' && !iceRestartAttempted) {
      iceRestartAttempted = true
      pc.createOffer({ iceRestart: true }).then(offer => {
        return pc!.setLocalDescription(offer)
      }).then(() => {
        return sendSignal('offer', { sdp: pc!.localDescription!.sdp, type: pc!.localDescription!.type })
      }).catch(err => {
        console.error('[Call] ICE restart failed:', err)
      })
    }
  }

  // Timeout: if WebRTC doesn't connect within 15s, end the call.
  // Prevents one side staying stuck if the other drops.
  const connectTimeout = setTimeout(() => {
    if (pc && pc.connectionState !== 'connected') {
      console.error('[Call] WebRTC connection timed out')
      void endCall()
    }
  }, 15000)

  pc.onconnectionstatechange = () => {
    if (pc?.connectionState === 'connected') {
      clearTimeout(connectTimeout)
    }
    if (pc?.connectionState === 'failed' || pc?.connectionState === 'closed') {
      clearTimeout(connectTimeout)
      void endCall()
    }
  }

  if (isInitiator) {
    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    await sendSignal('offer', { sdp: pc.localDescription!.sdp, type: pc.localDescription!.type })
  }
}

async function sendSignal(type: string, payload: unknown) {
  if (!callState.callInfo) return
  const { forumlineClient } = forumlineStore!.get()
  if (!forumlineClient) return

  try {
    await forumlineClient.sendCallSignal(callState.callInfo.callId, callState.callInfo.remoteUserId, type, payload)
  } catch (err) {
    console.error('[Call] Failed to send signal:', err)
  }
}

function cleanup() {
  if (callTimer) { clearTimeout(callTimer); callTimer = null }

  if (pc) {
    pc.close()
    pc = null
  }

  if (localStream) {
    localStream.getTracks().forEach(t => t.stop())
    localStream = null
  }

  if (remoteAudioEl) {
    remoteAudioEl.remove()
    remoteAudioEl = null
  }

  webrtcStarted = false
  iceRestartAttempted = false
  pendingCandidates = []
  signalQueue = Promise.resolve()
  setState('idle', null)
  // Reset muted after setState so the UI sees idle+unmuted together
  callState.muted = false
}

export function destroyCallManager() {
  cleanup()
  if (sseReconnectTimer) { clearTimeout(sseReconnectTimer); sseReconnectTimer = null }
  if (signalSSE) {
    signalSSE.close()
    signalSSE = null
  }
}
