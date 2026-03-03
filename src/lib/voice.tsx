import { createContext, useContext, useState, useRef, useCallback, useEffect, ReactNode } from 'react'
import { Room, RoomEvent, Track, Participant } from 'livekit-client'
import { supabase } from './supabase'
import { useAuth } from './auth'

export interface VoiceParticipant {
  id: string
  name: string
  avatar: string
  avatarUrl?: string | null
  isSpeaking: boolean
  isMuted: boolean
}

interface RoomParticipantInfo {
  count: number
  names: string[]
  identities: string[]
}

interface VoiceContextType {
  // Connection state
  isConnected: boolean
  isConnecting: boolean
  isMuted: boolean
  isDeafened: boolean
  isSpeaking: boolean
  connectedRoomSlug: string | null
  connectedRoomName: string | null
  connectError: string | null
  participants: VoiceParticipant[]

  // Sidebar data — participant counts for all rooms
  roomParticipantCounts: Record<string, RoomParticipantInfo>

  // Avatar lookup for polled participants
  getAvatarUrl: (identity: string) => string | null | undefined

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
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [connectedRoomSlug, setConnectedRoomSlug] = useState<string | null>(null)
  const [connectedRoomName, setConnectedRoomName] = useState<string | null>(null)
  const [connectError, setConnectError] = useState<string | null>(null)
  const [participants, setParticipants] = useState<VoiceParticipant[]>([])
  const [roomParticipantCounts, setRoomParticipantCounts] = useState<Record<string, RoomParticipantInfo>>({})
  const [avatarCache, setAvatarCache] = useState<Record<string, string | null>>({})

  // Ref to track connected room slug for use in polling without triggering re-renders
  const connectedRoomSlugRef = useRef<string | null>(null)
  // Ref to allow leaveRoom/joinRoom to trigger a re-poll without declaration-order issues
  const fetchParticipantCountsRef = useRef<() => void>(() => {})

  // Cache of participant avatar URLs so we don't re-fetch every update
  const avatarCacheRef = useRef<Record<string, string | null>>({})

  const updateParticipants = useCallback(() => {
    const room = livekitRoomRef.current
    if (!room) return
    const remotes = Array.from(room.remoteParticipants.values()).map(p => {
      const vp = participantToVoice(p)
      // Apply cached avatar URL if available
      if (avatarCacheRef.current[vp.id] !== undefined) {
        vp.avatarUrl = avatarCacheRef.current[vp.id]
      }
      return vp
    })
    setParticipants(remotes)
    setIsSpeaking(room.localParticipant.isSpeaking)

    // Fetch avatar URLs for any participants not yet in cache
    const uncached = remotes.filter(p => avatarCacheRef.current[p.id] === undefined)
    if (uncached.length > 0) {
      supabase
        .from('profiles')
        .select('id, avatar_url')
        .in('id', uncached.map(p => p.id))
        .then(({ data }) => {
          if (!data) return
          let changed = false
          for (const profile of data) {
            if (avatarCacheRef.current[profile.id] === undefined) {
              avatarCacheRef.current[profile.id] = profile.avatar_url
              changed = true
            }
          }
          // Also mark participants with no profile as null so we don't re-fetch
          for (const p of uncached) {
            if (avatarCacheRef.current[p.id] === undefined) {
              avatarCacheRef.current[p.id] = null
              changed = true
            }
          }
          if (changed) {
            // Re-apply cached URLs
            setParticipants(prev => prev.map(p => ({
              ...p,
              avatarUrl: avatarCacheRef.current[p.id] ?? p.avatarUrl,
            })))
          }
        })
    }
  }, [])

  const leaveRoom = useCallback(() => {
    if (livekitRoomRef.current) {
      // Detach all audio elements before disconnecting
      livekitRoomRef.current.remoteParticipants.forEach(p => {
        p.getTrackPublications().forEach(pub => {
          if (pub.track) {
            pub.track.detach().forEach(el => el.remove())
          }
        })
      })
      livekitRoomRef.current.disconnect()
      livekitRoomRef.current = null
    }
    setIsConnected(false)
    setParticipants([])
    setConnectedRoomSlug(null)
    setConnectedRoomName(null)
    setIsMuted(false)
    setIsDeafened(false)
    setIsSpeaking(false)
    setConnectError(null)
    connectedRoomSlugRef.current = null
    // Re-poll immediately so the lobby reflects the change
    setTimeout(() => fetchParticipantCountsRef.current(), 500)
  }, [])

  const joinRoom = useCallback(async (slug: string, name: string) => {
    if (!user) return

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

      // Attach remote audio tracks to DOM for playback
      room.on(RoomEvent.TrackSubscribed, (track) => {
        if (track.kind === Track.Kind.Audio) {
          const el = track.attach()
          el.id = `lk-audio-${track.sid}`
          document.body.appendChild(el)
        }
      })
      room.on(RoomEvent.TrackUnsubscribed, (track) => {
        track.detach().forEach(el => el.remove())
      })

      room.on(RoomEvent.Disconnected, () => {
        setIsConnected(false)
        setParticipants([])
        setConnectedRoomSlug(null)
        setConnectedRoomName(null)
        setIsMuted(false)
        setIsDeafened(false)
        setIsSpeaking(false)
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
      // Re-poll so sidebar count updates immediately
      setTimeout(() => fetchParticipantCountsRef.current(), 500)
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

  // Fetch participant counts for all rooms
  const fetchParticipantCounts = useCallback(async () => {
    try {
      const resp = await fetch('/api/livekit-participants-all')
      if (!resp.ok) return
      const data = await resp.json()
      const rooms: Record<string, { count: number; names: string[]; identities?: string[] }> = data.rooms || {}

      const counts: Record<string, RoomParticipantInfo> = {}
      const allIdentities: string[] = []
      for (const [slug, info] of Object.entries(rooms)) {
        const identities = info.identities || []
        counts[slug] = { count: info.count, names: info.names, identities }
        allIdentities.push(...identities)
      }
      setRoomParticipantCounts(counts)

      // Fetch avatar URLs for any identities not in cache
      const uncached = allIdentities.filter(id => avatarCacheRef.current[id] === undefined)
      if (uncached.length > 0) {
        supabase
          .from('profiles')
          .select('id, avatar_url')
          .in('id', uncached)
          .then(({ data: profiles }) => {
            if (!profiles) return
            const updates: Record<string, string | null> = {}
            for (const p of profiles) {
              avatarCacheRef.current[p.id] = p.avatar_url
              updates[p.id] = p.avatar_url
            }
            for (const id of uncached) {
              if (avatarCacheRef.current[id] === undefined) {
                avatarCacheRef.current[id] = null
                updates[id] = null
              }
            }
            setAvatarCache(prev => ({ ...prev, ...updates }))
          })
      }
    } catch {
      // ignore
    }
  }, [])

  // Keep ref in sync so leaveRoom/joinRoom can trigger a re-poll
  fetchParticipantCountsRef.current = fetchParticipantCounts

  // Poll participant counts every 5 seconds
  useEffect(() => {
    fetchParticipantCounts()
    const interval = setInterval(fetchParticipantCounts, 5000)
    return () => clearInterval(interval)
  }, [fetchParticipantCounts])

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

  const getAvatarUrl = useCallback((identity: string) => {
    return avatarCache[identity] ?? undefined
  }, [avatarCache])

  return (
    <VoiceContext.Provider value={{
      isConnected,
      isConnecting,
      isMuted,
      isDeafened,
      isSpeaking,
      connectedRoomSlug,
      connectedRoomName,
      connectError,
      participants,
      roomParticipantCounts,
      getAvatarUrl,
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
