import type { VercelRequest, VercelResponse } from '@vercel/node'
import { RoomServiceClient } from 'livekit-server-sdk'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const apiKey = process.env.LIVEKIT_API_KEY
  const apiSecret = process.env.LIVEKIT_API_SECRET
  const livekitUrl = process.env.LIVEKIT_URL
  if (!apiKey || !apiSecret || !livekitUrl) {
    return res.status(200).json({ rooms: {} })
  }

  const httpHost = livekitUrl.replace('wss://', 'https://').replace('ws://', 'http://')
  const roomService = new RoomServiceClient(httpHost, apiKey, apiSecret)

  try {
    const activeRooms = await roomService.listRooms()
    const result: Record<string, { count: number; names: string[]; identities: string[] }> = {}

    await Promise.all(activeRooms.map(async (room) => {
      try {
        const participants = await roomService.listParticipants(room.name)
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
