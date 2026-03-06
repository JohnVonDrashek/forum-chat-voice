import type { HubStore } from '@johnvondrashek/forumline-core'
import { createAvatar, createSpinner } from './ui.js'
import { formatShortTimeAgo } from '../lib/dateFormatters.js'

interface DmConversationListOptions {
  hubStore: HubStore
  onSelectConversation: (recipientId: string) => void
}

export function createDmConversationList({ hubStore, onSelectConversation }: DmConversationListOptions) {
  const el = document.createElement('div')
  el.className = 'flex-1 overflow-y-auto'

  let pollInterval: ReturnType<typeof setInterval> | null = null
  let isError = false

  async function fetchAndRender() {
    const { hubClient } = hubStore.get()
    if (!hubClient) return

    try {
      const conversations = await hubClient.getConversations()
      isError = false
      renderConversations(conversations)
    } catch {
      isError = true
      renderError()
    }
  }

  function renderConversations(conversations: Awaited<ReturnType<NonNullable<ReturnType<typeof hubStore.get>['hubClient']>['getConversations']>>) {
    el.innerHTML = ''

    if (conversations.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'empty-state'
      const icon = document.createElement('div')
      icon.className = 'empty-state__icon'
      icon.innerHTML = `<svg class="icon-lg" style="color:var(--color-text-muted)" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/></svg>`
      empty.appendChild(icon)
      const p1 = document.createElement('p')
      p1.className = 'text-sm text-muted'
      p1.textContent = 'No conversations yet'
      const p2 = document.createElement('p')
      p2.className = 'text-xs text-faint mt-sm'
      p2.textContent = 'Start a new message to begin chatting'
      empty.append(p1, p2)
      el.appendChild(empty)
      return
    }

    for (const convo of conversations) {
      const btn = document.createElement('button')
      btn.className = 'conversation-item'

      // Avatar with unread indicator
      const avatarWrap = document.createElement('div')
      avatarWrap.className = 'relative'
      avatarWrap.appendChild(createAvatar({ avatarUrl: convo.recipientAvatarUrl, seed: convo.recipientName, size: 40 }))
      if (convo.unreadCount > 0) {
        const badge = document.createElement('div')
        badge.className = 'badge badge--primary'
        badge.style.cssText = 'position:absolute;right:-4px;top:-4px;min-width:20px;height:20px;font-size:12px'
        badge.textContent = String(convo.unreadCount)
        avatarWrap.appendChild(badge)
      }
      btn.appendChild(avatarWrap)

      // Text
      const textDiv = document.createElement('div')
      textDiv.className = 'min-w-0 flex-1'

      const nameRow = document.createElement('div')
      nameRow.className = 'flex items-center justify-between'
      const name = document.createElement('span')
      name.className = `font-medium ${convo.unreadCount > 0 ? 'text-white' : 'text-secondary'}`
      name.textContent = convo.recipientName
      const time = document.createElement('span')
      time.className = 'text-xs text-faint'
      time.textContent = formatShortTimeAgo(new Date(convo.lastMessageTime))
      nameRow.append(name, time)
      textDiv.appendChild(nameRow)

      const preview = document.createElement('p')
      preview.className = `truncate text-sm ${convo.unreadCount > 0 ? 'font-medium text-secondary' : 'text-muted'}`
      preview.textContent = convo.lastMessage
      textDiv.appendChild(preview)

      btn.appendChild(textDiv)
      btn.addEventListener('click', () => onSelectConversation(convo.recipientId))
      el.appendChild(btn)
    }
  }

  function renderError() {
    el.innerHTML = ''
    const empty = document.createElement('div')
    empty.className = 'empty-state'
    const icon = document.createElement('div')
    icon.className = 'empty-state__icon'
    icon.innerHTML = `<svg class="icon-lg" style="color:var(--color-red)" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"/></svg>`
    empty.appendChild(icon)
    const p1 = document.createElement('p')
    p1.className = 'text-sm text-error'
    p1.textContent = 'Failed to load conversations'
    const p2 = document.createElement('p')
    p2.className = 'text-xs text-faint mt-sm'
    p2.textContent = 'Check your connection and try again'
    empty.append(p1, p2)
    el.appendChild(empty)
  }

  // Show initial loading spinner
  const spinnerWrap = document.createElement('div')
  spinnerWrap.className = 'flex items-center justify-center'
  spinnerWrap.style.paddingTop = '2rem'
  spinnerWrap.appendChild(createSpinner())
  el.appendChild(spinnerWrap)

  // Initial fetch
  fetchAndRender()

  // Poll for updates
  pollInterval = setInterval(fetchAndRender, 30_000)

  return {
    el,
    destroy() {
      if (pollInterval) clearInterval(pollInterval)
    },
  }
}
