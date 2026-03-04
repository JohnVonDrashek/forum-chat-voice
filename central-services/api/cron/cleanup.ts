import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getHubSupabase } from '../_lib/supabase.js'

/**
 * Cron job: Delete expired or used OAuth authorization codes.
 * Scheduled via vercel.json cron config.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Verify cron secret to prevent unauthorized access
  const authHeader = req.headers.authorization
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const supabase = getHubSupabase()

  // Delete used codes older than 1 hour and expired codes
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()

  const { error: usedError, count: usedCount } = await supabase
    .from('forumline_auth_codes')
    .delete({ count: 'exact' })
    .eq('used', true)
    .lt('created_at', oneHourAgo)

  const { error: expiredError, count: expiredCount } = await supabase
    .from('forumline_auth_codes')
    .delete({ count: 'exact' })
    .lt('expires_at', new Date().toISOString())

  if (usedError || expiredError) {
    console.error('[cron/cleanup] Error cleaning auth codes:', usedError || expiredError)
    return res.status(500).json({ error: 'Cleanup failed' })
  }

  console.log(`[cron/cleanup] Deleted ${usedCount ?? 0} used + ${expiredCount ?? 0} expired auth codes`)

  return res.status(200).json({
    status: 'ok',
    deleted: { used: usedCount ?? 0, expired: expiredCount ?? 0 },
  })
}
