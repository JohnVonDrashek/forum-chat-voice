import { useParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../lib/auth'
import { useVoice } from '../lib/voice'
import Avatar from '../components/Avatar'
import { queryKeys, fetchers, queryOptions } from '../lib/queries'
import type { VoiceRoom } from '../types'
import type { VoiceParticipant } from '../lib/voice'

interface RoomWithParticipants extends VoiceRoom {
  description?: string
  participants: VoiceParticipant[]
  maxParticipants: number
}

export default function Voice() {
  const { roomId } = useParams()
  const { user } = useAuth()
  const voice = useVoice()

  // Use React Query for rooms - cached globally, instant navigation!
  const { data: rawRooms = [], isLoading: roomsLoading, isError: roomsError } = useQuery({
    queryKey: queryKeys.voiceRooms,
    queryFn: fetchers.voiceRooms,
    ...queryOptions.static,
  })

  // Transform rooms with participant info
  const rooms: RoomWithParticipants[] = rawRooms.map(r => ({
    ...r,
    description: '',
    participants: [],
    maxParticipants: 25,
  }))

  // Derive participant data for room list from voice context
  const getRoomParticipants = (slug: string): VoiceParticipant[] => {
    const info = voice.roomParticipantCounts[slug]
    if (!info || info.count === 0) return []
    return info.names.map((name, i) => ({
      id: info.identities[i] || `${slug}-${i}`,
      name,
      avatar: name.charAt(0).toUpperCase(),
      avatarUrl: info.identities[i] ? voice.getAvatarUrl(info.identities[i]) : undefined,
      isSpeaking: false,
      isMuted: false,
    }))
  }

  const currentRoom = roomId ? rooms.find(r => r.slug === roomId || r.id === roomId) : null

  // Are we connected to THIS room?
  const isConnectedToThisRoom = voice.isConnected && voice.connectedRoomSlug === (currentRoom?.slug || roomId)

  // Participants to display: from LiveKit when connected to this room, from polling otherwise
  const displayParticipants = isConnectedToThisRoom
    ? voice.participants
    : getRoomParticipants(currentRoom?.slug || roomId || '')

  // Auth gate component
  const authGate = !user ? (
    <div className="mt-4 rounded-xl border border-slate-700 bg-slate-800/50 p-4 text-center">
      <p className="text-slate-400">
        <Link to="/login" className="font-medium text-indigo-400 hover:text-indigo-300">Sign in</Link> to join voice rooms
      </p>
    </div>
  ) : null

  if (!currentRoom) {
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
              <div key={i} className="animate-pulse rounded-xl border border-slate-700 bg-slate-800/50 p-4">
                <div className="h-5 w-32 rounded bg-slate-700" />
                <div className="mt-4 h-10 w-full rounded bg-slate-700" />
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
            const isConnectedRoom = voice.isConnected && voice.connectedRoomSlug === room.slug
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
            {displayParticipants.length + (isConnectedToThisRoom ? 1 : 0)}/{currentRoom.maxParticipants}
          </span>
        </div>
      </div>

      {voice.connectError && (
        <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-center text-sm text-red-400">
          {voice.connectError}
        </div>
      )}

      {/* Show banner if connected to a DIFFERENT room */}
      {voice.isConnected && !isConnectedToThisRoom && (
        <div className="mb-4 rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3 text-center text-sm text-yellow-400">
          You're connected to <strong>{voice.connectedRoomName}</strong>. Joining this room will disconnect you from there.
        </div>
      )}

      <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-6">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-500">
          In This Room
        </h2>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
          {isConnectedToThisRoom && user && (
            <div className="flex flex-col items-center gap-2 rounded-lg bg-slate-700/50 p-4">
              <div className={`relative h-16 w-16 rounded-full ${
                voice.isSpeaking ? 'ring-2 ring-green-400 animate-pulse' : ''
              }`}>
                <Avatar seed={user.id} type="user" avatarUrl={user.avatar} size={64} />
                {voice.isMuted && (
                  <div className="absolute -bottom-1 -right-1 rounded-full bg-red-500 p-1">
                    <svg className="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15.414a5 5 0 001.414 1.414m2.828-9.9a9 9 0 0112.728 0M19 19l-7-7m0 0l-7-7m7 7l7-7m-7 7l-7 7" />
                    </svg>
                  </div>
                )}
              </div>
              <span className="text-sm font-medium text-white">You</span>
              {voice.isSpeaking && (
                <div className="flex items-center gap-1 text-xs text-green-400">
                  <span className="h-2 w-2 rounded-full bg-green-400 animate-pulse" />
                  Speaking
                </div>
              )}
            </div>
          )}

          {displayParticipants.map((participant) => (
            <div key={participant.id} className="flex flex-col items-center gap-2 rounded-lg bg-slate-700/50 p-4">
              <div className={`relative h-16 w-16 rounded-full ${
                participant.isSpeaking ? 'ring-2 ring-green-400' : ''
              }`}>
                <Avatar seed={participant.id} type="user" avatarUrl={participant.avatarUrl} size={64} />
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

          {displayParticipants.length === 0 && !isConnectedToThisRoom && (
            <div className="col-span-full py-8 text-center text-slate-400">
              No one is in this room yet. Be the first to join!
            </div>
          )}
        </div>
      </div>

      <div className="mt-6 rounded-xl border border-slate-700 bg-slate-800/50 p-4">
        {!user ? (
          <div className="text-center">
            <p className="text-slate-400">
              <Link to="/login" className="font-medium text-indigo-400 hover:text-indigo-300">Sign in</Link> to join voice rooms
            </p>
          </div>
        ) : (
          <div className="flex items-center justify-center gap-4">
            {isConnectedToThisRoom ? (
              <>
                <button
                  onClick={voice.toggleMute}
                  className={`rounded-full p-4 transition-colors ${
                    voice.isMuted
                      ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                      : 'bg-slate-700 text-white hover:bg-slate-600'
                  }`}
                  title={voice.isMuted ? 'Unmute' : 'Mute'}
                >
                  {voice.isMuted ? (
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
                  onClick={voice.toggleDeafen}
                  className={`rounded-full p-4 transition-colors ${
                    voice.isDeafened
                      ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                      : 'bg-slate-700 text-white hover:bg-slate-600'
                  }`}
                  title={voice.isDeafened ? 'Undeafen' : 'Deafen'}
                >
                  {voice.isDeafened ? (
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
                  onClick={voice.leaveRoom}
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
                onClick={() => currentRoom && voice.joinRoom(currentRoom.slug || currentRoom.id, currentRoom.name)}
                disabled={voice.isConnecting || !user}
                className="rounded-lg bg-green-600 px-8 py-3 font-medium text-white hover:bg-green-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {voice.isConnecting ? 'Connecting...' : 'Join Voice'}
              </button>
            )}
          </div>
        )}

        {isConnectedToThisRoom && (
          <p className="mt-4 text-center text-sm text-slate-400">
            {voice.isMuted ? 'You are muted' : 'Your microphone is on'}
            {voice.isDeafened && ' · You are deafened'}
          </p>
        )}
      </div>
    </div>
  )
}
