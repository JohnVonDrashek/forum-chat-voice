interface RateLimitEntry {
  count: number
  resetAt: number
}

const store = new Map<string, RateLimitEntry>()

// Use unref() so this timer doesn't keep serverless functions alive
const cleanup = setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of store) {
    if (now > entry.resetAt) store.delete(key)
  }
}, 60_000)
if (typeof cleanup.unref === 'function') cleanup.unref()

/**
 * In-memory rate limiter for serverless functions.
 * Returns true if the request is allowed, false if rate-limited (and sends 429).
 *
 * Works with any request/response objects that have standard headers/status methods.
 */
export function rateLimit(
  req: { headers: Record<string, string | string[] | undefined> },
  res: {
    setHeader: (name: string, value: string | string[]) => void
    status: (code: number) => { json: (body: unknown) => void }
  },
  opts: { key: string; limit: number; windowMs: number }
): boolean {
  const forwarded = req.headers['x-forwarded-for']
  const ip = (typeof forwarded === 'string' ? forwarded : forwarded?.[0])?.split(',')[0]?.trim() || 'unknown'
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
