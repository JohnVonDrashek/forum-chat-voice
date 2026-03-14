import type { Signal, PeerState } from './types.js'
import type { SignalBus } from './signal-bus.js'

const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
]

interface P2PPeer {
  pc: RTCPeerConnection
  audioEl: HTMLAudioElement | null
  speaking: boolean
  speakingDetector: { ctx: AudioContext; interval: ReturnType<typeof setInterval> } | null
}

export interface P2PCallbacks {
  onPeersChanged: (peers: PeerState[]) => void
  onLocalSpeakingChanged: (speaking: boolean) => void
  onEscalateRequested: () => void
}

export class P2PEngine {
  private peers = new Map<string, P2PPeer>()
  private localStream: MediaStream | null = null
  private localUserId: string | null = null
  private bus: SignalBus | null = null
  private cleanups: (() => void)[] = []
  private localSpeakingDetector: { ctx: AudioContext; interval: ReturnType<typeof setInterval> } | null = null
  private iceServers: RTCIceServer[]
  private speakingThreshold: number
  private callbacks: P2PCallbacks

  constructor(
    callbacks: P2PCallbacks,
    iceServers?: RTCIceServer[],
    speakingThreshold?: number,
  ) {
    this.callbacks = callbacks
    this.iceServers = iceServers ?? DEFAULT_ICE_SERVERS
    this.speakingThreshold = speakingThreshold ?? 15
  }

  async start(localUserId: string, bus: SignalBus): Promise<void> {
    this.localUserId = localUserId
    this.bus = bus

    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (err: unknown) {
      const name = err instanceof DOMException ? err.name : ''
      throw new Error(name === 'NotAllowedError' ? 'Microphone permission denied' : 'Failed to access microphone')
    }

    this.startLocalSpeakingDetection()

    // Subscribe to WebRTC signal types
    this.cleanups.push(bus.on('offer', (s) => { void this.handleSignal(s) }))
    this.cleanups.push(bus.on('answer', (s) => { void this.handleSignal(s) }))
    this.cleanups.push(bus.on('ice-candidate', (s) => { void this.handleSignal(s) }))
    this.cleanups.push(bus.on('escalate', () => this.callbacks.onEscalateRequested()))
  }

  stop(): void {
    for (const [, peer] of this.peers) {
      peer.pc.close()
      peer.audioEl?.remove()
      if (peer.speakingDetector) {
        clearInterval(peer.speakingDetector.interval)
        peer.speakingDetector.ctx.close().catch(() => {})
      }
    }
    this.peers.clear()

    if (this.localStream) {
      this.localStream.getTracks().forEach(t => t.stop())
      this.localStream = null
    }

    if (this.localSpeakingDetector) {
      clearInterval(this.localSpeakingDetector.interval)
      this.localSpeakingDetector.ctx.close().catch(() => {})
      this.localSpeakingDetector = null
    }

    for (const cleanup of this.cleanups) cleanup()
    this.cleanups = []
    this.bus = null
    this.localUserId = null
  }

  /** Add a peer. Offer direction is lexicographic by user ID unless `initiator` is specified. */
  addPeer(peerId: string, options?: { initiator?: boolean }): void {
    if (!this.localUserId || !this.bus || this.peers.has(peerId)) return
    if (peerId === this.localUserId) return

    const isInitiator = options?.initiator ?? (this.localUserId < peerId)
    if (isInitiator) {
      void this.createAndSendOffer(peerId)
    }
  }

  removePeer(peerId: string): void {
    const peer = this.peers.get(peerId)
    if (!peer) return
    peer.pc.close()
    peer.audioEl?.remove()
    if (peer.speakingDetector) {
      clearInterval(peer.speakingDetector.interval)
      peer.speakingDetector.ctx.close().catch(() => {})
    }
    this.peers.delete(peerId)
    this.emitPeers()
  }

  setMuted(muted: boolean): void {
    this.localStream?.getAudioTracks().forEach(t => { t.enabled = !muted })
  }

  setDeafened(deafened: boolean): void {
    for (const [, peer] of this.peers) {
      if (peer.audioEl) peer.audioEl.muted = deafened
    }
  }

  getPeerCount(): number {
    return this.peers.size
  }

  async sendEscalateSignal(): Promise<void> {
    if (!this.bus) return
    for (const [peerId] of this.peers) {
      await this.bus.send({ targetUserId: peerId, type: 'escalate', payload: {} })
    }
  }

  // --- Internal ---

  private async createAndSendOffer(targetUserId: string): Promise<void> {
    const pc = this.createPeerConnection(targetUserId)
    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)

    await this.bus?.send({
      targetUserId,
      type: 'offer',
      payload: { sdp: pc.localDescription!.sdp, type: pc.localDescription!.type },
    })
  }

  private createPeerConnection(remoteUserId: string): RTCPeerConnection {
    const pc = new RTCPeerConnection({ iceServers: this.iceServers })

    if (this.localStream) {
      this.localStream.getTracks().forEach(t => pc.addTrack(t, this.localStream!))
    }

    pc.ontrack = (event) => {
      const stream = event.streams[0] || new MediaStream([event.track])
      const existing = this.peers.get(remoteUserId)
      let audioEl = existing?.audioEl
      if (!audioEl) {
        audioEl = new Audio()
        audioEl.id = `voice-p2p-${remoteUserId}`
        audioEl.autoplay = true
        document.body.appendChild(audioEl)
      }
      audioEl.srcObject = stream
      if (existing) existing.audioEl = audioEl

      this.startRemoteSpeakingDetection(remoteUserId, stream)
    }

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        void this.bus?.send({
          targetUserId: remoteUserId,
          type: 'ice-candidate',
          payload: event.candidate.toJSON() as Record<string, unknown>,
        })
      }
    }

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        this.removePeer(remoteUserId)
      } else if (pc.connectionState === 'connected') {
        this.emitPeers()
      }
    }

    const audioEl = this.peers.get(remoteUserId)?.audioEl ?? null
    this.peers.set(remoteUserId, { pc, audioEl, speaking: false, speakingDetector: null })
    return pc
  }

  private async handleSignal(signal: Signal): Promise<void> {
    const senderUserId = signal.senderUserId ?? ''
    const { type, payload } = signal

    if (type === 'offer') {
      const existing = this.peers.get(senderUserId)
      const pc = existing ? existing.pc : this.createPeerConnection(senderUserId)

      await pc.setRemoteDescription(new RTCSessionDescription(payload as unknown as RTCSessionDescriptionInit))
      const answer = await pc.createAnswer()
      await pc.setLocalDescription(answer)

      await this.bus?.send({
        targetUserId: senderUserId,
        type: 'answer',
        payload: { sdp: pc.localDescription!.sdp, type: pc.localDescription!.type },
      })
    } else if (type === 'answer') {
      const peer = this.peers.get(senderUserId)
      if (peer) {
        await peer.pc.setRemoteDescription(new RTCSessionDescription(payload as unknown as RTCSessionDescriptionInit))
      }
    } else if (type === 'ice-candidate') {
      const peer = this.peers.get(senderUserId)
      if (peer) {
        await peer.pc.addIceCandidate(new RTCIceCandidate(payload as RTCIceCandidateInit)).catch(() => {})
      }
    }
  }

  private emitPeers(): void {
    const peers: PeerState[] = []
    for (const [id, peer] of this.peers) {
      const s = peer.pc.connectionState
      if (s === 'connected' || s === 'connecting') {
        peers.push({ id, speaking: peer.speaking, muted: false })
      }
    }
    this.callbacks.onPeersChanged(peers)
  }

  private startLocalSpeakingDetection(): void {
    if (!this.localStream || this.localSpeakingDetector) return
    try {
      const ctx = new AudioContext()
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 512
      ctx.createMediaStreamSource(this.localStream).connect(analyser)

      const buf = new Uint8Array(analyser.frequencyBinCount)
      let was = false

      const interval = setInterval(() => {
        analyser.getByteFrequencyData(buf)
        const avg = buf.reduce((a, b) => a + b, 0) / buf.length
        const now = avg > this.speakingThreshold
        if (now !== was) { was = now; this.callbacks.onLocalSpeakingChanged(now) }
      }, 100)

      this.localSpeakingDetector = { ctx, interval }
    } catch { /* AudioContext unavailable */ }
  }

  private startRemoteSpeakingDetection(userId: string, stream: MediaStream): void {
    const peer = this.peers.get(userId)
    if (!peer || peer.speakingDetector) return
    try {
      const ctx = new AudioContext()
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 512
      ctx.createMediaStreamSource(stream).connect(analyser)

      const buf = new Uint8Array(analyser.frequencyBinCount)
      let was = false

      const interval = setInterval(() => {
        analyser.getByteFrequencyData(buf)
        const avg = buf.reduce((a, b) => a + b, 0) / buf.length
        const now = avg > this.speakingThreshold
        if (now !== was) { was = now; peer.speaking = now; this.emitPeers() }
      }, 100)

      peer.speakingDetector = { ctx, interval }
    } catch { /* AudioContext unavailable */ }
  }
}
