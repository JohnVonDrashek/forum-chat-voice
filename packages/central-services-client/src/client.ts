import type { ForumlineDirectMessage, ForumlineDmConversation, ForumlineProfile } from '@johnvondrashek/forumline-protocol'

/**
 * Headless HTTP client for Forumline Central Services.
 * Provides access to cross-forum DMs and profile search.
 * All requests use the Forumline access token for authentication.
 */
export class CentralServicesClient {
  constructor(
    private forumlineUrl: string,
    private accessToken: string,
  ) {}

  private async fetch<T>(path: string, options?: RequestInit): Promise<T> {
    const res = await fetch(`${this.forumlineUrl}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.accessToken}`,
        ...options?.headers,
      },
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.error || `Central Services API error: ${res.status}`)
    }
    return res.json()
  }

  /** List all DM conversations */
  async getConversations(): Promise<ForumlineDmConversation[]> {
    return this.fetch('/api/dms')
  }

  /** Get messages with a specific user */
  async getMessages(userId: string): Promise<ForumlineDirectMessage[]> {
    return this.fetch(`/api/dms/${userId}`)
  }

  /** Send a message to a specific user */
  async sendMessage(userId: string, content: string): Promise<ForumlineDirectMessage> {
    return this.fetch(`/api/dms/${userId}`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    })
  }

  /** Mark all messages from a user as read */
  async markRead(userId: string): Promise<void> {
    await this.fetch(`/api/dms/${userId}/read`, { method: 'POST' })
  }

  /** Search Forumline profiles by username */
  async searchProfiles(query: string): Promise<ForumlineProfile[]> {
    return this.fetch(`/api/profiles/search?q=${encodeURIComponent(query)}`)
  }
}
