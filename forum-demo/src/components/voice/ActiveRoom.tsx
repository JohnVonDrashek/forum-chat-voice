import { Link } from 'react-router-dom'
import Card from '../ui/Card'
import ParticipantList from './ParticipantList'
import type { VoiceParticipant } from '../../lib/voice'
import type { AppUser } from '../../lib/auth-provider'

interface RoomInfo {
  id: string
  name: string
  slug: string
  description?: string
  maxParticipants: number
}

export interface ActiveRoomProps {
  room: RoomInfo
  user: AppUser | null
  displayParticipants: VoiceParticipant[]
  isConnectedToThisRoom: boolean
  isConnected: boolean
  isConnecting: boolean
  isMuted: boolean
  isDeafened: boolean
  isSpeaking: boolean
  connectedRoomName: string | null
  connectError: string | null
  joinRoom: (slug: string, name: string) => Promise<void>
  leaveRoom: () => void
  toggleMute: () => Promise<void>
  toggleDeafen: () => void
}

export default function ActiveRoom({
  room,
  user,
  displayParticipants,
  isConnectedToThisRoom,
  isConnected,
  isConnecting,
  isMuted,
  isDeafened,
  isSpeaking,
  connectedRoomName,
  connectError,
  joinRoom,
  leaveRoom,
  toggleMute,
  toggleDeafen,
}: ActiveRoomProps) {
  return (
    <div className="mx-auto max-w-4xl">
      <Card className="mb-6 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-green-500/20 p-2">
              <svg className="h-6 w-6 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15.414a5 5 0 001.414 1.414m2.828-9.9a9 9 0 0112.728 0" />
              </svg>
            </div>
            <div>
              <h1 className="text-xl font-bold text-white">{room.name}</h1>
              {room.description && (
                <p className="text-sm text-slate-400">{room.description}</p>
              )}
            </div>
          </div>
          <span className="rounded-full bg-slate-700 px-3 py-1 text-sm text-slate-300">
            {displayParticipants.length + (isConnectedToThisRoom ? 1 : 0)}/{room.maxParticipants}
          </span>
        </div>
      </Card>

      {connectError && (
        <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-center text-sm text-red-400">
          {connectError}
        </div>
      )}

      {/* Show banner if connected to a DIFFERENT room */}
      {isConnected && !isConnectedToThisRoom && (
        <div className="mb-4 rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3 text-center text-sm text-yellow-400">
          You're connected to <strong>{connectedRoomName}</strong>. Joining this room will disconnect you from there.
        </div>
      )}

      <Card className="p-6">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-500">
          In This Room
        </h2>

        <ParticipantList
          participants={displayParticipants}
          isConnectedToThisRoom={isConnectedToThisRoom}
          user={user}
          isSpeaking={isSpeaking}
          isMuted={isMuted}
        />
      </Card>

      <Card className="mt-6 p-4">
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
                  onClick={toggleMute}
                  className={`rounded-full p-4 transition-colors ${
                    isMuted
                      ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                      : 'bg-slate-700 text-white hover:bg-slate-600'
                  }`}
                  title={isMuted ? 'Unmute' : 'Mute'}
                  aria-label={isMuted ? 'Unmute microphone' : 'Mute microphone'}
                  aria-pressed={isMuted}
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
                  aria-label={isDeafened ? 'Undeafen audio' : 'Deafen audio'}
                  aria-pressed={isDeafened}
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
                  onClick={leaveRoom}
                  className="rounded-full bg-red-500 p-4 text-white hover:bg-red-600 transition-colors"
                  title="Disconnect"
                  aria-label="Disconnect from voice room"
                >
                  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 8l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M5 3a2 2 0 00-2 2v1c0 8.284 6.716 15 15 15h1a2 2 0 002-2v-3.28a1 1 0 00-.684-.948l-4.493-1.498a1 1 0 00-1.21.502l-1.13 2.257a11.042 11.042 0 01-5.516-5.517l2.257-1.128a1 1 0 00.502-1.21L9.228 3.683A1 1 0 008.279 3H5z" />
                  </svg>
                </button>
              </>
            ) : (
              <button
                onClick={() => joinRoom(room.slug || room.id, room.name)}
                disabled={isConnecting || !user}
                className="rounded-lg bg-green-600 px-8 py-3 font-medium text-white hover:bg-green-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isConnecting ? 'Connecting...' : 'Join Voice'}
              </button>
            )}
          </div>
        )}

        {isConnectedToThisRoom && (
          <p className="mt-4 text-center text-sm text-slate-400">
            {isMuted ? 'You are muted' : 'Your microphone is on'}
            {isDeafened && ' · You are deafened'}
          </p>
        )}
      </Card>
    </div>
  )
}
