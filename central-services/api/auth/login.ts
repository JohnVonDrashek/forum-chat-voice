import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getHubSupabaseAnon } from '../_lib/supabase.js'
import { rateLimit } from '../_lib/rate-limit.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  if (!rateLimit(req, res, { key: 'login', limit: 10, windowMs: 60_000 })) return

  const { email, password } = req.body || {}

  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' })
  }

  const supabase = getHubSupabaseAnon()

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  })

  if (error) {
    console.error('[login] Supabase auth.signInWithPassword error:', error)
    return res.status(401).json({ error: 'Invalid email or password' })
  }

  return res.status(200).json({
    user: {
      id: data.user.id,
      email: data.user.email,
    },
    session: {
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      expires_at: new Date((data.session.expires_at ?? 0) * 1000).toISOString(),
    },
  })
}
