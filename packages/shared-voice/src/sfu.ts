import type { SfuConfig, PeerState } from './types.js'

export interface SfuCallbacks {
  onPeersChanged: (peers: PeerState[]) => void
  onLocalSpeakingChanged: (speaking: boolean) => void
  onScreenShareChanged: (track: MediaStreamTrack | null, peerId: string | null) => void
  onDisconnected: () => void
}

// Lazy-load livekit-client — only pulled in when SFU mode is actually used
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let lk: any = null
async function getLiveKit() {
  if (!lk) {
    try {
      lk = await import('livekit-client')
    } catch {
      throw new Error('livekit-client is required for SFU mode — install it as a dependency')
    }
  }
  return lk
}

export class SfuEngine {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private room: any = null
  private config: SfuConfig
  private callbacks: SfuCallbacks

  constructor(config: SfuConfig, callbacks: SfuCallbacks) {
    this.config = config
    this.callbacks = callbacks
  }

  async start(localUserId: string, roomName: string, displayName: string): Promise<void> {
    const LiveKit = await getLiveKit()
    const token = await this.config.getRoomToken(roomName, displayName)

    this.room = new LiveKit.Room()

    this.room.on(LiveKit.RoomEvent.ParticipantConnected, () => this.updatePeers())
    this.room.on(LiveKit.RoomEvent.ParticipantDisconnected, () => this.updatePeers())
    this.room.on(LiveKit.RoomEvent.TrackMuted, () => this.updatePeers())
    this.room.on(LiveKit.RoomEvent.TrackUnmuted, () => this.updatePeers())
    this.room.on(LiveKit.RoomEvent.ActiveSpeakersChanged, () => this.updatePeers())

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.room.on(LiveKit.RoomEvent.TrackSubscribed, (track: any, _pub: any, participant: any) => {
      if (track.kind === LiveKit.Track.Kind.Audio) {
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
      if (track.source === LiveKit.Track.Source.ScreenShare && track.kind === LiveKit.Track.Kind.Video) {
        this.callbacks.onScreenShareChanged(track.mediaStreamTrack, participant.identity)
      }
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.room.on(LiveKit.RoomEvent.TrackUnsubscribed, (track: any) => {
      if (track.source === LiveKit.Track.Source.ScreenShare && track.kind === LiveKit.Track.Kind.Video) {
        this.callbacks.onScreenShareChanged(null, null)
      }
      track.detach().forEach((el: HTMLMediaElement) => el.remove())
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.room.on(LiveKit.RoomEvent.LocalTrackPublished, (pub: any) => {
      if (pub.track?.source === LiveKit.Track.Source.ScreenShare && pub.track.kind === LiveKit.Track.Kind.Video) {
        this.callbacks.onScreenShareChanged(
          pub.track.mediaStreamTrack,
          this.room.localParticipant.identity,
        )
      }
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.room.on(LiveKit.RoomEvent.LocalTrackUnpublished, (pub: any) => {
      if (pub.source === LiveKit.Track.Source.ScreenShare) {
        this.callbacks.onScreenShareChanged(null, null)
      }
    })

    this.room.on(LiveKit.RoomEvent.Disconnected, () => {
      this.room = null
      this.callbacks.onDisconnected()
    })

    await this.room.connect(this.config.url, token)
    await this.room.localParticipant.setMicrophoneEnabled(true)
    this.updatePeers()
  }

  stop(): void {
    if (!this.room) return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.room.remoteParticipants.forEach((p: any) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      p.getTrackPublications().forEach((pub: any) => {
        if (pub.track) pub.track.detach().forEach((el: HTMLMediaElement) => el.remove())
      })
    })
    this.room.disconnect()
    this.room = null
  }

  async setMuted(muted: boolean): Promise<void> {
    await this.room?.localParticipant.setMicrophoneEnabled(!muted)
  }

  async setDeafened(deafened: boolean): Promise<void> {
    if (!this.room || !lk) return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.room.remoteParticipants.forEach((p: any) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      p.getTrackPublications().forEach((pub: any) => {
        if (pub.track && pub.track.source === lk.Track.Source.Microphone) {
          if (deafened) {
            pub.track.detach()
          } else {
            const el = pub.track.attach()
            el.id = `audio-${p.identity}`
            if (!document.getElementById(el.id)) document.body.appendChild(el)
          }
        }
      })
    })
  }

  async setScreenShareEnabled(enabled: boolean): Promise<void> {
    await this.room?.localParticipant.setScreenShareEnabled(enabled)
  }

  private updatePeers(): void {
    if (!this.room || !lk) return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const peers: PeerState[] = Array.from(this.room.remoteParticipants.values()).map((p: any) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const audioTrack = p.getTrackPublications().find((t: any) => t.track?.source === lk.Track.Source.Microphone)
      return {
        id: p.identity,
        speaking: p.isSpeaking,
        muted: audioTrack?.isMuted ?? true,
      }
    })
    this.callbacks.onPeersChanged(peers)
    this.callbacks.onLocalSpeakingChanged(this.room.localParticipant.isSpeaking)
  }
}
