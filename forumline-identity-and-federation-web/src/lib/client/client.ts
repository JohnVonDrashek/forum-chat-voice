import type { ForumlineDirectMessage, ForumlineDmConversation, ForumlineProfile } from '@johnvondrashek/forumline-protocol'

/**
 * Headless HTTP client for Forumline Central Services.
 * Provides access to cross-forum conversations (1:1 and group) and profile search.
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

  /** List all conversations (1:1 and group) */
  async getConversations(): Promise<ForumlineDmConversation[]> {
    return this.fetch('/api/conversations')
  }

  /** Get a single conversation's metadata */
  async getConversation(conversationId: string): Promise<ForumlineDmConversation> {
    return this.fetch(`/api/conversations/${conversationId}`)
  }

  /** Get messages in a conversation */
  async getMessages(conversationId: string): Promise<ForumlineDirectMessage[]> {
    return this.fetch(`/api/conversations/${conversationId}/messages`)
  }

  /** Send a message in a conversation */
  async sendMessage(conversationId: string, content: string): Promise<ForumlineDirectMessage> {
    return this.fetch(`/api/conversations/${conversationId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    })
  }

  /** Mark a conversation as read */
  async markRead(conversationId: string): Promise<void> {
    await this.fetch(`/api/conversations/${conversationId}/read`, { method: 'POST' })
  }

  /** Get or create a 1:1 conversation with a user */
  async getOrCreateDM(userId: string): Promise<{ id: string }> {
    return this.fetch('/api/conversations/dm', {
      method: 'POST',
      body: JSON.stringify({ userId }),
    })
  }

  /** Create a new group conversation */
  async createGroupConversation(memberIds: string[], name: string): Promise<ForumlineDmConversation> {
    return this.fetch('/api/conversations', {
      method: 'POST',
      body: JSON.stringify({ memberIds, name }),
    })
  }

  /** Search Forumline profiles by username */
  async searchProfiles(query: string): Promise<ForumlineProfile[]> {
    return this.fetch(`/api/profiles/search?q=${encodeURIComponent(query)}`)
  }
}
