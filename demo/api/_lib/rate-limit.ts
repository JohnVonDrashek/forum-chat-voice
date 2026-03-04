import type { VercelRequest, VercelResponse } from '@vercel/node'

interface RateLimitEntry {
  count: number
  resetAt: number
}

const store = new Map<string, RateLimitEntry>()

setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of store) {
    if (now > entry.resetAt) store.delete(key)
  }
}, 60_000)

/**
 * In-memory rate limiter for Vercel serverless functions.
 * Returns true if the request is allowed, false if rate-limited (and sends 429).
 */
export function rateLimit(
  req: VercelRequest,
  res: VercelResponse,
  opts: { key: string; limit: number; windowMs: number }
): boolean {
  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || 'unknown'
  const storeKey = `${opts.key}:${ip}`
  const now = Date.now()

  const entry = store.get(storeKey)
  if (!entry || now > entry.resetAt) {
    store.set(storeKey, { count: 1, resetAt: now + opts.windowMs })
    return true
  }

  entry.count++
  if (entry.count > opts.limit) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000)
    res.setHeader('Retry-After', String(retryAfter))
    res.status(429).json({ error: 'Too many requests. Please try again later.' })
    return false
  }

  return true
}
