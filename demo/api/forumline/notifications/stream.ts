import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

/**
 * GET /api/forumline/notifications/stream
 * SSE notification stream using Supabase Realtime.
 * This endpoint uses Supabase-specific subscriptions, so it stays as a
 * demo-specific implementation rather than using the generic server-sdk handler.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authorization token' })
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseAnonKey) {
    return res.status(500).json({ error: 'Supabase not configured' })
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey)
  const jwt = authHeader.slice(7)
  const { data: { user }, error: authError } = await supabase.auth.getUser(jwt)
  if (authError || !user) {
    return res.status(401).json({ error: 'Invalid auth token' })
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  })

  const forumDomain = 'forum-chat-voice.vercel.app'

  const channel = supabase
    .channel(`forumline-notif-${user.id}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
        filter: `user_id=eq.${user.id}`,
      },
      (payload) => {
        const n = payload.new as {
          id: string; type: string; title: string; message: string
          link: string | null; read: boolean; created_at: string
        }
        const event = {
          id: n.id, type: n.type, title: n.title, body: n.message,
          timestamp: n.created_at, read: n.read, link: n.link || '/',
          forum_domain: forumDomain,
        }
        res.write(`data: ${JSON.stringify(event)}\n\n`)
      }
    )
    .subscribe()

  res.write(':connected\n\n')

  const heartbeat = setInterval(() => {
    res.write(':heartbeat\n\n')
  }, 30000)

  req.on('close', () => {
    clearInterval(heartbeat)
    channel.unsubscribe()
    res.end()
  })
}
