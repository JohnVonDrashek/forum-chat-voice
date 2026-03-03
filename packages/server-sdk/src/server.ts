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
  markNotificationRead?: (notificationId: string) => Promise<void>

  /**
   * Function called when a new notification should be sent.
   */
  onNotify?: (userId: string, notification: NotificationInput) => Promise<void>
}

/** Generic HTTP request handler type */
export type RequestHandler = (req: {
  method: string
  url: string
  headers: Record<string, string | undefined>
  body?: unknown
}, res: {
  status: (code: number) => { json: (body: unknown) => void; end: () => void }
  writeHead: (code: number, headers: Record<string, string>) => void
  write: (data: string) => void
  end: () => void
  on: (event: string, handler: () => void) => void
}) => void | Promise<void>

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

  /** Creates a request handler for the SSE notification stream */
  notificationStreamHandler(): RequestHandler {
    return (req, res) => {
      // Extract user ID from auth header
      const authHeader = req.headers['authorization']
      if (!authHeader) {
        res.status(401).json({ error: 'Unauthorized' })
        return
      }

      // For now, use the token as-is (real implementation would validate)
      const userId = authHeader.replace('Bearer ', '')

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
}
