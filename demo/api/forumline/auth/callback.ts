import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getForumlineServer } from '../../_lib/forumline-server'
import { adaptRequest, adaptResponse } from '../../_lib/vercel-adapter'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const server = getForumlineServer()
  return server.authCallbackHandler()(adaptRequest(req), adaptResponse(res))
}
