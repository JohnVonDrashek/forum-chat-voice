/**
 * 1:1 Call Manager — state machine + WebRTC + SSE signaling.
 * States: idle → ringing-outgoing/ringing-incoming → active → idle
 */

import { forumlineAuth } from '../app.js'
import type { ForumlineStore } from './forumline-store.js'
import { isTauri, getTauriNotification } from './tauri.js'

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
]

export type CallState = 'idle' | 'ringing-outgoing' | 'ringing-incoming' | 'active'

export interface CallInfo {
  callId: string
  conversationId: string
  remoteUserId: string
  remoteDisplayName: string
  remoteAvatarUrl: string | null
}

export type CallStateListener = (state: CallState, info: CallInfo | null) => void

let state: CallState = 'idle'
let callInfo: CallInfo | null = null
let pc: RTCPeerConnection | null = null
let localStream: MediaStream | null = null
let remoteAudioEl: HTMLAudioElement | null = null
let signalSSE: EventSource | null = null
let callTimer: ReturnType<typeof setTimeout> | null = null
let sseReconnectTimer: ReturnType<typeof setTimeout> | null = null
let sseReconnectAttempts = 0
let forumlineStore: ForumlineStore | null = null

const listeners = new Set<CallStateListener>()
let tauriActionCleanup: (() => void) | null = null

const CALL_NOTIFICATION_ID = 99001
const CALL_ACTION_TYPE_ID = 'incoming_call'
const CALL_CHANNEL_ID = 'calls'

export function initCallManager(store: ForumlineStore) {
  forumlineStore = store
  connectSignalSSE()
  setupTauriCallActions()
}

/** Register Tauri notification action types and channel for incoming calls. */
async function setupTauriCallActions() {
  if (!isTauri()) return
  try {
    const { registerActionTypes, onAction, createChannel, Importance } = await getTauriNotification()

    // Android: create a high-importance channel for call notifications
    await createChannel({
      id: CALL_CHANNEL_ID,
      name: 'Incoming Calls',
      description: 'Notifications for incoming voice calls',
      importance: Importance.High,
      vibration: true,
      sound: 'default',
    }).catch(() => {}) // No-op on iOS/desktop

    await registerActionTypes([{
      id: CALL_ACTION_TYPE_ID,
      actions: [
        { id: 'accept', title: 'Accept', foreground: true },
        { id: 'decline', title: 'Decline', destructive: true },
      ],
    }])

    const listener = await onAction((event: any) => {
      // Only handle actions from our call notification
      if (event.notification?.id !== CALL_NOTIFICATION_ID) return
      const actionId = event.actionId ?? ''
      if (actionId === 'accept') acceptCall()
      else if (actionId === 'decline') declineCall()
    })

    tauriActionCleanup = () => listener.unregister()
  } catch (err) {
    console.error('[Call] Failed to setup Tauri call actions:', err)
  }
}

/** Show a native Tauri notification for an incoming call. */
async function showNativeCallNotification(callerName: string) {
  if (!isTauri()) return
  try {
    const { sendNotification, isPermissionGranted, requestPermission } = await getTauriNotification()
    let permitted = await isPermissionGranted()
    if (!permitted) {
      const result = await requestPermission()
      permitted = result === 'granted'
    }
    if (!permitted) return

    sendNotification({
      id: CALL_NOTIFICATION_ID,
      channelId: CALL_CHANNEL_ID,
      title: `Incoming call from ${callerName}`,
      body: 'Tap to answer',
      actionTypeId: CALL_ACTION_TYPE_ID,
      sound: 'default',
    })
  } catch (err) {
    console.error('[Call] Failed to show native notification:', err)
  }
}

/** Dismiss the native call notification. */
async function dismissNativeCallNotification() {
  if (!isTauri()) return
  try {
    const { removeActive } = await getTauriNotification()
    await removeActive([CALL_NOTIFICATION_ID])
  } catch {}
}

export function onCallStateChange(fn: CallStateListener): () => void {
  listeners.add(fn)
  fn(state, callInfo)
  return () => listeners.delete(fn)
}

function notify() {
  for (const fn of listeners) fn(state, callInfo)
}

function setState(newState: CallState, info: CallInfo | null = callInfo) {
  state = newState
  callInfo = info
  notify()
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
      handleSignal(signal)
    } catch {}
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

async function handleSignal(signal: any) {
  const { type } = signal

  if (type === 'incoming_call') {
    if (state !== 'idle') return // busy
    setState('ringing-incoming', {
      callId: signal.call_id,
      conversationId: signal.conversation_id,
      remoteUserId: signal.caller_id,
      remoteDisplayName: signal.caller_display_name || signal.caller_username || 'Unknown',
      remoteAvatarUrl: signal.caller_avatar_url || null,
    })
    // Show native notification (Tauri) for incoming call
    showNativeCallNotification(signal.caller_display_name || signal.caller_username || 'Unknown')

    // Auto-dismiss after 30s
    callTimer = setTimeout(() => {
      if (state === 'ringing-incoming') cleanup()
    }, 30000)
    return
  }

  if (type === 'call_accepted') {
    if (state !== 'ringing-outgoing') return
    // Callee accepted — start WebRTC (we are the caller, so we send the offer)
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
    const answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)
    await sendSignal('answer', { sdp: pc.localDescription!.sdp, type: pc.localDescription!.type })
    return
  }

  if (type === 'answer') {
    if (!pc) return
    await pc.setRemoteDescription(new RTCSessionDescription(signal.payload))
    return
  }

  if (type === 'ice-candidate') {
    if (!pc) return
    await pc.addIceCandidate(new RTCIceCandidate(signal.payload)).catch(() => {})
    return
  }
}

// --- Outgoing call ---

export async function initiateCall(conversationId: string, remoteUserId: string, remoteDisplayName: string, remoteAvatarUrl: string | null) {
  if (state !== 'idle') return
  const { forumlineClient } = forumlineStore!.get()
  if (!forumlineClient) return

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
      if (state === 'ringing-outgoing') endCall()
    }, 30000)
  } catch (err: any) {
    console.error('[Call] Failed to initiate call:', err)
  }
}

// --- Respond to incoming call ---

export async function acceptCall() {
  if (state !== 'ringing-incoming' || !callInfo) return
  const { forumlineClient } = forumlineStore!.get()
  if (!forumlineClient) return

  if (callTimer) { clearTimeout(callTimer); callTimer = null }
  dismissNativeCallNotification()

  try {
    await forumlineClient.respondToCall(callInfo.callId, 'accept')
    setState('active')
    // We are the callee — wait for the offer from caller
    await startWebRTC(false)
  } catch (err) {
    console.error('[Call] Failed to accept call:', err)
    cleanup()
  }
}

export async function declineCall() {
  if (state !== 'ringing-incoming' || !callInfo) return
  const { forumlineClient } = forumlineStore!.get()
  if (!forumlineClient) return

  if (callTimer) { clearTimeout(callTimer); callTimer = null }

  try {
    await forumlineClient.respondToCall(callInfo.callId, 'decline')
  } catch {}
  cleanup()
}

// --- End call ---

export async function endCall() {
  if (!callInfo) return
  const { forumlineClient } = forumlineStore!.get()
  if (!forumlineClient) return

  try {
    await forumlineClient.endCall(callInfo.callId)
  } catch {}
  cleanup()
}

// --- Toggle mute ---

let muted = false
export function toggleMute(): boolean {
  muted = !muted
  if (localStream) {
    localStream.getAudioTracks().forEach(t => { t.enabled = !muted })
  }
  return muted
}

export function isMuted(): boolean {
  return muted
}

// --- WebRTC ---

async function startWebRTC(isInitiator: boolean) {
  if (!callInfo) return

  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true })
  } catch (err) {
    console.error('[Call] Failed to get microphone:', err)
    endCall()
    return
  }

  muted = false

  pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })

  localStream.getTracks().forEach(t => pc!.addTrack(t, localStream!))

  pc.ontrack = (event) => {
    const stream = event.streams[0] || new MediaStream([event.track])
    if (!remoteAudioEl) {
      remoteAudioEl = new Audio()
      remoteAudioEl.autoplay = true
      document.body.appendChild(remoteAudioEl)
    }
    remoteAudioEl.srcObject = stream
  }

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      sendSignal('ice-candidate', event.candidate.toJSON())
    }
  }

  pc.onconnectionstatechange = () => {
    if (pc?.connectionState === 'failed' || pc?.connectionState === 'closed') {
      endCall()
    }
  }

  if (isInitiator) {
    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    await sendSignal('offer', { sdp: pc.localDescription!.sdp, type: pc.localDescription!.type })
  }
}

async function sendSignal(type: string, payload: any) {
  if (!callInfo) return
  const { forumlineClient } = forumlineStore!.get()
  if (!forumlineClient) return

  try {
    await forumlineClient.sendCallSignal(callInfo.callId, callInfo.remoteUserId, type, payload)
  } catch (err) {
    console.error('[Call] Failed to send signal:', err)
  }
}

function cleanup() {
  if (callTimer) { clearTimeout(callTimer); callTimer = null }
  dismissNativeCallNotification()

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

  muted = false
  setState('idle', null)
}

export function destroyCallManager() {
  cleanup()
  if (sseReconnectTimer) { clearTimeout(sseReconnectTimer); sseReconnectTimer = null }
  if (signalSSE) {
    signalSSE.close()
    signalSSE = null
  }
  if (tauriActionCleanup) { tauriActionCleanup(); tauriActionCleanup = null }
  listeners.clear()
}

export function getCallState(): CallState { return state }
export function getCallInfo(): CallInfo | null { return callInfo }
