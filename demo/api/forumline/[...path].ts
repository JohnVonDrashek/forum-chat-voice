import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getForumlineServer } from '../_lib/forumline-server.js'
import { adaptRequest, adaptResponse } from '../_lib/vercel-adapter.js'

/**
 * Catch-all route for thin ForumlineServer pass-through handlers.
 * Dispatches based on path segments:
 *   /api/forumline/notifications       → notificationsHandler
 *   /api/forumline/unread              → unreadHandler
 *   /api/forumline/notifications/read  → notificationReadHandler
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const path = req.query.path as string[] | undefined
  if (!path) {
    return res.status(404).json({ error: 'Not found' })
  }

  const route = path.join('/')
  const server = getForumlineServer()

  switch (route) {
    case 'notifications':
      return server.notificationsHandler()(adaptRequest(req), adaptResponse(res))
    case 'unread':
      return server.unreadHandler()(adaptRequest(req), adaptResponse(res))
    case 'notifications/read':
      return server.notificationReadHandler()(adaptRequest(req), adaptResponse(res))
    default:
      return res.status(404).json({ error: 'Not found' })
  }
}
