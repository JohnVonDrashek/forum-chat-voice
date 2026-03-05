import { useParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../lib/auth'
import { useVoice } from '../lib/voice'
import Card from '../components/ui/Card'
import RoomList from '../components/voice/RoomList'
import ActiveRoom from '../components/voice/ActiveRoom'
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
    <Card className="mt-4 p-4 text-center">
      <p className="text-slate-400">
        <Link to="/login" className="font-medium text-indigo-400 hover:text-indigo-300">Sign in</Link> to join voice rooms
      </p>
    </Card>
  ) : null

  if (!currentRoom) {
    return (
      <RoomList
        rooms={rooms}
        roomsLoading={roomsLoading}
        roomsError={roomsError}
        isConnected={voice.isConnected}
        connectedRoomSlug={voice.connectedRoomSlug}
        roomParticipantCounts={voice.roomParticipantCounts}
        getAvatarUrl={voice.getAvatarUrl}
        authGate={authGate}
      />
    )
  }

  return (
    <ActiveRoom
      room={currentRoom}
      user={user}
      displayParticipants={displayParticipants}
      isConnectedToThisRoom={isConnectedToThisRoom}
      isConnected={voice.isConnected}
      isConnecting={voice.isConnecting}
      isMuted={voice.isMuted}
      isDeafened={voice.isDeafened}
      isSpeaking={voice.isSpeaking}
      connectedRoomName={voice.connectedRoomName}
      connectError={voice.connectError}
      joinRoom={voice.joinRoom}
      leaveRoom={voice.leaveRoom}
      toggleMute={voice.toggleMute}
      toggleDeafen={voice.toggleDeafen}
    />
  )
}
