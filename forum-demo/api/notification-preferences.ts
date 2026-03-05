import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL!
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY!
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

async function getAuthUser(req: VercelRequest): Promise<string | null> {
  const auth = req.headers.authorization
  if (!auth?.startsWith('Bearer ')) return null
  const token = auth.slice(7)
  const supabase = createClient(supabaseUrl, supabaseAnonKey)
  const { data: { user }, error } = await supabase.auth.getUser(token)
  if (error || !user) return null
  return user.id
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const userId = await getAuthUser(req)
  if (!userId) return res.status(401).json({ error: 'Unauthorized' })

  const supabase = createClient(supabaseUrl, serviceRoleKey)

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('notification_preferences')
      .select('category, enabled')
      .eq('user_id', userId)

    if (error) return res.status(500).json({ error: error.message })
    return res.json(data || [])
  }

  if (req.method === 'PUT') {
    const { category, enabled } = req.body as { category: string; enabled: boolean }

    const validCategories = ['reply', 'mention', 'chat_mention', 'dm', 'new_thread']
    if (!validCategories.includes(category) || typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'Invalid category or enabled value' })
    }

    const { error } = await supabase
      .from('notification_preferences')
      .upsert(
        { user_id: userId, category, enabled, updated_at: new Date().toISOString() },
        { onConflict: 'user_id,category' }
      )

    if (error) return res.status(500).json({ error: error.message })
    return res.json({ ok: true })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
