import type { ForumlineStore } from '@johnvondrashek/forumline-core'
import type { ForumlineDmConversation } from '@johnvondrashek/forumline-protocol'
import { createAvatar, createSpinner } from './ui.js'
import { formatShortTimeAgo } from '../lib/dateFormatters.js'

interface DmConversationListOptions {
  forumlineStore: ForumlineStore
  onSelectConversation: (recipientId: string) => void
}

type Conversation = ForumlineDmConversation

export function createDmConversationList({ forumlineStore, onSelectConversation }: DmConversationListOptions) {
  const el = document.createElement('div')
  el.className = 'flex-1 overflow-y-auto'

  let pollInterval: ReturnType<typeof setInterval> | null = null
  let hasLoaded = false

  // Track rendered conversation elements
  const renderedConvos = new Map<string, {
    btn: HTMLElement
    badgeEl: HTMLElement | null
    nameEl: HTMLElement
    timeEl: HTMLElement
    previewEl: HTMLElement
    avatarWrap: HTMLElement
    lastData: { unreadCount: number; lastMessage: string; lastMessageTime: string; recipientName: string }
  }>()

  // Persistent containers
  const listContainer = document.createElement('div')
  const emptyState = createEmptyState()
  const errorState = createErrorState()

  function createEmptyState(): HTMLElement {
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
    return empty
  }

  function createErrorState(): HTMLElement {
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
    return empty
  }

  function createConvoButton(convo: Conversation): typeof renderedConvos extends Map<string, infer V> ? V : never {
    const btn = document.createElement('button')
    btn.className = 'conversation-item'

    // Avatar with unread indicator
    const avatarWrap = document.createElement('div')
    avatarWrap.className = 'relative'
    avatarWrap.appendChild(createAvatar({ avatarUrl: convo.recipientAvatarUrl, seed: convo.recipientName, size: 40 }))
    let badgeEl: HTMLElement | null = null
    if (convo.unreadCount > 0) {
      badgeEl = document.createElement('div')
      badgeEl.className = 'badge badge--primary'
      badgeEl.style.cssText = 'position:absolute;right:-4px;top:-4px;min-width:20px;height:20px;font-size:12px'
      badgeEl.textContent = String(convo.unreadCount)
      avatarWrap.appendChild(badgeEl)
    }
    btn.appendChild(avatarWrap)

    // Text
    const textDiv = document.createElement('div')
    textDiv.className = 'min-w-0 flex-1'

    const nameRow = document.createElement('div')
    nameRow.className = 'flex items-center justify-between'
    const nameEl = document.createElement('span')
    nameEl.className = `font-medium ${convo.unreadCount > 0 ? 'text-white' : 'text-secondary'}`
    nameEl.textContent = convo.recipientName
    const timeEl = document.createElement('span')
    timeEl.className = 'text-xs text-faint'
    timeEl.textContent = formatShortTimeAgo(new Date(convo.lastMessageTime))
    nameRow.append(nameEl, timeEl)
    textDiv.appendChild(nameRow)

    const previewEl = document.createElement('p')
    previewEl.className = `truncate text-sm ${convo.unreadCount > 0 ? 'font-medium text-secondary' : 'text-muted'}`
    previewEl.textContent = convo.lastMessage
    textDiv.appendChild(previewEl)

    btn.appendChild(textDiv)
    btn.addEventListener('click', () => onSelectConversation(convo.recipientId))

    return {
      btn,
      badgeEl,
      nameEl,
      timeEl,
      previewEl,
      avatarWrap,
      lastData: {
        unreadCount: convo.unreadCount,
        lastMessage: convo.lastMessage,
        lastMessageTime: convo.lastMessageTime,
        recipientName: convo.recipientName,
      },
    }
  }

  function updateConvoButton(entry: typeof renderedConvos extends Map<string, infer V> ? V : never, convo: Conversation) {
    const prev = entry.lastData

    // Update badge
    if (prev.unreadCount !== convo.unreadCount) {
      if (convo.unreadCount > 0) {
        if (entry.badgeEl) {
          entry.badgeEl.textContent = String(convo.unreadCount)
        } else {
          entry.badgeEl = document.createElement('div')
          entry.badgeEl.className = 'badge badge--primary'
          entry.badgeEl.style.cssText = 'position:absolute;right:-4px;top:-4px;min-width:20px;height:20px;font-size:12px'
          entry.badgeEl.textContent = String(convo.unreadCount)
          entry.avatarWrap.appendChild(entry.badgeEl)
        }
      } else if (entry.badgeEl) {
        entry.badgeEl.remove()
        entry.badgeEl = null
      }

      // Update name styling based on unread
      entry.nameEl.className = `font-medium ${convo.unreadCount > 0 ? 'text-white' : 'text-secondary'}`
      entry.previewEl.className = `truncate text-sm ${convo.unreadCount > 0 ? 'font-medium text-secondary' : 'text-muted'}`
    }

    // Update text content
    if (prev.lastMessage !== convo.lastMessage) {
      entry.previewEl.textContent = convo.lastMessage
    }
    if (prev.lastMessageTime !== convo.lastMessageTime) {
      entry.timeEl.textContent = formatShortTimeAgo(new Date(convo.lastMessageTime))
    }
    if (prev.recipientName !== convo.recipientName) {
      entry.nameEl.textContent = convo.recipientName
    }

    entry.lastData = {
      unreadCount: convo.unreadCount,
      lastMessage: convo.lastMessage,
      lastMessageTime: convo.lastMessageTime,
      recipientName: convo.recipientName,
    }
  }

  function renderConversations(conversations: Conversation[]) {
    // Clear non-list content (spinner, error, empty)
    emptyState.remove()
    errorState.remove()

    if (conversations.length === 0) {
      listContainer.remove()
      renderedConvos.clear()
      el.innerHTML = ''
      el.appendChild(emptyState)
      return
    }

    if (!listContainer.parentNode) {
      el.innerHTML = ''
      el.appendChild(listContainer)
    }

    // Build set of current recipient IDs
    const currentIds = new Set(conversations.map(c => c.recipientId))

    // Remove stale conversations
    for (const [id, entry] of renderedConvos) {
      if (!currentIds.has(id)) {
        entry.btn.remove()
        renderedConvos.delete(id)
      }
    }

    // Update existing or add new conversations (in order)
    for (const convo of conversations) {
      const existing = renderedConvos.get(convo.recipientId)
      if (existing) {
        updateConvoButton(existing, convo)
        // Ensure correct order
        listContainer.appendChild(existing.btn)
      } else {
        const entry = createConvoButton(convo)
        renderedConvos.set(convo.recipientId, entry)
        listContainer.appendChild(entry.btn)
      }
    }
  }

  async function fetchAndRender() {
    const { forumlineClient } = forumlineStore.get()
    if (!forumlineClient) return

    try {
      const conversations = await forumlineClient.getConversations()
      hasLoaded = true
      renderConversations(conversations)
    } catch {
      if (!hasLoaded) {
        // Only show error on initial load failure
        el.innerHTML = ''
        el.appendChild(errorState)
      }
    }
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
