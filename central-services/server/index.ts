import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { cors } from 'hono/cors'
import { wrapHandler } from './vercel-compat.js'

const app = new Hono()

// ---------------------------------------------------------------------------
// CORS (from vercel.json — only for /api/ routes)
// ---------------------------------------------------------------------------

app.use(
  '/api/*',
  cors({
    origin: 'https://demo.forumline.net',
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Authorization', 'Content-Type'],
    credentials: true,
  }),
)

// ---------------------------------------------------------------------------
// Security headers (from vercel.json)
// ---------------------------------------------------------------------------

app.use('/api/*', async (c, next) => {
  await next()
  c.header('X-Content-Type-Options', 'nosniff')
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin')
  c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  c.header('X-Frame-Options', 'DENY')
})

// ---------------------------------------------------------------------------
// API routes
// ---------------------------------------------------------------------------

app.all(
  '/api/auth/login',
  wrapHandler(() => import('../api/auth/login.js')),
)
app.all(
  '/api/auth/signup',
  wrapHandler(() => import('../api/auth/signup.js')),
)
app.all(
  '/api/dms/:userId/read',
  wrapHandler(() => import('../api/dms/[userId]/read.js')),
)
app.all(
  '/api/dms/:userId',
  wrapHandler(() => import('../api/dms/[userId].js')),
)
app.all(
  '/api/dms',
  wrapHandler(() => import('../api/dms/index.js')),
)
app.all(
  '/api/forums',
  wrapHandler(() => import('../api/forums.js')),
)
app.all(
  '/api/identity',
  wrapHandler(() => import('../api/identity.js')),
)
app.all(
  '/api/memberships',
  wrapHandler(() => import('../api/memberships.js')),
)
app.all(
  '/api/oauth/authorize',
  wrapHandler(() => import('../api/oauth/authorize.js')),
)
app.all(
  '/api/oauth/token',
  wrapHandler(() => import('../api/oauth/token.js')),
)
app.all(
  '/api/profiles/search',
  wrapHandler(() => import('../api/profiles/search.js')),
)
app.all(
  '/api/push',
  wrapHandler(() => import('../api/push.js')),
)

// ---------------------------------------------------------------------------
// Static files (Vite build output) + SPA fallback
// ---------------------------------------------------------------------------

app.use(
  '/assets/*',
  serveStatic({ root: './dist' }),
)

app.use(
  '/favicon.ico',
  serveStatic({ root: './dist', path: '/favicon.ico' }),
)

// SPA fallback — serve index.html for all non-API, non-asset routes
app.get('*', serveStatic({ root: './dist', path: '/index.html' }))

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------

const port = Number(process.env.PORT) || 3001

serve({ fetch: app.fetch, port }, (info) => {
  console.log(
    `central-services server listening on http://localhost:${info.port}`,
  )
})
