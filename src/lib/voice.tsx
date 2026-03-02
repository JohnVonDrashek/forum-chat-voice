import { createContext, useContext, useState, useRef, useCallback, useEffect, ReactNode } from 'react'
import { Room, RoomEvent, Track, Participant } from 'livekit-client'
import { supabase, isConfigured } from './supabase'
import { useAuth } from './auth'

export interface VoiceParticipant {
  id: string
  name: string
  avatar: string
  isSpeaking: boolean
  isMuted: boolean
}

interface RoomParticipantInfo {
  count: number
  names: string[]
}

interface VoiceContextType {
  // Connection state
  isConnected: boolean
  isConnecting: boolean
  isMuted: boolean
  isDeafened: boolean
  connectedRoomSlug: string | null
  connectedRoomName: string | null
  connectError: string | null
  participants: VoiceParticipant[]

  // Sidebar data — participant counts for all rooms
  roomParticipantCounts: Record<string, RoomParticipantInfo>

  // Actions
  joinRoom: (slug: string, name: string) => Promise<void>
  leaveRoom: () => void
  toggleMute: () => Promise<void>
  toggleDeafen: () => void
}

const VoiceContext = createContext<VoiceContextType | undefined>(undefined)

function participantToVoice(p: Participant): VoiceParticipant {
  const audioTrack = p.getTrackPublications().find(
    t => t.track?.source === Track.Source.Microphone,
  )
  return {
    id: p.identity,
    name: p.name || p.identity,
    avatar: (p.name || p.identity).charAt(0).toUpperCase(),
    isSpeaking: p.isSpeaking,
    isMuted: audioTrack?.isMuted ?? true,
  }
}

export function VoiceProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const livekitRoomRef = useRef<Room | null>(null)

  const [isConnected, setIsConnected] = useState(false)
  const [isConnecting, setIsConnecting] = useState(false)
  const [isMuted, setIsMuted] = useState(false)
  const [isDeafened, setIsDeafened] = useState(false)
  const [connectedRoomSlug, setConnectedRoomSlug] = useState<string | null>(null)
  const [connectedRoomName, setConnectedRoomName] = useState<string | null>(null)
  const [connectError, setConnectError] = useState<string | null>(null)
  const [participants, setParticipants] = useState<VoiceParticipant[]>([])
  const [roomParticipantCounts, setRoomParticipantCounts] = useState<Record<string, RoomParticipantInfo>>({})

  // Ref to track connected room slug for use in polling without triggering re-renders
  const connectedRoomSlugRef = useRef<string | null>(null)

  const updateParticipants = useCallback(() => {
    const room = livekitRoomRef.current
    if (!room) return
    const remotes = Array.from(room.remoteParticipants.values()).map(participantToVoice)
    setParticipants(remotes)
  }, [])

  const leaveRoom = useCallback(() => {
    if (livekitRoomRef.current) {
      livekitRoomRef.current.disconnect()
      livekitRoomRef.current = null
    }
    setIsConnected(false)
    setParticipants([])
    setConnectedRoomSlug(null)
    setConnectedRoomName(null)
    setIsMuted(false)
    setIsDeafened(false)
    setConnectError(null)
    connectedRoomSlugRef.current = null
  }, [])

  const joinRoom = useCallback(async (slug: string, name: string) => {
    if (!isConfigured || !user) return

    // If already connected to this room, do nothing
    if (connectedRoomSlugRef.current === slug && livekitRoomRef.current) return

    // Disconnect from current room first
    if (livekitRoomRef.current) {
      livekitRoomRef.current.disconnect()
      livekitRoomRef.current = null
    }

    setConnectError(null)
    setIsConnecting(true)

    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) {
        setConnectError('Not authenticated')
        setIsConnecting(false)
        return
      }

      const displayName = user.username || user.user_metadata?.username || user.email.split('@')[0]

      const resp = await fetch('/api/livekit-token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          roomName: slug,
          participantName: displayName,
        }),
      })

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: 'Failed to get token' }))
        setConnectError(err.error || 'Failed to get token')
        setIsConnecting(false)
        return
      }

      const { token } = await resp.json()

      const livekitUrl = import.meta.env.VITE_LIVEKIT_URL as string | undefined
      if (!livekitUrl) {
        setConnectError('LiveKit URL not configured')
        setIsConnecting(false)
        return
      }

      const room = new Room()
      livekitRoomRef.current = room

      room.on(RoomEvent.ParticipantConnected, updateParticipants)
      room.on(RoomEvent.ParticipantDisconnected, updateParticipants)
      room.on(RoomEvent.TrackMuted, updateParticipants)
      room.on(RoomEvent.TrackUnmuted, updateParticipants)
      room.on(RoomEvent.ActiveSpeakersChanged, updateParticipants)
      room.on(RoomEvent.Disconnected, () => {
        setIsConnected(false)
        setParticipants([])
        setConnectedRoomSlug(null)
        setConnectedRoomName(null)
        setIsMuted(false)
        setIsDeafened(false)
        connectedRoomSlugRef.current = null
        livekitRoomRef.current = null
      })

      await room.connect(livekitUrl, token)
      await room.localParticipant.setMicrophoneEnabled(true)

      setIsConnected(true)
      setIsMuted(false)
      setIsDeafened(false)
      setConnectedRoomSlug(slug)
      setConnectedRoomName(name)
      connectedRoomSlugRef.current = slug
      updateParticipants()
    } catch (err) {
      setConnectError(err instanceof Error ? err.message : 'Failed to connect')
      livekitRoomRef.current = null
    } finally {
      setIsConnecting(false)
    }
  }, [user, updateParticipants])

  const toggleMute = useCallback(async () => {
    const room = livekitRoomRef.current
    if (!room) return
    const newMuted = !isMuted
    await room.localParticipant.setMicrophoneEnabled(!newMuted)
    setIsMuted(newMuted)
  }, [isMuted])

  const toggleDeafen = useCallback(() => {
    const room = livekitRoomRef.current
    if (!room) return
    const newDeafened = !isDeafened
    room.remoteParticipants.forEach(p => {
      p.getTrackPublications().forEach(pub => {
        if (pub.track && pub.track.source === Track.Source.Microphone) {
          if (newDeafened) {
            pub.track.detach()
          } else {
            const el = pub.track.attach()
            el.id = `audio-${p.identity}`
            if (!document.getElementById(el.id)) {
              document.body.appendChild(el)
            }
          }
        }
      })
    })
    setIsDeafened(newDeafened)
    if (newDeafened && !isMuted) {
      room.localParticipant.setMicrophoneEnabled(false)
      setIsMuted(true)
    }
  }, [isDeafened, isMuted])

  // Poll participant counts for all rooms (for sidebar)
  useEffect(() => {
    if (!isConfigured) return

    let cancelled = false

    const fetchCounts = async () => {
      try {
        // First get the list of rooms from Supabase
        const { data: rooms } = await supabase
          .from('voice_rooms')
          .select('slug')
          .order('name')

        if (!rooms || cancelled) return

        const results = await Promise.all(
          rooms.map(async (room) => {
            try {
              const resp = await fetch(`/api/livekit-participants?room=${encodeURIComponent(room.slug)}`)
              if (!resp.ok) return { slug: room.slug, count: 0, names: [] as string[] }
              const data = await resp.json()
              const participants = data.participants || []
              return {
                slug: room.slug,
                count: participants.length,
                names: participants.map((p: { name: string }) => p.name),
              }
            } catch {
              return { slug: room.slug, count: 0, names: [] as string[] }
            }
          })
        )

        if (cancelled) return

        const counts: Record<string, RoomParticipantInfo> = {}
        for (const r of results) {
          counts[r.slug] = { count: r.count, names: r.names }
        }
        setRoomParticipantCounts(counts)
      } catch {
        // ignore
      }
    }

    fetchCounts()
    const interval = setInterval(fetchCounts, 10000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [])

  // Graceful disconnect on page unload
  useEffect(() => {
    const handleUnload = () => {
      if (livekitRoomRef.current) {
        livekitRoomRef.current.disconnect()
      }
    }
    window.addEventListener('beforeunload', handleUnload)
    return () => window.removeEventListener('beforeunload', handleUnload)
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (livekitRoomRef.current) {
        livekitRoomRef.current.disconnect()
        livekitRoomRef.current = null
      }
    }
  }, [])

  return (
    <VoiceContext.Provider value={{
      isConnected,
      isConnecting,
      isMuted,
      isDeafened,
      connectedRoomSlug,
      connectedRoomName,
      connectError,
      participants,
      roomParticipantCounts,
      joinRoom,
      leaveRoom,
      toggleMute,
      toggleDeafen,
    }}>
      {children}
    </VoiceContext.Provider>
  )
}

export function useVoice() {
  const context = useContext(VoiceContext)
  if (context === undefined) {
    throw new Error('useVoice must be used within a VoiceProvider')
  }
  return context
}
