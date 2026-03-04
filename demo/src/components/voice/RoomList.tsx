import { Link } from 'react-router-dom'
import Avatar from '../Avatar'
import Skeleton from '../ui/Skeleton'
import type { VoiceParticipant } from '../../lib/voice'

interface RoomWithParticipants {
  id: string
  name: string
  slug: string
  description?: string
  participants: VoiceParticipant[]
  maxParticipants: number
}

interface RoomParticipantInfo {
  count: number
  names: string[]
  identities: string[]
}

export interface RoomListProps {
  rooms: RoomWithParticipants[]
  roomsLoading: boolean
  roomsError: boolean
  isConnected: boolean
  connectedRoomSlug: string | null
  roomParticipantCounts: Record<string, RoomParticipantInfo>
  getAvatarUrl: (identity: string) => string | null | undefined
  authGate: React.ReactNode
}

export default function RoomList({
  rooms,
  roomsLoading,
  roomsError,
  isConnected,
  connectedRoomSlug,
  roomParticipantCounts,
  getAvatarUrl,
  authGate,
}: RoomListProps) {
  const getRoomParticipants = (slug: string): VoiceParticipant[] => {
    const info = roomParticipantCounts[slug]
    if (!info || info.count === 0) return []
    return info.names.map((name, i) => ({
      id: info.identities[i] || `${slug}-${i}`,
      name,
      avatar: name.charAt(0).toUpperCase(),
      avatarUrl: info.identities[i] ? getAvatarUrl(info.identities[i]) : undefined,
      isSpeaking: false,
      isMuted: false,
    }))
  }

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Voice Rooms</h1>
        <p className="mt-1 text-slate-400">Join a room to chat with others in real-time</p>
      </div>

      {authGate}

      {roomsLoading && (
        <div className="grid gap-4 sm:grid-cols-2">
          {[...Array(2)].map((_, i) => (
            <div key={i} className="rounded-xl border border-slate-700 bg-slate-800/50 p-4">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-5 w-5" />
                  <Skeleton className="h-5 w-32" />
                </div>
                <Skeleton className="h-5 w-12 rounded-full" />
              </div>
              <Skeleton className="mt-2 h-4 w-48" />
              <div className="mt-4 flex items-center gap-2">
                <div className="flex -space-x-2">
                  {[...Array(3)].map((_, j) => (
                    <Skeleton key={j} className="h-8 w-8 rounded-full border-2 border-slate-800" />
                  ))}
                </div>
                <Skeleton className="h-4 w-24" />
              </div>
              <Skeleton className="mt-4 h-10 w-full rounded-lg" />
            </div>
          ))}
        </div>
      )}

      {roomsError && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-center">
          <p className="text-red-400">Failed to load voice rooms</p>
          <p className="mt-1 text-sm text-slate-400">Check browser console for details</p>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {rooms.map((room) => {
          const roomParticipants = getRoomParticipants(room.slug)
          const isConnectedRoom = isConnected && connectedRoomSlug === room.slug
          return (
            <div
              key={room.id}
              className={`rounded-xl border p-4 transition-colors hover:bg-slate-700/50 ${
                isConnectedRoom
                  ? 'border-green-500/50 bg-green-500/5'
                  : 'border-slate-700 bg-slate-800/50'
              }`}
            >
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <svg className="h-5 w-5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15.414a5 5 0 001.414 1.414m2.828-9.9a9 9 0 0112.728 0" />
                    </svg>
                    <h3 className="font-semibold text-white">{room.name}</h3>
                    {isConnectedRoom && (
                      <span className="rounded-full bg-green-500/20 px-2 py-0.5 text-xs font-medium text-green-400">Connected</span>
                    )}
                  </div>
                  {room.description && (
                    <p className="mt-1 text-sm text-slate-400">{room.description}</p>
                  )}
                </div>
                <span className="rounded-full bg-slate-700 px-2 py-0.5 text-xs text-slate-300">
                  {roomParticipants.length}/{room.maxParticipants}
                </span>
              </div>

              {roomParticipants.length > 0 && (
                <div className="mt-4 flex items-center gap-2">
                  <div className="flex -space-x-2">
                    {roomParticipants.slice(0, 5).map((p) => (
                      <div
                        key={p.id}
                        className={`h-8 w-8 rounded-full border-2 border-slate-800 ${
                          p.isSpeaking ? 'ring-2 ring-green-400' : ''
                        }`}
                        title={p.name}
                      >
                        <Avatar seed={p.id} type="user" avatarUrl={p.avatarUrl} size={32} />
                      </div>
                    ))}
                  </div>
                  <span className="text-sm text-slate-400">
                    {roomParticipants.map(p => p.name).slice(0, 3).join(', ')}
                    {roomParticipants.length > 3 && ` +${roomParticipants.length - 3}`}
                  </span>
                </div>
              )}

              <Link
                to={`/voice/${room.slug || room.id}`}
                className="mt-4 block w-full rounded-lg bg-green-600 py-2 text-center font-medium text-white hover:bg-green-500 transition-colors"
              >
                {isConnectedRoom ? 'View Room' : 'Join Room'}
              </Link>
            </div>
          )
        })}
      </div>
    </div>
  )
}
