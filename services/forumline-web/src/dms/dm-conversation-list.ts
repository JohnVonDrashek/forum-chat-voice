/*
 * DM conversation list — iChat buddy list theme (Van.js)
 *
 * Displays conversations as an iChat-style buddy list with glossy presence orbs,
 * alternating row tints, Aqua unread badges, and blue gradient selection.
 *
 * It must:
 * - Fetch and display all 1:1 and group conversations, sorted by most recent activity
 * - Show each conversation's avatar, display name, last message preview, and timestamp
 * - Display unread count badges (glossy red Aqua capsules) on conversations with new messages
 * - Distinguish group conversations from 1:1 conversations
 * - Update in real-time via the shared dm-store (SSE + poll driven)
 * - Show loading, empty, and error states
 * - Navigate to the conversation thread when a conversation is tapped
 */
import type { ForumlineStore } from '../shared/forumline-store.js'
import type { ForumlineConversationMember } from '@forumline/protocol'
import { tags, html } from '../shared/dom.js'
import { createAvatar, createSpinner } from '../shared/ui.js'
import { formatShortTimeAgo } from '../shared/dateFormatters.js'
import { conversations, initialLoad, loadError, startUpdates, type Conversation } from './dm-store.js'

const { div, span, p, button } = tags

interface DmConversationListOptions {
  forumlineStore: ForumlineStore
  onSelectConversation: (conversationId: string) => void
}

export function createDmConversationList({ forumlineStore, onSelectConversation }: DmConversationListOptions) {
  const stopUpdates = startUpdates(forumlineStore)

  function getConvoDisplayName(convo: Conversation): string {
    if (convo.isGroup && convo.name) return convo.name
    const { forumlineUserId } = forumlineStore.get()
    const others = convo.members.filter((m: ForumlineConversationMember) => m.id !== forumlineUserId)
    if (others.length === 0) return 'Empty conversation'
    return others.map((m: ForumlineConversationMember) => m.displayName || m.username).join(', ')
  }

  function getConvoAvatarSeed(convo: Conversation): string {
    if (convo.isGroup) return convo.name || convo.id
    const { forumlineUserId } = forumlineStore.get()
    const other = convo.members.find((m: ForumlineConversationMember) => m.id !== forumlineUserId)
    return other?.username || convo.id
  }

  function getConvoAvatarUrl(convo: Conversation): string | null {
    if (convo.isGroup) return null
    const { forumlineUserId } = forumlineStore.get()
    const other = convo.members.find((m: ForumlineConversationMember) => m.id !== forumlineUserId)
    return other?.avatarUrl ?? null
  }

  function createConvoItem(convo: Conversation, index: number): HTMLElement {
    const displayName = getConvoDisplayName(convo)
    const isEven = index % 2 === 0
    const btn = button({
      class: `ichat-buddy${isEven ? ' ichat-buddy--alt' : ''}`,
      onclick: () => onSelectConversation(convo.id),
    }) as HTMLElement

    // Presence orb (always show for visual consistency)
    const orb = span({ class: 'ichat-presence-orb ichat-presence--available' }) as HTMLElement
    btn.appendChild(orb)

    // Avatar
    const avatarWrap = div({ class: 'ichat-buddy-avatar-wrap' }) as HTMLElement
    if (convo.isGroup) {
      const groupAvatar = div({ class: 'ichat-buddy-avatar ichat-buddy-avatar--group' }) as HTMLElement
      groupAvatar.appendChild(html(`<svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"/></svg>`))
      avatarWrap.appendChild(groupAvatar)
    } else {
      avatarWrap.appendChild(createAvatar({ avatarUrl: getConvoAvatarUrl(convo), seed: getConvoAvatarSeed(convo), size: 36 }))
    }
    btn.appendChild(avatarWrap)

    // Info
    const info = div({ class: 'ichat-buddy-info' }) as HTMLElement
    const nameRow = div({ class: 'ichat-buddy-name-row' }) as HTMLElement
    nameRow.appendChild(span({ class: `ichat-buddy-name${convo.unreadCount > 0 ? ' ichat-buddy-name--unread' : ''}` }, displayName) as HTMLElement)
    if (convo.isGroup) {
      nameRow.appendChild(span({ class: 'ichat-group-tag' }, `${convo.members.length}`) as HTMLElement)
    }
    info.appendChild(nameRow)
    info.appendChild(p({ class: 'ichat-buddy-status' }, convo.lastMessage || 'No messages yet') as HTMLElement)
    btn.appendChild(info)

    // Right side: time + badge
    const meta = div({ class: 'ichat-buddy-meta' }) as HTMLElement
    if (convo.lastMessageTime) {
      meta.appendChild(span({ class: 'ichat-buddy-time' }, formatShortTimeAgo(new Date(convo.lastMessageTime))) as HTMLElement)
    }
    if (convo.unreadCount > 0) {
      meta.appendChild(span({ class: 'ichat-unread-badge' }, String(convo.unreadCount)) as HTMLElement)
    }
    btn.appendChild(meta)

    return btn
  }

  const el = div({ class: 'ichat-sidebar' },
    () => {
      if (initialLoad.val) {
        return div({ class: 'ichat-loading' }, createSpinner())
      }

      if (loadError.val) {
        const empty = div({ class: 'ichat-empty-state' }) as HTMLElement
        empty.appendChild(html(`<svg width="32" height="32" style="color:#cc4444" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"/></svg>`))
        empty.append(
          p({ class: 'ichat-empty-text' }, 'Failed to load conversations') as HTMLElement,
          p({ class: 'ichat-empty-subtext' }, 'Check your connection and try again') as HTMLElement,
        )
        return empty
      }

      if (conversations.val.length === 0) {
        const empty = div({ class: 'ichat-empty-state' }) as HTMLElement
        empty.appendChild(html(`<svg width="32" height="32" style="color:#8899aa" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/></svg>`))
        empty.append(
          p({ class: 'ichat-empty-text' }, 'No conversations yet') as HTMLElement,
          p({ class: 'ichat-empty-subtext' }, 'Start a new message to begin chatting') as HTMLElement,
        )
        return empty
      }

      const container = div({ class: 'ichat-buddy-list' })
      conversations.val.forEach((convo, i) => {
        container.appendChild(createConvoItem(convo, i))
      })
      return container
    },
  ) as HTMLElement

  return {
    el,
    destroy() {
      stopUpdates()
    },
  }
}
