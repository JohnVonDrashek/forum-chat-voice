export interface VoiceConfig {
  /** 'p2p-only' for 1:1 calls, 'sfu-only' to always use LiveKit, 'auto' for smart switching */
  mode: 'p2p-only' | 'sfu-only' | 'auto'
  /** Signal endpoint base URL (default: '/api/voice'). POST to /signal, SSE from /signal/stream. */
  apiBase?: string
  /** Auth token getter (for SSE connection and signal POST requests) */
  getAuthToken: () => string | Promise<string>
  /** Enable invitation flow — peers must accept before WebRTC connects. */
  invitation?: InvitationConfig | boolean
  /** Escalate to SFU when participant count reaches this (default: 5). Only for 'auto' mode. */
  escalateAt?: number
  /** Escalate to SFU when screen sharing is requested (default: true). Only for 'auto' mode. */
  escalateOnScreenShare?: boolean
  /** ICE servers for P2P connections */
  iceServers?: RTCIceServer[]
  /** SFU configuration. Required for 'sfu-only' and 'auto' modes. */
  sfu?: SfuConfig
  /** Speaking detection FFT threshold (0-255, default: 15) */
  speakingThreshold?: number
  /** WebRTC connection timeout in ms (default: 15000) */
  connectTimeoutMs?: number
}

export interface InvitationConfig {
  /** How long to wait for acceptance before auto-cancelling (default: 30000) */
  timeoutMs?: number
}

export interface SfuConfig {
  /** LiveKit server URL */
  url: string
  /** Get a LiveKit JWT token for joining a room */
  getRoomToken: (roomName: string, participantName: string) => Promise<string>
}

export interface Signal {
  targetUserId: string
  senderUserId?: string
  type: string
  payload: Record<string, unknown>
}

export interface InvitationInfo {
  /** ID of the remote user */
  remoteUserId: string
  /** Any extra data sent with the invitation (display name, avatar, etc.) */
  metadata: Record<string, unknown>
}

export interface PeerState {
  id: string
  speaking: boolean
  /** Only reliable in SFU mode — P2P can't detect remote mute without data channels */
  muted: boolean
}

export type SessionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'     // rooms: immediate after connect
  | 'inviting'      // sent invitation, waiting for response
  | 'invited'       // received invitation, waiting for user action
  | 'active'        // invitation accepted, WebRTC connected

export interface VoiceSessionState {
  status: SessionStatus
  backend: 'p2p' | 'sfu' | null
  muted: boolean
  deafened: boolean
  speaking: boolean
  screenSharing: boolean
  screenShareTrack: MediaStreamTrack | null
  screenSharePeerId: string | null
  peers: PeerState[]
  /** Present when status is 'inviting' or 'invited' */
  invitation: InvitationInfo | null
  error: string | null
}

export type StateChangeCallback = (state: VoiceSessionState) => void
export type SignalHandler = (signal: Signal) => void
