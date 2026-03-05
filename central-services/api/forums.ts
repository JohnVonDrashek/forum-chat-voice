import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getHubSupabase, getAuthenticatedUser } from './_lib/supabase.js'
import { forumUrlSchema } from '@johnvondrashek/forumline-protocol/validation'
import { registerForum } from './_lib/services/forums.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const supabase = getHubSupabase()

  // GET — list approved forums
  if (req.method === 'GET') {
    const { data: forums, error } = await supabase
      .from('forumline_forums')
      .select('id, domain, name, icon_url, api_base, web_base, capabilities, description')
      .eq('approved', true)
      .order('name')

    if (error) return res.status(500).json({ error: 'Failed to fetch forums' })
    return res.status(200).json(forums || [])
  }

  // POST — register a new forum
  if (req.method === 'POST') {
    const user = await getAuthenticatedUser(req, res)
    if (!user) return

    const { domain, name, api_base, web_base, capabilities, description, redirect_uris } = req.body || {}

    if (!domain || !name || !api_base || !web_base) {
      return res.status(400).json({ error: 'domain, name, api_base, and web_base are required' })
    }

    const apiBaseResult = forumUrlSchema.safeParse(api_base)
    if (!apiBaseResult.success) {
      return res.status(400).json({ error: `api_base: ${apiBaseResult.error.issues[0].message}` })
    }
    const webBaseResult = forumUrlSchema.safeParse(web_base)
    if (!webBaseResult.success) {
      return res.status(400).json({ error: `web_base: ${webBaseResult.error.issues[0].message}` })
    }

    const { data, error, status } = await registerForum(supabase, user.id, {
      domain, name, api_base, web_base, capabilities, description, redirect_uris,
    })

    if (error) return res.status(status || 500).json({ error })
    return res.status(201).json(data)
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
