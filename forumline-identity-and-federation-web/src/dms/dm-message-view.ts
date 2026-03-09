/*
 * DM message thread view (Van.js + VanX)
 *
 * This file renders a single conversation's full message history and compose interface.
 *
 * It must:
 * - Display the conversation header with avatar, name, and a call button (1:1 only)
 * - Show an expandable member list panel for group conversations
 * - Render all messages as chat bubbles, with "mine" and "theirs" alignment
 * - Show sender labels on other people's messages in group chats
 * - Display timestamps on each message
 * - Auto-scroll to the newest message on initial load
 * - Preserve scroll position when new messages arrive (unless user is at the bottom)
 * - Send messages via a compose bar with text input and send button
 * - Support sending via Enter key
 * - Optimistically show sent messages immediately, removing them on failure
 * - Mark the conversation as read on open and on each new message fetch
 * - Update in real-time via SSE, filtered to the current conversation
 * - Initiate a voice call to the other user in 1:1 conversations
 *
 * Uses reactive for view state and list with replace for
 * efficient message list diffing — only new/changed messages touch the DOM.
 */
import type { ForumlineStore } from '../shared/forumline-store.js'
import type { ForumlineDirectMessage, ForumlineDmConversation, ForumlineConversationMember } from '@johnvondrashek/forumline-protocol'
import { reactive, list, replace, noreactive } from 'vanjs-ext'
import { tags, html, state } from '../shared/dom.js'
import { createAvatar, createButton, createInput, createSpinner } from '../shared/ui.js'
import { formatMessageTime } from '../shared/dateFormatters.js'
import { subscribeDmEvents } from './dm-sse.js'
import { fetchConversations as refreshDmConversations } from './dm-store.js'
import { initiateCall, callState } from '../calls/call-manager.js'

const { div, h3, p, span, button } = tags

interface DmMessageViewOptions {
  forumlineStore: ForumlineStore
  conversationId: string
}

export function createDmMessageView({ forumlineStore, conversationId }: DmMessageViewOptions) {
  // Reactive keyed object for messages: message id -> message data
  const messages = reactive<Record<string, ForumlineDirectMessage>>({})
  const conversationState = state<ForumlineDmConversation | null>(null)
  const isInitialLoad = state(true)
  let sending = false

  const el = div({ class: 'flex flex-col', style: 'height:100%' }) as HTMLElement

  function getDisplayName(): string {
    const convo = conversationState.val
    if (!convo) return 'Chat'
    if (convo.isGroup && convo.name) return convo.name
    const { forumlineUserId } = forumlineStore.get()
    const others = convo.members.filter((m: ForumlineConversationMember) => m.id !== forumlineUserId)
    return others.map((m: ForumlineConversationMember) => m.displayName || m.username).join(', ')
  }

  function getAvatarInfo(): { url: string | null; seed: string } {
    const convo = conversationState.val
    if (!convo) return { url: null, seed: 'chat' }
    if (convo.isGroup) return { url: null, seed: convo.name || convo.id }
    const { forumlineUserId } = forumlineStore.get()
    const other = convo.members.find((m: ForumlineConversationMember) => m.id !== forumlineUserId)
    return { url: other?.avatarUrl ?? null, seed: other?.username || convo.id }
  }

  function getMemberName(senderId: string): string {
    const convo = conversationState.val
    if (!convo) return 'User'
    const member = convo.members.find((m: ForumlineConversationMember) => m.id === senderId)
    return member?.displayName || member?.username || 'User'
  }

  // Header
  const headerEl = div({ class: 'message-header' }) as HTMLElement
  const headerAvatar = createAvatar({ avatarUrl: null, seed: 'chat', size: 32 })
  const headerTextWrap = div({ style: 'min-width:0;flex:1' }) as HTMLElement
  const headerName = h3({ class: 'font-medium text-white' }, 'Chat') as HTMLElement
  const headerMembers = button({
    class: 'text-xs text-muted truncate',
    style: 'margin-top:1px;background:none;border:none;padding:0;cursor:pointer;text-align:left;width:100%;color:inherit',
    onclick: () => {
      memberPanelOpen = !memberPanelOpen
      memberPanel.style.display = memberPanelOpen ? '' : 'none'
    },
  }) as HTMLButtonElement
  headerTextWrap.append(headerName, headerMembers)

  const callBtn = button({
    style: 'background:none;border:none;cursor:pointer;padding:0.25rem;color:var(--color-text-secondary);display:none',
    title: 'Start voice call',
    onclick: () => {
      const convo = conversationState.val
      if (!convo || convo.isGroup || callState.state !== 'idle') return
      const { forumlineUserId } = forumlineStore.get()
      const other = convo.members.find((m: ForumlineConversationMember) => m.id !== forumlineUserId)
      if (!other) return
      initiateCall(conversationId, other.id, other.displayName || other.username, (other as any).avatarUrl ?? null)
    },
  }, html(`<svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"/></svg>`)) as HTMLButtonElement

  headerEl.append(headerAvatar, headerTextWrap, callBtn)
  el.appendChild(headerEl)

  // Member panel
  const memberPanel = div({
    style: 'display:none;background:var(--color-surface);border-bottom:1px solid var(--color-border);padding:0.5rem 1rem;max-height:200px;overflow-y:auto',
  }) as HTMLElement
  el.appendChild(memberPanel)
  let memberPanelOpen = false

  function renderMemberPanel() {
    const conversation = conversationState.val
    if (!conversation?.isGroup) return
    memberPanel.innerHTML = ''
    const { forumlineUserId } = forumlineStore.get()
    const label = div({ class: 'text-xs text-faint', style: 'margin-bottom:0.375rem;font-weight:600' },
      `Members (${conversation.members.length})`,
    ) as HTMLElement
    memberPanel.appendChild(label)
    for (const m of conversation.members) {
      const row = div({ style: 'display:flex;align-items:center;gap:0.5rem;padding:0.25rem 0' }) as HTMLElement
      row.appendChild(createAvatar({ avatarUrl: (m as any).avatarUrl ?? null, seed: m.username, size: 24 }))
      row.appendChild(span({ class: 'text-sm text-secondary' },
        m.id === forumlineUserId ? `${m.displayName || m.username} (you)` : (m.displayName || m.username),
      ) as HTMLElement)
      memberPanel.appendChild(row)
    }
  }

  // Messages container
  const messagesContainer = div({ class: 'flex-1 overflow-y-auto p-lg' }) as HTMLElement
  el.appendChild(messagesContainer)

  const emptyState = div({ class: 'text-center text-faint', style: 'padding:3rem 0' }, 'No messages yet. Say hello!') as HTMLElement

  function createMessageRow(msg: ForumlineDirectMessage): HTMLElement {
    const conversation = conversationState.val
    const { forumlineUserId } = forumlineStore.get()
    const isMe = msg.sender_id === forumlineUserId
    const row = div({ class: isMe ? 'dm-row dm-row--mine' : 'dm-row dm-row--theirs' }) as HTMLElement
    const wrap = div({ style: 'max-width:75%' }) as HTMLElement

    if (conversation?.isGroup && !isMe) {
      wrap.appendChild(div({ class: 'text-xs text-muted', style: 'margin-bottom:2px' }, getMemberName(msg.sender_id)) as HTMLElement)
    }

    wrap.appendChild(div({ class: isMe ? 'dm-bubble dm-bubble--mine' : 'dm-bubble dm-bubble--theirs' }, msg.content) as HTMLElement)
    wrap.appendChild(div({ class: `dm-time ${isMe ? 'text-right' : 'text-left'}` }, formatMessageTime(new Date(msg.created_at))) as HTMLElement)

    row.appendChild(wrap)
    return row
  }

  function isAtBottom(): boolean {
    return messagesContainer.scrollTop + messagesContainer.clientHeight >= messagesContainer.scrollHeight - 50
  }

  function scrollToBottom() {
    messagesContainer.scrollTop = messagesContainer.scrollHeight
  }

  // Create the vanX.list element once — it lives in the DOM permanently
  // and updates incrementally when `replace(messages, ...)` is called.
  const listEl = list(
    div({ style: 'display:flex;flex-direction:column;gap:0.25rem' }),
    messages,
    (v, _deleter, _k) => {
      const msg = v.val as ForumlineDirectMessage
      return createMessageRow(msg)
    },
  )

  // Track previous message count to detect changes for scroll handling
  let prevMessageCount = 0

  function onMessagesUpdated() {
    const count = Object.keys(messages).length

    // Toggle empty state vs list visibility
    if (count === 0) {
      listEl.style.display = 'none'
      if (!emptyState.parentNode) messagesContainer.appendChild(emptyState)
      emptyState.style.display = ''
    } else {
      listEl.style.display = ''
      emptyState.style.display = 'none'
    }

    // Scroll handling: on initial load or when at bottom and new messages arrive
    const wasAtBottom = isAtBottom()
    const hasNewMessages = count > prevMessageCount
    prevMessageCount = count

    if (isInitialLoad.val && count > 0) {
      // Use requestAnimationFrame so the DOM has rendered the list items
      requestAnimationFrame(() => scrollToBottom())
      isInitialLoad.val = false
    } else if (wasAtBottom && hasNewMessages) {
      requestAnimationFrame(() => scrollToBottom())
    }
  }

  // Compose bar
  const messageInput = createInput({ type: 'text', placeholder: 'Type a message...' })
  let newMessage = ''
  messageInput.addEventListener('input', () => { newMessage = messageInput.value })
  messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
  })

  const sendBtn = createButton({
    html: `<svg class="icon-sm" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"/></svg>`,
    variant: 'primary',
    onClick: handleSend,
  })

  el.appendChild(div({ class: 'compose-bar' }, messageInput, sendBtn) as HTMLElement)

  function updateHeader() {
    const conversation = conversationState.val
    const { url, seed } = getAvatarInfo()
    const displayName = getDisplayName()

    if (conversation?.isGroup) {
      const groupAvatar = div({
        style: 'width:32px;height:32px;border-radius:50%;background:var(--color-surface-hover);display:flex;align-items:center;justify-content:center',
      }, html(`<svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"/></svg>`)) as HTMLElement
      if (headerEl.firstChild) headerEl.replaceChild(groupAvatar, headerEl.firstChild)
    } else {
      const newAvatar = createAvatar({ avatarUrl: url, seed, size: 32 })
      if (headerEl.firstChild) headerEl.replaceChild(newAvatar, headerEl.firstChild)
    }

    headerName.textContent = displayName
    messageInput.placeholder = `Message ${displayName}...`
    callBtn.style.display = (conversation && !conversation.isGroup) ? '' : 'none'

    if (conversation?.isGroup && conversation.members.length > 0) {
      const { forumlineUserId } = forumlineStore.get()
      const names = conversation.members.map((m: ForumlineConversationMember) =>
        m.id === forumlineUserId ? 'you' : (m.displayName || m.username),
      )
      const maxShow = 4
      const shown = names.slice(0, maxShow)
      const remaining = names.length - maxShow
      headerMembers.textContent = remaining > 0 ? `${shown.join(', ')} + ${remaining} more` : names.join(', ')
      headerMembers.style.display = ''
      renderMemberPanel()
    } else {
      headerMembers.style.display = 'none'
      memberPanel.style.display = 'none'
      memberPanelOpen = false
    }
  }

  async function fetchConversationInfo() {
    const { forumlineClient } = forumlineStore.get()
    if (!forumlineClient) return
    try {
      const convo = await forumlineClient.getConversation(conversationId)
      if (convo) {
        conversationState.val = convo
        updateHeader()
      }
    } catch (err) {
      console.error('[Forumline:DM] Failed to fetch conversation:', err)
    }
  }

  async function fetchMessages() {
    const { forumlineClient } = forumlineStore.get()
    if (!forumlineClient) return
    try {
      const data = await forumlineClient.getMessages(conversationId)
      // Convert array to keyed object for replace smart diffing
      const keyed: Record<string, ForumlineDirectMessage> = {}
      for (const msg of data) {
        keyed[msg.id] = noreactive(msg)
      }
      replace(messages, keyed)
      // Remove the loading spinner on first successful fetch
      if (spinnerWrap.parentNode) spinnerWrap.remove()
      onMessagesUpdated()
      if (data.length > 0) {
        forumlineClient.markRead(conversationId).then(() => {
          refreshDmConversations()
        }).catch(console.error)
      }
    } catch (err) {
      console.error('[Forumline:DM] Failed to fetch messages:', err)
    }
  }

  async function handleSend() {
    if (!newMessage.trim() || sending) return
    const { forumlineClient, forumlineUserId } = forumlineStore.get()
    if (!forumlineClient) return

    const content = newMessage.trim()
    sending = true

    const optimisticId = `temp-${Date.now()}`
    const optimistic: ForumlineDirectMessage = {
      id: optimisticId,
      conversation_id: conversationId,
      sender_id: forumlineUserId || '',
      content,
      created_at: new Date().toISOString(),
    }
    messages[optimisticId] = noreactive(optimistic)
    newMessage = ''
    messageInput.value = ''
    onMessagesUpdated()

    try {
      await forumlineClient.sendMessage(conversationId, content)
    } catch (err) {
      delete messages[optimisticId]
      onMessagesUpdated()
      console.error('[Forumline:DM] Failed to send message:', err)
    } finally {
      sending = false
    }
  }

  // Initial loading — show spinner, hide list and empty state until first fetch
  const spinnerWrap = div({ class: 'flex items-center justify-center flex-1' }) as HTMLElement
  spinnerWrap.appendChild(createSpinner())
  messagesContainer.appendChild(spinnerWrap)
  listEl.style.display = 'none'
  emptyState.style.display = 'none'
  messagesContainer.appendChild(listEl)
  messagesContainer.appendChild(emptyState)

  fetchConversationInfo()
  fetchMessages()

  // SSE
  let sseDebounce: ReturnType<typeof setTimeout> | null = null
  const unsubSSE = subscribeDmEvents((event) => {
    if (event.conversation_id && event.conversation_id !== conversationId) return
    if (sseDebounce) clearTimeout(sseDebounce)
    sseDebounce = setTimeout(fetchMessages, 200)
  })

  return {
    el,
    destroy() {
      if (sseDebounce) clearTimeout(sseDebounce)
      unsubSSE()
    },
  }
}
