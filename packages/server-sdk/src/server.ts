/**
 * ForumlineServer — Main server class for Forumline forum integration.
 */

import type {
  ForumManifest,
  ForumCapability,
  ForumlineIdentity,
  ForumNotification,
  NotificationInput,
} from '@forumline/protocol'

import { parseCookies, decodeJwtPayload } from './utils/cookies.js'

export interface ForumlineServerConfig {
  /** Forum name */
  name: string

  /** The forum's canonical domain */
  domain: string

  /** URL to the forum's icon */
  icon_url: string

  /** Base URL for Forumline API endpoints */
  api_base: string

  /** Base URL for the forum's web UI */
  web_base: string

  /** Capabilities this forum supports */
  capabilities: ForumCapability[]

  /** Optional description */
  description?: string

  /** Optional banner image URL */
  banner_url?: string

  /** Optional accent color (hex) */
  accent_color?: string

  /**
   * Forumline Central Services (hub) configuration for OAuth.
   * Required for auth handlers.
   */
  hub?: {
    url: string
    clientId: string
    clientSecret: string
  }

  /** Site URL for redirects (e.g. https://my-forum.example.com) */
  siteUrl?: string

  /**
   * Create or link a local user from a Forumline identity.
   * Returns the local user ID.
   * Required for authCallbackHandler.
   */
  createOrLinkUser?: (identity: ForumlineIdentity) => Promise<string>

  /**
   * Authenticate a request using a Bearer token.
   * Returns the user ID if valid, null if invalid.
   * Required for notification/unread handlers.
   */
  authenticateRequest?: (token: string) => Promise<string | null>

  /**
   * Function to validate a Forumline identity token.
   * Returns the identity if valid, null if invalid.
   */
  validateToken?: (token: string) => Promise<ForumlineIdentity | null>

  /**
   * Function to get notifications for a user.
   */
  getNotifications?: (userId: string) => Promise<ForumNotification[]>

  /**
   * Function to get unread counts for a user.
   */
  getUnreadCounts?: (userId: string) => Promise<{ notifications: number; chat_mentions: number; dms: number }>

  /**
   * Function to mark a notification as read.
   */
  markNotificationRead?: (notificationId: string, userId: string) => Promise<void>

  /**
   * Function called when a new notification should be sent.
   */
  onNotify?: (userId: string, notification: NotificationInput) => Promise<void>
}

/** Generic HTTP request type */
export interface GenericRequest {
  method: string
  url: string
  headers: Record<string, string | undefined>
  query: Record<string, string | string[] | undefined>
  cookies: Record<string, string>
  body?: unknown
}

/** Generic HTTP response type */
export interface GenericResponse {
  status: (code: number) => { json: (body: unknown) => void; end: () => void }
  redirect: (statusCode: number, url: string) => void
  setHeader: (name: string, value: string | string[]) => void
  writeHead: (code: number, headers: Record<string, string>) => void
  write: (data: string) => void
  end: () => void
  on: (event: string, handler: () => void) => void
}

/** Generic HTTP handler */
export type RequestHandler = (req: GenericRequest, res: GenericResponse) => void | Promise<void>

export class ForumlineServer {
  private config: ForumlineServerConfig
  private sseClients: Map<string, Set<{
    write: (data: string) => void
    end: () => void
  }>> = new Map()

  constructor(config: ForumlineServerConfig) {
    this.config = config
  }

  /** Get the forum manifest */
  getManifest(): ForumManifest {
    return {
      forumline_version: '1',
      name: this.config.name,
      domain: this.config.domain,
      icon_url: this.config.icon_url,
      api_base: this.config.api_base,
      web_base: this.config.web_base,
      capabilities: this.config.capabilities,
      description: this.config.description,
      banner_url: this.config.banner_url,
      accent_color: this.config.accent_color,
    }
  }

  /** Validate an authorization token and return the identity */
  async validateToken(token: string): Promise<ForumlineIdentity | null> {
    if (!this.config.validateToken) return null
    return this.config.validateToken(token)
  }

  /** Send a notification to a user, also pushing to SSE clients */
  async notify(userId: string, notification: NotificationInput): Promise<void> {
    if (this.config.onNotify) {
      await this.config.onNotify(userId, notification)
    }

    // Push to any connected SSE clients for this user
    const clients = this.sseClients.get(userId)
    if (clients) {
      const event: ForumNotification = {
        id: crypto.randomUUID(),
        type: notification.type,
        title: notification.title,
        body: notification.body,
        link: notification.link,
        timestamp: new Date().toISOString(),
        read: false,
        forum_domain: this.config.domain,
      }
      const data = `data: ${JSON.stringify(event)}\n\n`
      for (const client of clients) {
        client.write(data)
      }
    }
  }

  /**
   * GET /auth — Redirects to Forumline Central Services OAuth.
   */
  authRedirectHandler(): RequestHandler {
    return async (req, res) => {
      if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' })
      }

      const { hub, siteUrl } = this.config
      if (!hub) {
        return res.status(500).json({ error: 'Forumline Central Services not configured' })
      }

      const { randomBytes } = await import('crypto')
      const state = randomBytes(16).toString('hex')
      const redirectUri = `${siteUrl}/api/forumline/auth/callback`

      const authorizeUrl = new URL(`${hub.url}/api/oauth/authorize`)
      authorizeUrl.searchParams.set('client_id', hub.clientId)
      authorizeUrl.searchParams.set('redirect_uri', redirectUri)
      authorizeUrl.searchParams.set('state', state)

      // Pass access_token if provided (for users already authenticated on the hub)
      if (req.query.hub_token) {
        authorizeUrl.searchParams.set('access_token', req.query.hub_token as string)
      }

      res.setHeader('Set-Cookie', `forumline_state=${state}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=600`)
      return res.redirect(302, authorizeUrl.toString())
    }
  }

  /**
   * GET /auth/callback — Handles OAuth callback from Central Services.
   */
  authCallbackHandler(): RequestHandler {
    return async (req, res) => {
      if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' })
      }

      const { code, state } = req.query as Record<string, string>
      if (!code || !state) {
        return res.status(400).json({ error: 'Missing code or state parameter' })
      }

      if (req.cookies.forumline_state !== state) {
        return res.status(400).json({ error: 'State mismatch — possible CSRF attack' })
      }

      const { hub, siteUrl, createOrLinkUser } = this.config
      if (!hub || !createOrLinkUser) {
        return res.status(500).json({ error: 'Forumline Central Services not configured' })
      }

      // Exchange code for identity token
      const redirectUri = `${siteUrl}/api/forumline/auth/callback`
      const tokenResponse = await fetch(`${hub.url}/api/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code,
          client_id: hub.clientId,
          client_secret: hub.clientSecret,
          redirect_uri: redirectUri,
        }),
      })

      if (!tokenResponse.ok) {
        const err = await tokenResponse.json().catch(() => ({}))
        return res.status(400).json({ error: 'Failed to exchange code', details: err })
      }

      const tokenData = await tokenResponse.json()
      const { identity, identity_token, hub_access_token } = tokenData

      if (!identity?.forumline_id || !identity?.username) {
        return res.status(500).json({ error: 'Invalid identity response from hub' })
      }

      // Create or link local user
      const localUserId = await createOrLinkUser(identity)

      // Set cookies
      const setCookies = [
        'forumline_state=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0',
        `forumline_identity=${identity_token}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=3600`,
        `forumline_user_id=${localUserId}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=3600`,
      ]
      if (hub_access_token) {
        setCookies.push(`hub_access_token=${hub_access_token}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=3600`)
      }
      res.setHeader('Set-Cookie', setCookies)

      return res.redirect(302, `${siteUrl}/?forumline_auth=success`)
    }
  }

  /**
   * GET /auth/hub-token — Returns the hub access token from httpOnly cookie.
   */
  hubTokenHandler(): RequestHandler {
    return async (req, res) => {
      if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Origin', '*')
        res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
        res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
        return res.status(204).end()
      }

      if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' })
      }

      res.setHeader('Access-Control-Allow-Origin', '*')
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')

      const hubAccessToken = req.cookies.hub_access_token
      return res.status(200).json({ hub_access_token: hubAccessToken || null })
    }
  }

  /**
   * GET /auth/session — Validates the current forumline session.
   */
  sessionHandler(): RequestHandler {
    return async (req, res) => {
      if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Origin', '*')
        res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
        res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
        return res.status(204).end()
      }

      if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' })
      }

      res.setHeader('Access-Control-Allow-Origin', '*')
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')

      const identityToken = req.cookies.forumline_identity
      const localUserId = req.cookies.forumline_user_id

      if (!identityToken || !localUserId) {
        return res.status(200).json(null)
      }

      const payload = decodeJwtPayload(identityToken)
      if (!payload?.identity) {
        return res.status(200).json(null)
      }

      // Check expiry
      if (typeof payload.exp === 'number' && payload.exp * 1000 < Date.now()) {
        res.setHeader('Set-Cookie', [
          'forumline_identity=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0',
          'forumline_user_id=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0',
        ])
        return res.status(200).json(null)
      }

      return res.status(200).json({
        identity: payload.identity,
        local_user_id: localUserId,
      })
    }
  }

  /**
   * GET /notifications — Returns the user's notifications.
   */
  notificationsHandler(): RequestHandler {
    return async (req, res) => {
      if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' })
      }

      const userId = await this.authenticateFromHeader(req)
      if (!userId) {
        return res.status(401).json({ error: 'Unauthorized' })
      }

      if (!this.config.getNotifications) {
        return res.status(501).json({ error: 'Notifications not implemented' })
      }

      const notifications = await this.config.getNotifications(userId)
      return res.status(200).json(notifications)
    }
  }

  /**
   * POST /notifications/read — Marks a notification as read.
   */
  notificationReadHandler(): RequestHandler {
    return async (req, res) => {
      if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' })
      }

      const userId = await this.authenticateFromHeader(req)
      if (!userId) {
        return res.status(401).json({ error: 'Unauthorized' })
      }

      if (!this.config.markNotificationRead) {
        return res.status(501).json({ error: 'Not implemented' })
      }

      const body = req.body as { id?: string } | undefined
      if (!body?.id) {
        return res.status(400).json({ error: 'Notification ID required' })
      }

      await this.config.markNotificationRead(body.id, userId)
      return res.status(200).json({ success: true })
    }
  }

  /**
   * GET /unread — Returns the user's unread counts.
   */
  unreadHandler(): RequestHandler {
    return async (req, res) => {
      if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' })
      }

      const userId = await this.authenticateFromHeader(req)
      if (!userId) {
        return res.status(401).json({ error: 'Unauthorized' })
      }

      if (!this.config.getUnreadCounts) {
        return res.status(501).json({ error: 'Unread counts not implemented' })
      }

      const counts = await this.config.getUnreadCounts(userId)
      return res.status(200).json(counts)
    }
  }

  /** Creates a request handler for the SSE notification stream */
  notificationStreamHandler(): RequestHandler {
    return async (req, res) => {
      if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' })
      }

      const userId = await this.authenticateFromHeader(req)
      if (!userId) {
        return res.status(401).json({ error: 'Unauthorized' })
      }

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      })

      // Register this client
      if (!this.sseClients.has(userId)) {
        this.sseClients.set(userId, new Set())
      }
      const client = { write: (data: string) => res.write(data), end: () => res.end() }
      this.sseClients.get(userId)!.add(client)

      // Send initial heartbeat
      res.write(':connected\n\n')

      // Send heartbeat every 30 seconds
      const heartbeat = setInterval(() => {
        res.write(':heartbeat\n\n')
      }, 30000)

      // Cleanup on disconnect
      res.on('close', () => {
        clearInterval(heartbeat)
        this.sseClients.get(userId)?.delete(client)
        if (this.sseClients.get(userId)?.size === 0) {
          this.sseClients.delete(userId)
        }
      })
    }
  }

  /** Authenticate a request from the Authorization header */
  private async authenticateFromHeader(req: GenericRequest): Promise<string | null> {
    const authHeader = req.headers['authorization'] || req.headers['Authorization']
    if (!authHeader?.startsWith('Bearer ')) return null

    if (!this.config.authenticateRequest) return null

    const token = authHeader.slice(7)
    return this.config.authenticateRequest(token)
  }
}
