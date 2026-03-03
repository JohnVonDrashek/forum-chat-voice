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
    return res.status(200).json({ participants: [] })
  }

  // Convert wss:// to https:// for the REST API
  const httpHost = livekitUrl.replace('wss://', 'https://').replace('ws://', 'http://')
  const roomService = new RoomServiceClient(httpHost, apiKey, apiSecret)

  const roomName = req.query.room as string | undefined
  if (!roomName) {
    return res.status(400).json({ error: 'room query parameter is required' })
  }

  try {
    const participants = await roomService.listParticipants(roomName)
    return res.status(200).json({
      participants: participants.map(p => ({
        identity: p.identity,
        name: p.name || p.identity,
      })),
    })
  } catch {
    // Room doesn't exist yet (no one has joined) — return empty
    return res.status(200).json({ participants: [] })
  }
}
