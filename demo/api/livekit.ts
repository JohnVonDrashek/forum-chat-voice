import type { VercelRequest, VercelResponse } from '@vercel/node'
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk'
import { createClient } from '@supabase/supabase-js'

function getLiveKitClient() {
  const apiKey = process.env.LIVEKIT_API_KEY
  const apiSecret = process.env.LIVEKIT_API_SECRET
  const livekitUrl = process.env.LIVEKIT_URL
  if (!apiKey || !apiSecret || !livekitUrl) return null

  const httpHost = livekitUrl.replace('wss://', 'https://').replace('ws://', 'http://')
  return { roomService: new RoomServiceClient(httpHost, apiKey, apiSecret), apiKey, apiSecret }
}

async function handleToken(req: VercelRequest, res: VercelResponse) {
  const { roomName, participantName } = req.body || {}
  if (!roomName || !participantName) {
    return res.status(400).json({ error: 'roomName and participantName are required' })
  }

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

  const lk = getLiveKitClient()
  if (!lk) {
    return res.status(500).json({ error: 'LiveKit not configured' })
  }

  // Remove user from any existing rooms (enforce one room at a time, clean up ghosts)
  try {
    const activeRooms = await lk.roomService.listRooms()
    await Promise.all(activeRooms.map(async (room) => {
      try {
        await lk.roomService.removeParticipant(room.name, user.id)
      } catch {
        // Not in this room — ignore
      }
    }))
  } catch {
    // If listing fails, continue anyway
  }

  const at = new AccessToken(lk.apiKey, lk.apiSecret, {
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

async function handleParticipants(req: VercelRequest, res: VercelResponse) {
  const lk = getLiveKitClient()
  if (!lk) return res.status(200).json({ participants: [] })

  const roomName = req.query.room as string | undefined
  if (!roomName) {
    return res.status(400).json({ error: 'room query parameter is required' })
  }

  try {
    const participants = await lk.roomService.listParticipants(roomName)
    return res.status(200).json({
      participants: participants.map(p => ({
        identity: p.identity,
        name: p.name || p.identity,
      })),
    })
  } catch {
    return res.status(200).json({ participants: [] })
  }
}

async function handleAllParticipants(_req: VercelRequest, res: VercelResponse) {
  const lk = getLiveKitClient()
  if (!lk) return res.status(200).json({ rooms: {} })

  try {
    const activeRooms = await lk.roomService.listRooms()
    const result: Record<string, { count: number; names: string[]; identities: string[] }> = {}

    await Promise.all(activeRooms.map(async (room) => {
      try {
        const participants = await lk.roomService.listParticipants(room.name)
        if (participants.length > 0) {
          result[room.name] = {
            count: participants.length,
            names: participants.map(p => p.name || p.identity),
            identities: participants.map(p => p.identity),
          }
        }
      } catch {
        // Skip rooms that fail
      }
    }))

    return res.status(200).json({ rooms: result })
  } catch {
    return res.status(200).json({ rooms: {} })
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // POST → generate token
  if (req.method === 'POST') {
    return handleToken(req, res)
  }

  // GET with ?room=X → single room participants
  if (req.method === 'GET' && req.query.room) {
    return handleParticipants(req, res)
  }

  // GET without room → all rooms' participants
  if (req.method === 'GET') {
    return handleAllParticipants(req, res)
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
