import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { supabase, isConfigured } from '../lib/supabase'
import type { VoiceRoom } from '../types'

interface VoiceParticipant {
  id: string
  name: string
  avatar: string
  isSpeaking: boolean
  isMuted: boolean
}

interface RoomWithParticipants extends VoiceRoom {
  description?: string
  participants: VoiceParticipant[]
  maxParticipants: number
}

// Demo voice rooms
const demoRooms: RoomWithParticipants[] = [
  {
    id: 'lounge',
    name: 'Lounge',
    slug: 'lounge',
    created_at: '',
    description: 'Casual hangout space',
    maxParticipants: 25,
    participants: [
      { id: '1', name: 'Admin', avatar: 'A', isSpeaking: true, isMuted: false },
      { id: '2', name: 'Sarah', avatar: 'S', isSpeaking: false, isMuted: false },
      { id: '3', name: 'Mike', avatar: 'M', isSpeaking: false, isMuted: true },
    ],
  },
  {
    id: 'gaming',
    name: 'Gaming',
    slug: 'gaming',
    created_at: '',
    description: 'Voice chat for gaming sessions',
    maxParticipants: 10,
    participants: [
      { id: '4', name: 'Alex', avatar: 'A', isSpeaking: false, isMuted: false },
    ],
  },
  {
    id: 'music',
    name: 'Music',
    slug: 'music',
    created_at: '',
    description: 'Listen and share music together',
    maxParticipants: 50,
    participants: [],
  },
  {
    id: 'study',
    name: 'Study Room',
    slug: 'study',
    created_at: '',
    description: 'Quiet focus time with others',
    maxParticipants: 15,
    participants: [
      { id: '5', name: 'Jordan', avatar: 'J', isSpeaking: false, isMuted: true },
      { id: '6', name: 'Taylor', avatar: 'T', isSpeaking: false, isMuted: true },
    ],
  },
]

export default function Voice() {
  const { roomId } = useParams()
  const [rooms, setRooms] = useState<RoomWithParticipants[]>(demoRooms)
  const [isConnected, setIsConnected] = useState(false)
  const [isMuted, setIsMuted] = useState(false)
  const [isDeafened, setIsDeafened] = useState(false)

  useEffect(() => {
    if (!isConfigured) return

    const fetchRooms = async () => {
      const { data } = await supabase
        .from('voice_rooms')
        .select('*')
        .order('name')

      if (data) {
        setRooms(data.map(r => ({
          ...r,
          description: '',
          participants: [],
          maxParticipants: 25,
        })))
      }
    }

    fetchRooms()
  }, [])

  const currentRoom = roomId ? rooms.find(r => r.slug === roomId || r.id === roomId) : null

  const handleJoinRoom = () => {
    setIsConnected(true)
    setIsMuted(false)
    setIsDeafened(false)
  }

  const handleLeaveRoom = () => {
    setIsConnected(false)
  }

  const toggleMute = () => {
    setIsMuted(!isMuted)
  }

  const toggleDeafen = () => {
    setIsDeafened(!isDeafened)
    if (!isDeafened) {
      setIsMuted(true)
    }
  }

  if (!currentRoom) {
    return (
      <div className="mx-auto max-w-4xl">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-white">Voice Rooms</h1>
          <p className="mt-1 text-slate-400">Join a room to chat with others in real-time</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {rooms.map((room) => (
            <div
              key={room.id}
              className="rounded-xl border border-slate-700 bg-slate-800/50 p-4 transition-colors hover:bg-slate-700/50"
            >
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <svg className="h-5 w-5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15.414a5 5 0 001.414 1.414m2.828-9.9a9 9 0 0112.728 0" />
                    </svg>
                    <h3 className="font-semibold text-white">{room.name}</h3>
                  </div>
                  {room.description && (
                    <p className="mt-1 text-sm text-slate-400">{room.description}</p>
                  )}
                </div>
                <span className="rounded-full bg-slate-700 px-2 py-0.5 text-xs text-slate-300">
                  {room.participants.length}/{room.maxParticipants}
                </span>
              </div>

              {room.participants.length > 0 && (
                <div className="mt-4 flex items-center gap-2">
                  <div className="flex -space-x-2">
                    {room.participants.slice(0, 5).map((p) => (
                      <div
                        key={p.id}
                        className={`h-8 w-8 rounded-full border-2 border-slate-800 flex items-center justify-center text-xs font-medium text-white ${
                          p.isSpeaking ? 'bg-green-500 ring-2 ring-green-400' : 'bg-indigo-500'
                        }`}
                        title={p.name}
                      >
                        {p.avatar}
                      </div>
                    ))}
                  </div>
                  <span className="text-sm text-slate-400">
                    {room.participants.map(p => p.name).slice(0, 3).join(', ')}
                    {room.participants.length > 3 && ` +${room.participants.length - 3}`}
                  </span>
                </div>
              )}

              <button
                onClick={handleJoinRoom}
                className="mt-4 w-full rounded-lg bg-green-600 py-2 font-medium text-white hover:bg-green-500 transition-colors"
              >
                Join Room
              </button>
            </div>
          ))}
        </div>

        {!isConfigured && (
          <p className="mt-6 text-center text-xs text-slate-500">
            Demo mode - voice functionality is simulated
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6 rounded-xl border border-slate-700 bg-slate-800/50 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-green-500/20 p-2">
              <svg className="h-6 w-6 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15.414a5 5 0 001.414 1.414m2.828-9.9a9 9 0 0112.728 0" />
              </svg>
            </div>
            <div>
              <h1 className="text-xl font-bold text-white">{currentRoom.name}</h1>
              {currentRoom.description && (
                <p className="text-sm text-slate-400">{currentRoom.description}</p>
              )}
            </div>
          </div>
          <span className="rounded-full bg-slate-700 px-3 py-1 text-sm text-slate-300">
            {currentRoom.participants.length + (isConnected ? 1 : 0)}/{currentRoom.maxParticipants}
          </span>
        </div>
      </div>

      <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-6">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-500">
          In This Room
        </h2>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
          {isConnected && (
            <div className="flex flex-col items-center gap-2 rounded-lg bg-slate-700/50 p-4">
              <div className={`relative h-16 w-16 rounded-full flex items-center justify-center text-2xl font-bold text-white ${
                !isMuted ? 'bg-green-500 ring-2 ring-green-400 animate-pulse' : 'bg-indigo-500'
              }`}>
                Y
                {isMuted && (
                  <div className="absolute -bottom-1 -right-1 rounded-full bg-red-500 p-1">
                    <svg className="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15.414a5 5 0 001.414 1.414m2.828-9.9a9 9 0 0112.728 0M19 19l-7-7m0 0l-7-7m7 7l7-7m-7 7l-7 7" />
                    </svg>
                  </div>
                )}
              </div>
              <span className="text-sm font-medium text-white">You</span>
              <div className="flex items-center gap-1 text-xs text-green-400">
                <span className="h-2 w-2 rounded-full bg-green-400" />
                Connected
              </div>
            </div>
          )}

          {currentRoom.participants.map((participant) => (
            <div key={participant.id} className="flex flex-col items-center gap-2 rounded-lg bg-slate-700/50 p-4">
              <div className={`relative h-16 w-16 rounded-full flex items-center justify-center text-2xl font-bold text-white ${
                participant.isSpeaking ? 'bg-green-500 ring-2 ring-green-400' : 'bg-indigo-500'
              }`}>
                {participant.avatar}
                {participant.isMuted && (
                  <div className="absolute -bottom-1 -right-1 rounded-full bg-red-500 p-1">
                    <svg className="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15.414a5 5 0 001.414 1.414m2.828-9.9a9 9 0 0112.728 0M19 19l-7-7m0 0l-7-7m7 7l7-7m-7 7l-7 7" />
                    </svg>
                  </div>
                )}
              </div>
              <span className="text-sm font-medium text-white">{participant.name}</span>
              {participant.isSpeaking && (
                <div className="flex items-center gap-1 text-xs text-green-400">
                  <span className="h-2 w-2 rounded-full bg-green-400 animate-pulse" />
                  Speaking
                </div>
              )}
            </div>
          ))}

          {currentRoom.participants.length === 0 && !isConnected && (
            <div className="col-span-full py-8 text-center text-slate-400">
              No one is in this room yet. Be the first to join!
            </div>
          )}
        </div>
      </div>

      <div className="mt-6 rounded-xl border border-slate-700 bg-slate-800/50 p-4">
        <div className="flex items-center justify-center gap-4">
          {isConnected ? (
            <>
              <button
                onClick={toggleMute}
                className={`rounded-full p-4 transition-colors ${
                  isMuted
                    ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                    : 'bg-slate-700 text-white hover:bg-slate-600'
                }`}
                title={isMuted ? 'Unmute' : 'Mute'}
              >
                {isMuted ? (
                  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15.414a5 5 0 001.414 1.414m2.828-9.9a9 9 0 0112.728 0M19 19l-7-7m0 0l-7-7m7 7l7-7m-7 7l-7 7" />
                  </svg>
                ) : (
                  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                  </svg>
                )}
              </button>

              <button
                onClick={toggleDeafen}
                className={`rounded-full p-4 transition-colors ${
                  isDeafened
                    ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                    : 'bg-slate-700 text-white hover:bg-slate-600'
                }`}
                title={isDeafened ? 'Undeafen' : 'Deafen'}
              >
                {isDeafened ? (
                  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                  </svg>
                ) : (
                  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                  </svg>
                )}
              </button>

              <button
                onClick={handleLeaveRoom}
                className="rounded-full bg-red-500 p-4 text-white hover:bg-red-600 transition-colors"
                title="Disconnect"
              >
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 8l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M5 3a2 2 0 00-2 2v1c0 8.284 6.716 15 15 15h1a2 2 0 002-2v-3.28a1 1 0 00-.684-.948l-4.493-1.498a1 1 0 00-1.21.502l-1.13 2.257a11.042 11.042 0 01-5.516-5.517l2.257-1.128a1 1 0 00.502-1.21L9.228 3.683A1 1 0 008.279 3H5z" />
                </svg>
              </button>
            </>
          ) : (
            <button
              onClick={handleJoinRoom}
              className="rounded-lg bg-green-600 px-8 py-3 font-medium text-white hover:bg-green-500 transition-colors"
            >
              Join Voice
            </button>
          )}
        </div>

        {isConnected && (
          <p className="mt-4 text-center text-sm text-slate-400">
            {isMuted ? 'You are muted' : 'Your microphone is on'}
            {isDeafened && ' · You are deafened'}
          </p>
        )}
      </div>

      {!isConfigured && (
        <p className="mt-6 text-center text-xs text-slate-500">
          Demo mode - voice functionality is simulated
        </p>
      )}
    </div>
  )
}
