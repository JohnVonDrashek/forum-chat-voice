import type { HubDirectMessage, HubDmConversation, HubProfile } from '@forumline/protocol'

/**
 * Headless HTTP client for Forumline Central Services.
 * Provides access to cross-forum DMs and profile search.
 * All requests use the hub Supabase access token for authentication.
 */
export class CentralServicesClient {
  constructor(
    private hubUrl: string,
    private accessToken: string,
  ) {}

  private async fetch<T>(path: string, options?: RequestInit): Promise<T> {
    const res = await fetch(`${this.hubUrl}${path}`, {
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
  async getConversations(): Promise<HubDmConversation[]> {
    return this.fetch('/api/dms')
  }

  /** Get messages with a specific user */
  async getMessages(userId: string): Promise<HubDirectMessage[]> {
    return this.fetch(`/api/dms/${userId}`)
  }

  /** Send a message to a specific user */
  async sendMessage(userId: string, content: string): Promise<HubDirectMessage> {
    return this.fetch(`/api/dms/${userId}`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    })
  }

  /** Mark all messages from a user as read */
  async markRead(userId: string): Promise<void> {
    await this.fetch(`/api/dms/${userId}/read`, { method: 'POST' })
  }

  /** Search hub profiles by username */
  async searchProfiles(query: string): Promise<HubProfile[]> {
    return this.fetch(`/api/profiles/search?q=${encodeURIComponent(query)}`)
  }
}
