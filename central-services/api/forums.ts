import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getHubSupabase, handleCors } from './_lib/supabase'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleCors(req, res)) return

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const supabase = getHubSupabase()

  const { data: forums, error } = await supabase
    .from('forumline_forums')
    .select('id, domain, name, icon_url, api_base, web_base, capabilities, description')
    .eq('approved', true)
    .order('name')

  if (error) {
    return res.status(500).json({ error: 'Failed to fetch forums' })
  }

  return res.status(200).json(forums || [])
}
