import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { parseCookies } from '@johnvondrashek/forumline-server-sdk'
import { getForumlineServer } from '../../_lib/forumline-server.js'
import { adaptRequest, adaptResponse } from '../../_lib/vercel-adapter.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // DELETE = disconnect: revoke hub session + clear cookies
  if (req.method === 'DELETE') {
    // Revoke the hub session server-side so the token is dead everywhere
    const cookies = parseCookies(req.headers.cookie || '')
    const hubAccessToken = cookies['hub_access_token']
    if (hubAccessToken) {
      const hubSupabaseUrl = process.env.FORUMLINE_HUB_SUPABASE_URL
      const hubServiceKey = process.env.FORUMLINE_HUB_SERVICE_ROLE_KEY
      if (hubSupabaseUrl && hubServiceKey) {
        try {
          const hubSb = createClient(hubSupabaseUrl, hubServiceKey)
          // Get the hub user from the token, then sign them out
          const { data: { user } } = await hubSb.auth.getUser(hubAccessToken)
          if (user) {
            await hubSb.auth.admin.signOut(hubAccessToken)
          }
        } catch (err) {
          console.error('[Forumline:Session] Failed to revoke hub session:', err)
        }
      }
    }

    // Clear all Forumline cookies
    res.setHeader('Set-Cookie', [
      'forumline_identity=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0',
      'forumline_user_id=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0',
      'hub_access_token=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0',
    ])
    return res.status(200).json({ ok: true })
  }

  const server = getForumlineServer()
  return server.sessionHandler()(adaptRequest(req), adaptResponse(res))
}
