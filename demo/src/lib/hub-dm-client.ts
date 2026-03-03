import type { HubDirectMessage, HubDmConversation, HubProfile } from '@forumline/protocol'

const HUB_URL = import.meta.env.VITE_HUB_URL || 'https://forumline-hub.vercel.app'

/**
 * HTTP client for hub DM API endpoints.
 * All requests use the hub Supabase access token for authentication.
 */
export class HubDmClient {
  constructor(private accessToken: string) {}

  private async fetch<T>(path: string, options?: RequestInit): Promise<T> {
    const res = await fetch(`${HUB_URL}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.accessToken}`,
        ...options?.headers,
      },
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.error || `Hub API error: ${res.status}`)
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
