import type {
  VoiceConfig, VoiceSessionState, Signal, InvitationInfo,
  StateChangeCallback, SignalHandler, SessionStatus,
} from './types.js'
import { SignalBus } from './signal-bus.js'
import { P2PEngine } from './p2p.js'
import { SfuEngine } from './sfu.js'

const DEFAULTS = {
  apiBase: '/api/voice',
  escalateAt: 5,
  escalateOnScreenShare: true,
  invitationTimeoutMs: 30000,
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ] as RTCIceServer[],
  speakingThreshold: 15,
  connectTimeoutMs: 15000,
}

export class VoiceSession {
  private config: VoiceConfig
  private bus: SignalBus
  private p2p: P2PEngine | null = null
  private sfu: SfuEngine | null = null
  private backend: 'p2p' | 'sfu' | null = null
  private localUserId: string | null = null
  private displayName: string | null = null
  private roomName: string | null = null
  private listeners: StateChangeCallback[] = []
  private invitationTimer: ReturnType<typeof setTimeout> | null = null

  private _state: VoiceSessionState = {
    status: 'disconnected',
    backend: null,
    muted: false,
    deafened: false,
    speaking: false,
    screenSharing: false,
    screenShareTrack: null,
    screenSharePeerId: null,
    peers: [],
    invitation: null,
    error: null,
  }

  constructor(config: VoiceConfig) {
    this.config = config
    this.bus = new SignalBus(
      config.apiBase ?? DEFAULTS.apiBase,
      config.getAuthToken,
    )
  }

  get state(): Readonly<VoiceSessionState> {
    return this._state
  }

  /** Subscribe to state changes */
  onStateChange(callback: StateChangeCallback): () => void {
    this.listeners.push(callback)
    return () => { this.listeners = this.listeners.filter(l => l !== callback) }
  }

  /**
   * Subscribe to a specific signal type.
   * WebRTC and invitation signals are handled internally —
   * this is for any additional app-specific signal types.
   */
  onSignal(type: string, handler: SignalHandler): () => void {
    return this.bus.on(type, handler)
  }

  /** Send a signal to a target user (any type) */
  async sendSignal(signal: Signal): Promise<void> {
    await this.bus.send(signal)
  }

  /**
   * Connect to a voice session and open the signal stream.
   * For rooms (no invitation config): peers connect immediately via addPeer().
   * For calls (with invitation config): use invite() after connecting.
   */
  async connect(
    localUserId: string,
    displayName: string,
    roomName?: string,
  ): Promise<void> {
    this.localUserId = localUserId
    this.displayName = displayName
    this.roomName = roomName ?? null

    this.setState({ status: 'connecting', error: null })

    try {
      await this.bus.connect()

      // Listen for invitation signals if invitation mode is enabled
      if (this.hasInvitation()) {
        this.bus.on('invite', (s) => this.handleIncomingInvite(s))
        this.bus.on('invite_accepted', (s) => { void this.handleInviteAccepted(s) })
        this.bus.on('invite_declined', () => this.handleInviteDeclined())
        this.bus.on('invite_cancelled', () => this.handleInviteCancelled())
      }

      if (!this.hasInvitation()) {
        // Rooms: start engine immediately
        if (this.config.mode === 'sfu-only') {
          await this.startSfu()
        } else {
          await this.startP2P()
        }
        this.setState({ status: 'connected' })
      } else {
        // Calls: engine starts after acceptance, just mark as connected to signal bus
        this.setState({ status: 'connected' })
      }
    } catch (err) {
      this.bus.close()
      this.setState({
        status: 'disconnected',
        error: err instanceof Error ? err.message : 'Connection failed',
      })
      throw err
    }
  }

  /**
   * Invite a peer to connect (only when invitation config is set).
   * Sends an invitation signal and starts the ring timeout.
   */
  async invite(peerId: string, metadata?: Record<string, unknown>): Promise<void> {
    if (!this.hasInvitation() || !this.localUserId) return
    if (this._state.status !== 'connected') return

    const info: InvitationInfo = {
      remoteUserId: peerId,
      metadata: metadata ?? {},
    }

    await this.bus.send({
      targetUserId: peerId,
      type: 'invite',
      payload: {
        ...info.metadata,
        sender_display_name: this.displayName,
      },
    })

    this.setState({ status: 'inviting', invitation: info })

    // Ring timeout
    const timeoutMs = this.getInvitationTimeout()
    this.invitationTimer = setTimeout(() => {
      if (this._state.status === 'inviting') {
        void this.cancelInvitation()
      }
    }, timeoutMs)
  }

  /** Accept an incoming invitation */
  async accept(): Promise<void> {
    if (this._state.status !== 'invited' || !this._state.invitation) return

    const remoteUserId = this._state.invitation.remoteUserId

    await this.bus.send({
      targetUserId: remoteUserId,
      type: 'invite_accepted',
      payload: {},
    })

    this.setState({ status: 'active' })

    // Start P2P — we're the accepter, so we wait for the inviter's offer
    await this.startP2P()
    this.p2p?.addPeer(remoteUserId, { initiator: false })
  }

  /** Decline an incoming invitation */
  async decline(): Promise<void> {
    if (this._state.status !== 'invited' || !this._state.invitation) return

    await this.bus.send({
      targetUserId: this._state.invitation.remoteUserId,
      type: 'invite_declined',
      payload: {},
    })

    this.setState({ status: 'connected', invitation: null })
  }

  /** Cancel an outgoing invitation */
  async cancelInvitation(): Promise<void> {
    if (this._state.status !== 'inviting' || !this._state.invitation) return
    this.clearInvitationTimer()

    await this.bus.send({
      targetUserId: this._state.invitation.remoteUserId,
      type: 'invite_cancelled',
      payload: {},
    })

    this.setState({ status: 'connected', invitation: null })
  }

  /** End the session — works for both rooms and calls */
  disconnect(): void {
    // If we're in an active invitation, cancel/end it
    if (this._state.status === 'inviting' && this._state.invitation) {
      this.bus.send({
        targetUserId: this._state.invitation.remoteUserId,
        type: 'invite_cancelled',
        payload: {},
      }).catch(() => {})
    } else if (this._state.status === 'active' && this._state.invitation) {
      this.bus.send({
        targetUserId: this._state.invitation.remoteUserId,
        type: 'invite_cancelled',
        payload: {},
      }).catch(() => {})
    }

    this.clearInvitationTimer()
    if (this.backend === 'p2p') this.p2p?.stop()
    if (this.backend === 'sfu') this.sfu?.stop()
    this.p2p = null
    this.sfu = null
    this.backend = null
    this.bus.close()
    this.localUserId = null
    this.displayName = null
    this.roomName = null

    this.setState({
      status: 'disconnected', backend: null,
      muted: false, deafened: false, speaking: false,
      screenSharing: false, screenShareTrack: null, screenSharePeerId: null,
      peers: [], invitation: null, error: null,
    })
  }

  /**
   * Add a peer (rooms only — calls use invite/accept).
   * In P2P mode, initiates WebRTC. In SFU mode, no-op.
   */
  addPeer(peerId: string, options?: { initiator?: boolean }): void {
    if (this.backend === 'p2p') {
      this.p2p?.addPeer(peerId, options)

      if (this.config.mode === 'auto' && this.p2p) {
        const total = this.p2p.getPeerCount() + 1
        if (total >= (this.config.escalateAt ?? DEFAULTS.escalateAt)) {
          void this.escalateToSfu()
        }
      }
    }
  }

  removePeer(peerId: string): void {
    if (this.backend === 'p2p') {
      this.p2p?.removePeer(peerId)
    }
  }

  setMuted(muted: boolean): void {
    if (this.backend === 'p2p') this.p2p?.setMuted(muted)
    else if (this.backend === 'sfu') void this.sfu?.setMuted(muted)
    this.setState({ muted })
  }

  setDeafened(deafened: boolean): void {
    if (this.backend === 'p2p') this.p2p?.setDeafened(deafened)
    else if (this.backend === 'sfu') void this.sfu?.setDeafened(deafened)
    this.setState({ deafened })
    if (deafened && !this._state.muted) this.setMuted(true)
  }

  async setScreenShareEnabled(enabled: boolean): Promise<void> {
    if (this.backend === 'p2p' && enabled) {
      const shouldEscalate = this.config.mode === 'auto'
        && (this.config.escalateOnScreenShare ?? DEFAULTS.escalateOnScreenShare)
      if (shouldEscalate) {
        await this.p2p?.sendEscalateSignal()
        await this.escalateToSfu()
      }
    }
    if (this.backend === 'sfu') {
      await this.sfu?.setScreenShareEnabled(enabled)
    }
  }

  destroy(): void {
    this.disconnect()
    this.listeners = []
  }

  // --- Internal: invitation handling ---

  private hasInvitation(): boolean {
    return this.config.invitation === true || (typeof this.config.invitation === 'object' && this.config.invitation !== null)
  }

  private getInvitationTimeout(): number {
    if (typeof this.config.invitation === 'object' && this.config.invitation?.timeoutMs) {
      return this.config.invitation.timeoutMs
    }
    return DEFAULTS.invitationTimeoutMs
  }

  private clearInvitationTimer(): void {
    if (this.invitationTimer) {
      clearTimeout(this.invitationTimer)
      this.invitationTimer = null
    }
  }

  private handleIncomingInvite(signal: Signal): void {
    // Ignore if we're not in a state to receive invitations
    if (this._state.status !== 'connected') return

    this.setState({
      status: 'invited',
      invitation: {
        remoteUserId: signal.senderUserId ?? '',
        metadata: signal.payload,
      },
    })

    // Auto-decline after timeout
    const timeoutMs = this.getInvitationTimeout()
    this.invitationTimer = setTimeout(() => {
      if (this._state.status === 'invited') {
        void this.decline()
      }
    }, timeoutMs)
  }

  private async handleInviteAccepted(signal: Signal): Promise<void> {
    if (this._state.status !== 'inviting' || !this._state.invitation) return
    this.clearInvitationTimer()

    const remoteUserId = this._state.invitation.remoteUserId
    this.setState({ status: 'active' })

    // Start P2P — we're the inviter, so we send the offer
    await this.startP2P()
    this.p2p?.addPeer(remoteUserId, { initiator: true })
  }

  private handleInviteDeclined(): void {
    if (this._state.status !== 'inviting') return
    this.clearInvitationTimer()
    this.setState({ status: 'connected', invitation: null })
  }

  private handleInviteCancelled(): void {
    if (this._state.status !== 'invited') return
    this.clearInvitationTimer()
    this.setState({ status: 'connected', invitation: null })
  }

  // --- Internal: engine management ---

  private async startP2P(): Promise<void> {
    if (!this.localUserId) throw new Error('Not configured')

    this.p2p = new P2PEngine(
      {
        onPeersChanged: (peers) => this.setState({ peers }),
        onLocalSpeakingChanged: (speaking) => this.setState({ speaking }),
        onEscalateRequested: () => {
          if (this.config.mode === 'auto') void this.escalateToSfu()
        },
      },
      this.config.iceServers ?? DEFAULTS.iceServers,
      this.config.speakingThreshold ?? DEFAULTS.speakingThreshold,
    )

    await this.p2p.start(this.localUserId, this.bus)
    this.backend = 'p2p'
    this.setState({ backend: 'p2p' })
  }

  private async startSfu(): Promise<void> {
    if (!this.localUserId || !this.config.sfu) {
      throw new Error('SFU not configured')
    }

    this.sfu = new SfuEngine(this.config.sfu, {
      onPeersChanged: (peers) => this.setState({ peers }),
      onLocalSpeakingChanged: (speaking) => this.setState({ speaking }),
      onScreenShareChanged: (track, peerId) => {
        this.setState({
          screenSharing: track !== null,
          screenShareTrack: track,
          screenSharePeerId: peerId,
        })
      },
      onDisconnected: () => this.disconnect(),
    })

    await this.sfu.start(
      this.localUserId,
      this.roomName ?? this.localUserId,
      this.displayName ?? this.localUserId,
    )
    this.backend = 'sfu'
    this.setState({ backend: 'sfu' })
  }

  private async escalateToSfu(): Promise<void> {
    if (this.backend !== 'p2p' || !this.config.sfu) return

    const prevStatus = this._state.status
    this.setState({ status: 'connecting' })
    try {
      await this.startSfu()
      this.p2p?.stop()
      this.p2p = null
      this.setState({ status: prevStatus, muted: false })
    } catch (err) {
      this.setState({
        status: prevStatus,
        error: err instanceof Error ? err.message : 'Failed to escalate to SFU',
      })
    }
  }

  private setState(partial: Partial<VoiceSessionState>): void {
    this._state = { ...this._state, ...partial }
    for (const listener of this.listeners) {
      try { listener(this._state) } catch { /* listener error */ }
    }
  }
}
