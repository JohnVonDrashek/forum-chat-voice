/*
 * Cookie and JWT Utilities
 *
 * Provides low-level helpers for reading session cookies and verifying Forumline identity tokens on the server side.
 *
 * It must:
 * - Parse raw Cookie headers into key-value pairs so forum servers can read Forumline session cookies without a framework dependency
 * - Decode JWT payloads for quick, unsigned inspection of identity tokens (e.g., displaying the user's name before full verification)
 * - Verify JWT signatures against the shared Forumline secret to securely authenticate users and reject tampered or expired tokens
 */

/** Parse a Cookie header string into a key-value record */
export function parseCookies(cookieHeader: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const pair of cookieHeader.split(';')) {
    const [key, ...rest] = pair.trim().split('=');
    if (key) cookies[key] = rest.join('=');
  }
  return cookies;
}

/** Decode a JWT payload without verifying the signature (unsafe — use verifyJwt for trusted contexts) */
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = Buffer.from(parts[1], 'base64url').toString('utf8');
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

/** Verify a JWT signature and return the decoded payload, or null if invalid */
export async function verifyJwt(
  token: string,
  secret: string,
): Promise<Record<string, unknown> | null> {
  try {
    const jwt = await import('jsonwebtoken');
    return jwt.default.verify(token, secret) as Record<string, unknown>;
  } catch {
    return null;
  }
}
