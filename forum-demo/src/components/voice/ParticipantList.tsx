import Avatar from '../Avatar'
import type { VoiceParticipant } from '../../lib/voice'
import type { AppUser } from '../../lib/auth-provider'

export interface ParticipantListProps {
  participants: VoiceParticipant[]
  isConnectedToThisRoom: boolean
  user: AppUser | null
  isSpeaking: boolean
  isMuted: boolean
}

export default function ParticipantList({
  participants,
  isConnectedToThisRoom,
  user,
  isSpeaking,
  isMuted,
}: ParticipantListProps) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
      {isConnectedToThisRoom && user && (
        <div className="flex flex-col items-center gap-2 rounded-lg bg-slate-700/50 p-4">
          <div className={`relative h-16 w-16 rounded-full ${
            isSpeaking ? 'ring-2 ring-green-400 animate-pulse' : ''
          }`}>
            <Avatar seed={user.id} type="user" avatarUrl={user.avatar} size={64} />
            {isMuted && (
              <div className="absolute -bottom-1 -right-1 rounded-full bg-red-500 p-1">
                <svg className="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15.414a5 5 0 001.414 1.414m2.828-9.9a9 9 0 0112.728 0M19 19l-7-7m0 0l-7-7m7 7l7-7m-7 7l-7 7" />
                </svg>
              </div>
            )}
          </div>
          <span className="text-sm font-medium text-white">You</span>
          {isSpeaking && (
            <div className="flex items-center gap-1 text-xs text-green-400">
              <span className="h-2 w-2 rounded-full bg-green-400 animate-pulse" />
              Speaking
            </div>
          )}
        </div>
      )}

      {participants.map((participant) => (
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

      {participants.length === 0 && !isConnectedToThisRoom && (
        <div className="col-span-full py-8 text-center text-slate-400">
          No one is in this room yet. Be the first to join!
        </div>
      )}
    </div>
  )
}
