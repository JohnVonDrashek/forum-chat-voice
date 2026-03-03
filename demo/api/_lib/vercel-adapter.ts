import type { VercelRequest, VercelResponse } from '@vercel/node'
import type { GenericRequest, GenericResponse } from '@forumline/server-sdk'

/** Parse cookies from a Cookie header string */
function parseCookies(cookieHeader: string): Record<string, string> {
  const cookies: Record<string, string> = {}
  for (const pair of cookieHeader.split(';')) {
    const [key, ...rest] = pair.trim().split('=')
    if (key) cookies[key] = rest.join('=')
  }
  return cookies
}

/** Adapt a VercelRequest into a GenericRequest */
export function adaptRequest(req: VercelRequest): GenericRequest {
  return {
    method: req.method || 'GET',
    url: req.url || '/',
    headers: req.headers as Record<string, string | undefined>,
    query: (req.query || {}) as Record<string, string | string[] | undefined>,
    cookies: parseCookies(req.headers.cookie || ''),
    body: req.body,
  }
}

/** Adapt a VercelResponse into a GenericResponse */
export function adaptResponse(res: VercelResponse): GenericResponse {
  return {
    status: (code: number) => {
      res.status(code)
      return {
        json: (body: unknown) => res.json(body),
        end: () => res.end(),
      }
    },
    redirect: (statusCode: number, url: string) => res.redirect(statusCode, url),
    setHeader: (name: string, value: string | string[]) => res.setHeader(name, value),
    writeHead: (code: number, headers: Record<string, string>) => res.writeHead(code, headers),
    write: (data: string) => res.write(data),
    end: () => res.end(),
    on: (event: string, handler: () => void) => {
      // VercelRequest (IncomingMessage) has the 'close' event, not VercelResponse
      // But for SSE cleanup we need to listen on the response's underlying socket
      if (event === 'close') {
        res.on('close', handler)
      }
    },
  }
}
