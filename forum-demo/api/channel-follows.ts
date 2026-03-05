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

  // GET — list followed categories for current user
  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('channel_follows')
      .select('category_id')
      .eq('user_id', userId)

    if (error) return res.status(500).json({ error: error.message })
    return res.json((data || []).map(f => f.category_id))
  }

  // POST — follow a category
  if (req.method === 'POST') {
    const { category_id } = req.body as { category_id?: string }
    if (!category_id) return res.status(400).json({ error: 'Missing category_id' })

    const { error } = await supabase
      .from('channel_follows')
      .upsert(
        { user_id: userId, category_id },
        { onConflict: 'user_id,category_id' }
      )

    if (error) return res.status(500).json({ error: error.message })
    return res.json({ ok: true })
  }

  // DELETE — unfollow a category
  if (req.method === 'DELETE') {
    const { category_id } = req.body as { category_id?: string }
    if (!category_id) return res.status(400).json({ error: 'Missing category_id' })

    const { error } = await supabase
      .from('channel_follows')
      .delete()
      .eq('user_id', userId)
      .eq('category_id', category_id)

    if (error) return res.status(500).json({ error: error.message })
    return res.json({ ok: true })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
