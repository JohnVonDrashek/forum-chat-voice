import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getForumlineServer } from '../_lib/forumline-server.js'
import { adaptRequest, adaptResponse } from '../_lib/vercel-adapter.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const server = getForumlineServer()
  return server.unreadHandler()(adaptRequest(req), adaptResponse(res))
}
