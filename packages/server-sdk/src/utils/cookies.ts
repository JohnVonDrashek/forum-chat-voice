import jwt from 'jsonwebtoken'

/** Parse a Cookie header string into a key-value record */
export function parseCookies(cookieHeader: string): Record<string, string> {
  const cookies: Record<string, string> = {}
  for (const pair of cookieHeader.split(';')) {
    const [key, ...rest] = pair.trim().split('=')
    if (key) cookies[key] = rest.join('=')
  }
  return cookies
}

/** Decode a JWT payload without verifying the signature (unsafe — use verifyJwt for trusted contexts) */
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const payload = Buffer.from(parts[1], 'base64url').toString('utf8')
    return JSON.parse(payload)
  } catch {
    return null
  }
}

/** Verify a JWT signature and return the decoded payload, or null if invalid */
export function verifyJwt(token: string, secret: string): Record<string, unknown> | null {
  try {
    return jwt.verify(token, secret) as Record<string, unknown>
  } catch {
    return null
  }
}
