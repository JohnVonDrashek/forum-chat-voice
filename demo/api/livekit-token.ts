import type { VercelRequest, VercelResponse } from '@vercel/node'
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk'
import { createClient } from '@supabase/supabase-js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { roomName, participantName } = req.body || {}
  if (!roomName || !participantName) {
    return res.status(400).json({ error: 'roomName and participantName are required' })
  }

  // Validate Supabase auth
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authorization token' })
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseAnonKey) {
    return res.status(500).json({ error: 'Supabase not configured' })
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey)
  const jwt = authHeader.slice(7)
  const { data: { user }, error: authError } = await supabase.auth.getUser(jwt)
  if (authError || !user) {
    return res.status(401).json({ error: 'Invalid auth token' })
  }

  // Generate LiveKit token
  const apiKey = process.env.LIVEKIT_API_KEY
  const apiSecret = process.env.LIVEKIT_API_SECRET
  const livekitUrl = process.env.LIVEKIT_URL
  if (!apiKey || !apiSecret || !livekitUrl) {
    return res.status(500).json({ error: 'LiveKit not configured' })
  }

  // Remove user from any existing rooms (enforce one room at a time, clean up ghosts)
  const httpHost = livekitUrl.replace('wss://', 'https://').replace('ws://', 'http://')
  const roomService = new RoomServiceClient(httpHost, apiKey, apiSecret)
  try {
    const activeRooms = await roomService.listRooms()
    await Promise.all(activeRooms.map(async (room) => {
      try {
        await roomService.removeParticipant(room.name, user.id)
      } catch {
        // Not in this room — ignore
      }
    }))
  } catch {
    // If listing fails, continue anyway
  }

  const at = new AccessToken(apiKey, apiSecret, {
    identity: user.id,
    name: participantName,
    ttl: '6h',
  })
  at.addGrant({
    room: roomName,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
  })

  const token = await at.toJwt()
  return res.status(200).json({ token })
}
