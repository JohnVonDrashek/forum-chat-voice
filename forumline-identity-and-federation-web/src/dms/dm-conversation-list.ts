/*
 * DM conversation list (Van.js)
 *
 * This file displays all of a user's direct message conversations, serving as the inbox for cross-forum messaging.
 *
 * It must:
 * - Fetch and display all 1:1 and group conversations, sorted by most recent activity
 * - Show each conversation's avatar, display name, last message preview, and timestamp
 * - Display unread count badges on conversations with new messages
 * - Distinguish group conversations (group icon) from 1:1 conversations (user avatar)
 * - Update in real-time via the shared dm-store (SSE + poll driven)
 * - Show a loading spinner during the initial fetch
 * - Show an empty state when the user has no conversations yet
 * - Show an error state if the initial load fails
 * - Navigate to the conversation thread when a conversation is tapped
 */
import type { ForumlineStore } from '../shared/forumline-store.js'
import type { ForumlineConversationMember } from '@johnvondrashek/forumline-protocol'
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

  function createConvoItem(convo: Conversation): HTMLElement {
    const displayName = getConvoDisplayName(convo)
    const btn = button({ class: 'conversation-item', onclick: () => onSelectConversation(convo.id) }) as HTMLElement

    // Avatar with unread indicator
    const avatarWrap = div({ class: 'relative' }) as HTMLElement
    if (convo.isGroup) {
      const groupAvatar = div({
        style: 'width:40px;height:40px;border-radius:50%;background:var(--color-surface-hover);display:flex;align-items:center;justify-content:center;font-size:16px;color:var(--color-text-muted)',
      }) as HTMLElement
      groupAvatar.appendChild(html(`<svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"/></svg>`))
      avatarWrap.appendChild(groupAvatar)
    } else {
      avatarWrap.appendChild(createAvatar({ avatarUrl: getConvoAvatarUrl(convo), seed: getConvoAvatarSeed(convo), size: 40 }))
    }
    if (convo.unreadCount > 0) {
      const badge = div({ class: 'badge badge--primary', style: 'position:absolute;right:-4px;top:-4px;min-width:20px;height:20px;font-size:12px' }, String(convo.unreadCount))
      avatarWrap.appendChild(badge as HTMLElement)
    }
    btn.appendChild(avatarWrap)

    // Text
    const textDiv = div({ class: 'min-w-0 flex-1' }) as HTMLElement
    const nameRow = div({ class: 'flex items-center justify-between' },
      span({ class: `font-medium ${convo.unreadCount > 0 ? 'text-white' : 'text-secondary'}` }, displayName),
      span({ class: 'text-xs text-faint' }, convo.lastMessageTime ? formatShortTimeAgo(new Date(convo.lastMessageTime)) : ''),
    )
    textDiv.appendChild(nameRow as HTMLElement)
    textDiv.appendChild(
      p({ class: `truncate text-sm ${convo.unreadCount > 0 ? 'font-medium text-secondary' : 'text-muted'}` },
        convo.lastMessage || 'No messages yet',
      ) as HTMLElement,
    )
    btn.appendChild(textDiv)

    return btn
  }

  // Reactive child that shows loading/error/empty states, or the list
  const el = div({ class: 'flex-1 overflow-y-auto' },
    () => {
      if (initialLoad.val) {
        return div({ class: 'flex items-center justify-center', style: 'padding-top:2rem' },
          createSpinner(),
        )
      }

      if (loadError.val) {
        const empty = div({ class: 'empty-state' }) as HTMLElement
        const icon = div({ class: 'empty-state__icon' }) as HTMLElement
        icon.appendChild(html(`<svg class="icon-lg" style="color:var(--color-red)" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"/></svg>`))
        empty.append(
          icon,
          p({ class: 'text-sm text-error' }, 'Failed to load conversations') as HTMLElement,
          p({ class: 'text-xs text-faint mt-sm' }, 'Check your connection and try again') as HTMLElement,
        )
        return empty
      }

      if (conversations.val.length === 0) {
        const empty = div({ class: 'empty-state' }) as HTMLElement
        const icon = div({ class: 'empty-state__icon' }) as HTMLElement
        icon.appendChild(html(`<svg class="icon-lg" style="color:var(--color-text-muted)" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/></svg>`))
        empty.append(
          icon,
          p({ class: 'text-sm text-muted' }, 'No conversations yet') as HTMLElement,
          p({ class: 'text-xs text-faint mt-sm' }, 'Start a new message to begin chatting') as HTMLElement,
        )
        return empty
      }

      const container = div()
      for (const convo of conversations.val) {
        container.appendChild(createConvoItem(convo))
      }
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
