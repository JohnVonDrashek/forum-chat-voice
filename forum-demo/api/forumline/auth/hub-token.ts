import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { parseCookies } from '@johnvondrashek/forumline-server-sdk'
import { getForumlineServer } from '../../_lib/forumline-server.js'
import { adaptRequest, adaptResponse } from '../../_lib/vercel-adapter.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'GET') {
    // Server-side gate: verify user still has forumline_id before returning hub token
    const cookies = parseCookies(req.headers.cookie || '')
    const localUserId = cookies['forumline_user_id']

    if (localUserId) {
      const supabaseUrl = process.env.VITE_SUPABASE_URL!
      const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
      const sb = createClient(supabaseUrl, serviceRoleKey)

      const { data: profile } = await sb
        .from('profiles')
        .select('forumline_id')
        .eq('id', localUserId)
        .single()

      if (!profile?.forumline_id) {
        // User disconnected — refuse to hand out the hub token
        return res.status(200).json({ hub_access_token: null })
      }
    }
  }

  // Fall through to SDK handler
  const server = getForumlineServer()
  return server.hubTokenHandler()(adaptRequest(req), adaptResponse(res))
}
