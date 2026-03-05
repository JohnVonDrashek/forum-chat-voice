import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { cors } from 'hono/cors'
import { wrapHandler } from './vercel-compat.js'

const app = new Hono()

// ---------------------------------------------------------------------------
// Security headers (from vercel.json)
// ---------------------------------------------------------------------------

app.use('*', async (c, next) => {
  await next()
  c.header('X-Content-Type-Options', 'nosniff')
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin')
  c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  c.header(
    'Content-Security-Policy',
    "frame-ancestors 'self' https://app.forumline.net",
  )
  c.header(
    'Permissions-Policy',
    'microphone=(self "https://app.forumline.net"), display-capture=(self "https://app.forumline.net")',
  )
})

// ---------------------------------------------------------------------------
// .well-known (forumline manifest — needs CORS for hub discovery)
// ---------------------------------------------------------------------------

app.use(
  '/.well-known/*',
  cors({ origin: '*' }),
  serveStatic({ root: './dist' }),
)

// ---------------------------------------------------------------------------
// API routes
// ---------------------------------------------------------------------------

app.all(
  '/api/auth/signup',
  wrapHandler(() => import('../api/auth/signup.js')),
)
app.all(
  '/api/channel-follows',
  wrapHandler(() => import('../api/channel-follows.js')),
)
app.all(
  '/api/forumline/auth/callback',
  wrapHandler(() => import('../api/forumline/auth/callback.js')),
)
app.all(
  '/api/forumline/auth/hub-token',
  wrapHandler(() => import('../api/forumline/auth/hub-token.js')),
)
app.all(
  '/api/forumline/auth/session',
  wrapHandler(() => import('../api/forumline/auth/session.js')),
)
app.all(
  '/api/forumline/auth',
  wrapHandler(() => import('../api/forumline/auth.js')),
)
app.all(
  '/api/forumline/notifications/read',
  wrapHandler(() => import('../api/forumline/notifications/read.js')),
)
app.all(
  '/api/forumline/notifications/stream',
  wrapHandler(() => import('../api/forumline/notifications/stream.js')),
)
app.all(
  '/api/forumline/notifications',
  wrapHandler(() => import('../api/forumline/notifications.js')),
)
app.all(
  '/api/forumline/unread',
  wrapHandler(() => import('../api/forumline/unread.js')),
)
app.all(
  '/api/livekit',
  wrapHandler(() => import('../api/livekit.js')),
)
app.all(
  '/api/notification-preferences',
  wrapHandler(() => import('../api/notification-preferences.js')),
)

// ---------------------------------------------------------------------------
// Static files (Vite build output) + SPA fallback
// ---------------------------------------------------------------------------

app.use(
  '/assets/*',
  serveStatic({ root: './dist' }),
)

app.use(
  '/forum.svg',
  serveStatic({ root: './dist', path: '/forum.svg' }),
)

app.use(
  '/favicon.ico',
  serveStatic({ root: './dist', path: '/favicon.ico' }),
)

// SPA fallback — serve index.html for navigation routes only (not missing files)
app.get('*', async (c, next) => {
  const path = new URL(c.req.url).pathname
  // If the path has a file extension, it's a missing static file — return 404
  if (path.match(/\.\w+$/)) {
    return c.notFound()
  }
  return serveStatic({ root: './dist', path: '/index.html' })(c, next)
})

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------

const port = Number(process.env.PORT) || 3000

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`forum-demo server listening on http://localhost:${info.port}`)
})
