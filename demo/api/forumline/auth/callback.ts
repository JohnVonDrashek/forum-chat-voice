import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getForumlineServer } from '../../_lib/forumline-server.js'
import { adaptRequest, adaptResponse } from '../../_lib/vercel-adapter.js'

const siteUrl = process.env.VITE_SITE_URL || 'https://forum-chat-voice.vercel.app'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const server = getForumlineServer()
  try {
    return await server.authCallbackHandler()(adaptRequest(req), adaptResponse(res))
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'EmailCollisionError') {
      return res.redirect(302, `${siteUrl}/login?error=email_exists`)
    }
    console.error('[Forumline:Callback] Error:', err)
    return res.redirect(302, `${siteUrl}/login?error=auth_failed`)
  }
}
