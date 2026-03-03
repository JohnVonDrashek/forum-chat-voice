import { createContext, useContext, useState, useRef, useCallback, useEffect, ReactNode } from 'react'
import type { Room as RoomType, Participant } from 'livekit-client'
import { supabase } from './supabase'
import { useAuth } from './auth'
import { getDataProvider } from './data-provider'

// Lazily loaded livekit module — only fetched when joinRoom() is called
let livekitModule: typeof import('livekit-client') | null = null
async function getLivekit() {
  if (!livekitModule) {
    livekitModule = await import('livekit-client')
  }
  return livekitModule
}

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

interface VoicePresenceRow {
  id: string
  user_id: string
  room_slug: string
  joined_at: string
  profile?: {
    id: string
    username: string
    display_name: string | null
    avatar_url: string | null
  }
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

function participantToVoice(p: Participant, lk: typeof import('livekit-client')): VoiceParticipant {
  const audioTrack = p.getTrackPublications().find(
    t => t.track?.source === lk.Track.Source.Microphone,
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
  const livekitRoomRef = useRef<RoomType | null>(null)

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

  // Ref to track connected room slug for use in callbacks without triggering re-renders
  const connectedRoomSlugRef = useRef<string | null>(null)

  // Cache of participant avatar URLs so we don't re-fetch every update
  const avatarCacheRef = useRef<Record<string, string | null>>({})

  const updateParticipants = useCallback(() => {
    const room = livekitRoomRef.current
    if (!room || !livekitModule) return
    const lk = livekitModule
    const remotes = Array.from(room.remoteParticipants.values()).map(p => {
      const vp = participantToVoice(p, lk)
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
        .then(({ data, error }) => {
          if (error) {
            console.error('[FLD:Voice] Failed to fetch participant avatars:', error)
            return
          }
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

  // Fetch all voice presence and build room participant counts
  const fetchVoicePresence = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('voice_presence')
        .select(`
          id,
          user_id,
          room_slug,
          joined_at,
          profile:profiles(id, username, display_name, avatar_url)
        `)

      if (error) {
        console.error('Failed to fetch voice presence:', error)
        return
      }

      const counts: Record<string, RoomParticipantInfo> = {}
      const newAvatarUpdates: Record<string, string | null> = {}

      for (const row of (data || []) as VoicePresenceRow[]) {
        if (!counts[row.room_slug]) {
          counts[row.room_slug] = { count: 0, names: [], identities: [] }
        }
        counts[row.room_slug].count++
        counts[row.room_slug].identities.push(row.user_id)

        // Get name from profile
        const name = row.profile?.display_name || row.profile?.username || row.user_id.slice(0, 8)
        counts[row.room_slug].names.push(name)

        // Cache avatar URL
        if (row.profile && avatarCacheRef.current[row.user_id] === undefined) {
          avatarCacheRef.current[row.user_id] = row.profile.avatar_url
          newAvatarUpdates[row.user_id] = row.profile.avatar_url
        }
      }

      setRoomParticipantCounts(counts)

      if (Object.keys(newAvatarUpdates).length > 0) {
        setAvatarCache(prev => ({ ...prev, ...newAvatarUpdates }))
      }
    } catch (err) {
      console.error('Failed to fetch voice presence:', err)
    }
  }, [])

  // Write presence when joining a room
  const writePresence = useCallback(async (roomSlug: string) => {
    if (!user) return
    try {
      await getDataProvider().setVoicePresence(user.id, roomSlug)
    } catch (err) {
      console.error('Failed to write voice presence:', err)
    }
  }, [user])

  // Delete presence when leaving
  const deletePresence = useCallback(async () => {
    if (!user) return
    try {
      await getDataProvider().clearVoicePresence(user.id)
    } catch (err) {
      console.error('Failed to delete voice presence:', err)
    }
  }, [user])

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

    // Delete presence from Supabase
    deletePresence()
  }, [deletePresence])

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

      // Dynamically load livekit-client only when actually joining a room
      const lk = await getLivekit()

      const room = new lk.Room()
      livekitRoomRef.current = room

      room.on(lk.RoomEvent.ParticipantConnected, updateParticipants)
      room.on(lk.RoomEvent.ParticipantDisconnected, updateParticipants)
      room.on(lk.RoomEvent.TrackMuted, updateParticipants)
      room.on(lk.RoomEvent.TrackUnmuted, updateParticipants)
      room.on(lk.RoomEvent.ActiveSpeakersChanged, updateParticipants)

      // Attach remote audio tracks to DOM for playback
      room.on(lk.RoomEvent.TrackSubscribed, (track) => {
        if (track.kind === lk.Track.Kind.Audio) {
          const el = track.attach()
          el.id = `lk-audio-${track.sid}`
          document.body.appendChild(el)
        }
      })
      room.on(lk.RoomEvent.TrackUnsubscribed, (track) => {
        track.detach().forEach(el => el.remove())
      })

      room.on(lk.RoomEvent.Disconnected, () => {
        setIsConnected(false)
        setParticipants([])
        setConnectedRoomSlug(null)
        setConnectedRoomName(null)
        setIsMuted(false)
        setIsDeafened(false)
        setIsSpeaking(false)
        connectedRoomSlugRef.current = null
        livekitRoomRef.current = null
        deletePresence()
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

      // Write presence to Supabase
      writePresence(slug)
    } catch (err) {
      setConnectError(err instanceof Error ? err.message : 'Failed to connect')
      livekitRoomRef.current = null
    } finally {
      setIsConnecting(false)
    }
  }, [user, updateParticipants, writePresence, deletePresence])

  const toggleMute = useCallback(async () => {
    const room = livekitRoomRef.current
    if (!room) return
    const newMuted = !isMuted
    await room.localParticipant.setMicrophoneEnabled(!newMuted)
    setIsMuted(newMuted)
  }, [isMuted])

  const toggleDeafen = useCallback(() => {
    const room = livekitRoomRef.current
    if (!room || !livekitModule) return
    const lk = livekitModule
    const newDeafened = !isDeafened
    room.remoteParticipants.forEach(p => {
      p.getTrackPublications().forEach(pub => {
        if (pub.track && pub.track.source === lk.Track.Source.Microphone) {
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

  // Subscribe to voice_presence changes via Supabase Realtime
  useEffect(() => {
    // Initial fetch
    fetchVoicePresence()

    // Subscribe to realtime changes
    const channel = supabase
      .channel('voice-presence-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'voice_presence',
        },
        () => {
          // Re-fetch all presence data on any change
          fetchVoicePresence()
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [fetchVoicePresence])

  // Graceful disconnect on page unload
  useEffect(() => {
    const handleUnload = () => {
      if (livekitRoomRef.current) {
        livekitRoomRef.current.disconnect()
      }
      // Note: Can't await deletePresence here, but Supabase will clean up stale records
      // We could use navigator.sendBeacon for a more reliable cleanup
      if (user) {
        // Fire-and-forget delete via fetch with keepalive
        fetch(`${import.meta.env.VITE_SUPABASE_URL}/rest/v1/voice_presence?user_id=eq.${user.id}`, {
          method: 'DELETE',
          headers: {
            'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
          },
          keepalive: true,
        }).catch(() => {})
      }
    }
    window.addEventListener('beforeunload', handleUnload)
    return () => window.removeEventListener('beforeunload', handleUnload)
  }, [user])

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
