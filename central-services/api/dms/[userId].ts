import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getHubSupabase, getAuthenticatedUser } from '../_lib/supabase.js'
import { rateLimit } from '@johnvondrashek/forumline-server-sdk'
import { messageContentSchema } from '@johnvondrashek/forumline-protocol/validation'
import { getMessages, sendMessage } from '../_lib/services/dms.js'

/**
 * GET  /api/dms/:userId — Fetch messages with a specific user
 * POST /api/dms/:userId — Send a message to a specific user
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const user = await getAuthenticatedUser(req, res)
  if (!user) return

  const { userId } = req.query as { userId: string }
  if (!userId) {
    return res.status(400).json({ error: 'userId is required' })
  }

  if (userId === user.id) {
    return res.status(400).json({ error: 'Cannot message yourself' })
  }

  const supabase = getHubSupabase()

  if (req.method === 'GET') {
    const limit = Number(req.query.limit) || 50
    const before = req.query.before as string | undefined

    const { data, error } = await getMessages(supabase, user.id, userId, { limit, before })

    if (error) {
      return res.status(500).json({ error })
    }

    return res.status(200).json(data)
  } else if (req.method === 'POST') {
    if (!rateLimit(req, res, { key: 'dm-send', limit: 30, windowMs: 60_000 })) return

    const { content } = req.body || {}

    const contentResult = messageContentSchema.safeParse(content?.trim?.())
    if (!contentResult.success) {
      return res.status(400).json({ error: contentResult.error.issues[0].message })
    }

    const { data, error, notFound } = await sendMessage(supabase, user.id, userId, content.trim())

    if (notFound) {
      return res.status(404).json({ error })
    }

    if (error) {
      return res.status(500).json({ error })
    }

    return res.status(201).json(data)
  } else {
    return res.status(405).json({ error: 'Method not allowed' })
  }
}
