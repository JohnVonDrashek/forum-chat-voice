/**
 * Vercel-to-Hono compatibility adapter.
 *
 * Creates VercelRequest / VercelResponse-compatible objects from a Hono context
 * so existing API handler files require **zero changes**.
 *
 * SSE streaming: when a handler calls `writeHead()`, the adapter switches to
 * writing directly on the raw Node.js ServerResponse (exposed by @hono/node-server
 * as `c.env.outgoing`). Because `headersSent` becomes true, @hono/node-server
 * skips its own response writing.
 */

import type { Context } from 'hono'
import type { IncomingMessage, ServerResponse } from 'node:http'

type HandlerFn = (req: any, res: any) => any

// ---------------------------------------------------------------------------
// Request builder
// ---------------------------------------------------------------------------

async function buildRequest(
  c: Context,
  pathParams: Record<string, string>,
) {
  const url = new URL(c.req.url)

  // Merge search params (Vercel style: single value = string, multiple = string[])
  const query: Record<string, string | string[]> = {}
  for (const [key, value] of url.searchParams) {
    const existing = query[key]
    if (existing !== undefined) {
      query[key] = Array.isArray(existing)
        ? [...existing, value]
        : [existing, value]
    } else {
      query[key] = value
    }
  }

  // Merge Hono path params into query (Vercel puts [param] into req.query)
  for (const [key, value] of Object.entries(pathParams)) {
    query[key] = value
  }

  // Parse body for write methods
  let body: any = undefined
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(c.req.method)) {
    const ct = c.req.header('content-type') || ''
    if (ct.includes('application/json')) {
      try {
        body = await c.req.json()
      } catch {
        body = {}
      }
    } else if (ct.includes('application/x-www-form-urlencoded') || ct.includes('multipart/form-data')) {
      const formData = await c.req.formData()
      body = Object.fromEntries(formData.entries())
    } else {
      const text = await c.req.text()
      body = text || undefined
    }
  }

  // Parse cookies
  const cookieHeader = c.req.header('cookie') || ''
  const cookies: Record<string, string> = {}
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    const k = part.slice(0, eq).trim()
    const v = part.slice(eq + 1).trim()
    if (k) cookies[k] = v
  }

  // Headers as Record (matching Vercel's shape)
  const headers: Record<string, string | undefined> = {}
  c.req.raw.headers.forEach((value, key) => {
    headers[key] = value
  })

  const nodeReq = (c.env as any).incoming as IncomingMessage

  return {
    method: c.req.method,
    url: url.pathname + url.search,
    headers,
    query,
    cookies,
    body,
    on(event: string, handler: () => void) {
      if (event === 'close') nodeReq.on('close', handler)
    },
  }
}

// ---------------------------------------------------------------------------
// Response builder
// ---------------------------------------------------------------------------

function buildResponse(c: Context): {
  res: any
  getResponse: () => Promise<Response>
} {
  const nodeRes = (c.env as any).outgoing as ServerResponse
  let isStreaming = false
  let statusCode = 200
  const _headers: [string, string][] = []

  let resolveResponse!: (r: Response) => void
  const responsePromise = new Promise<Response>((resolve) => {
    resolveResponse = resolve
  })

  function collectHeaders(): HeadersInit {
    const h = new Headers()
    for (const [k, v] of _headers) {
      h.append(k, v)
    }
    return h
  }

  const res = {
    status(code: number) {
      statusCode = code
      return this
    },

    json(body: unknown) {
      const headers = collectHeaders()
      headers.set('Content-Type', 'application/json')
      resolveResponse(
        new Response(JSON.stringify(body), { status: statusCode, headers }),
      )
    },

    send(body: string) {
      const headers = collectHeaders()
      if (!headers.has('Content-Type')) {
        headers.set('Content-Type', 'text/html; charset=utf-8')
      }
      resolveResponse(new Response(body, { status: statusCode, headers }))
    },

    end() {
      if (isStreaming) {
        nodeRes.end()
      } else {
        resolveResponse(
          new Response(null, { status: statusCode, headers: collectHeaders() }),
        )
      }
    },

    redirect(statusOrUrl: number | string, maybeUrl?: string) {
      // Support both redirect(url) and redirect(status, url)
      let code: number
      let url: string
      if (typeof statusOrUrl === 'string') {
        code = 302
        url = statusOrUrl
      } else {
        code = statusOrUrl
        url = maybeUrl!
      }
      const headers = collectHeaders()
      headers.set('Location', url)
      resolveResponse(new Response(null, { status: code, headers }))
    },

    setHeader(name: string, value: string | string[]) {
      // Remove any existing values for this header
      for (let i = _headers.length - 1; i >= 0; i--) {
        if (_headers[i][0].toLowerCase() === name.toLowerCase()) {
          _headers.splice(i, 1)
        }
      }
      if (Array.isArray(value)) {
        for (const v of value) {
          _headers.push([name, v])
        }
      } else {
        _headers.push([name, value])
      }
      return this
    },

    // --- SSE / streaming support ---

    writeHead(code: number, headers?: Record<string, string>) {
      isStreaming = true
      // Apply accumulated headers + the ones passed here
      const merged: Record<string, string | string[]> = {}
      for (const [k, v] of _headers) {
        const existing = merged[k]
        if (existing !== undefined) {
          merged[k] = Array.isArray(existing)
            ? [...existing, v]
            : [existing, v]
        } else {
          merged[k] = v
        }
      }
      if (headers) {
        for (const [k, v] of Object.entries(headers)) {
          merged[k] = v
        }
      }
      nodeRes.writeHead(code, merged)
      // Resolve with empty response — @hono/node-server will see headersSent
      // and skip its own response writing
      resolveResponse(new Response(null))
    },

    write(data: string) {
      nodeRes.write(data)
      return true
    },

    on(event: string, handler: () => void) {
      nodeRes.on(event, handler)
    },
  }

  return { res, getResponse: () => responsePromise }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Wrap a Vercel-style handler (default export) for use with Hono.
 *
 * Usage:
 *   app.all('/api/foo', wrapHandler(() => import('../api/foo.js')))
 *
 * Path params (e.g. `:userId`) are merged into `req.query` to match
 * Vercel's `[userId]` convention.
 */
export function wrapHandler(importFn: () => Promise<{ default: HandlerFn }>) {
  return async (c: Context) => {
    const mod = await importFn()
    const pathParams = c.req.param() as Record<string, string>
    const req = await buildRequest(c, pathParams)
    const { res, getResponse } = buildResponse(c)

    // Run the handler — it may resolve sync (normal) or set up SSE (async)
    await mod.default(req, res)

    return getResponse()
  }
}
