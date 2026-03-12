/*
 * DM message thread view — iChat theme (Van.js + VanX)
 *
 * Renders a single conversation as an iChat-style chat with green/gray
 * glossy speech bubbles, a brushed metal header, and Aqua send button.
 *
 * It must:
 * - Display the conversation header with avatar, name, and a call button (1:1 only)
 * - Show an expandable member list panel for group conversations
 * - Render all messages as iChat bubbles, with "mine" (green) and "theirs" (gray) alignment
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
 */
import type { ForumlineStore } from '../shared/forumline-store.js'
import type { ForumlineDirectMessage, ForumlineDmConversation, ForumlineConversationMember } from '@forumline/protocol'
import { reactive, list, replace, noreactive } from 'vanjs-ext'
import { tags, html, state } from '../shared/dom.js'
import { createAvatar, createSpinner } from '../shared/ui.js'
import { formatMessageTime } from '../shared/dateFormatters.js'
import { subscribeDmEvents } from './dm-sse.js'
import { fetchConversations as refreshDmConversations } from './dm-store.js'
import { initiateCall, callState } from '../calls/call-manager.js'

const { div, h3, span, button, input } = tags

interface DmMessageViewOptions {
  forumlineStore: ForumlineStore
  conversationId: string
}

export function createDmMessageView({ forumlineStore, conversationId }: DmMessageViewOptions) {
  const messages = reactive<Record<string, ForumlineDirectMessage>>({})
  const conversationState = state<ForumlineDmConversation | null>(null)
  const isInitialLoad = state(true)
  let sending = false

  const el = div({ class: 'ichat-chat-area' }) as HTMLElement

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

  // Header — brushed metal style
  const headerEl = div({ class: 'ichat-chat-header' }) as HTMLElement
  const headerAvatar = createAvatar({ avatarUrl: null, seed: 'chat', size: 32 })
  const headerTextWrap = div({ class: 'ichat-chat-header-info' }) as HTMLElement
  const headerName = h3({ class: 'ichat-chat-header-name' }, 'Chat') as HTMLElement
  const headerMembers = button({
    class: 'ichat-chat-header-members',
    onclick: () => {
      memberPanelOpen = !memberPanelOpen
      memberPanel.style.display = memberPanelOpen ? '' : 'none'
    },
  }) as HTMLButtonElement
  headerTextWrap.append(headerName, headerMembers)

  const callBtn = button({
    class: 'ichat-call-btn',
    style: 'display:none',
    title: 'Start voice call',
    onclick: () => {
      const convo = conversationState.val
      if (!convo || convo.isGroup || callState.state !== 'idle') return
      const { forumlineUserId } = forumlineStore.get()
      const other = convo.members.find((m: ForumlineConversationMember) => m.id !== forumlineUserId)
      if (!other) return
      void initiateCall(conversationId, other.id, other.displayName || other.username, other.avatarUrl ?? null)
    },
  }, html(`<svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"/></svg>`),
    span({}, ' Call'),
  ) as HTMLButtonElement

  headerEl.append(headerAvatar, headerTextWrap, callBtn)
  el.appendChild(headerEl)

  // Member panel
  const memberPanel = div({ class: 'ichat-member-panel', style: 'display:none' }) as HTMLElement
  el.appendChild(memberPanel)
  let memberPanelOpen = false

  function renderMemberPanel() {
    const conversation = conversationState.val
    if (!conversation?.isGroup) return
    memberPanel.innerHTML = ''
    const { forumlineUserId } = forumlineStore.get()
    const label = div({ class: 'ichat-member-panel-label' }, `Members (${conversation.members.length})`) as HTMLElement
    memberPanel.appendChild(label)
    for (const m of conversation.members) {
      const row = div({ class: 'ichat-member-row' }) as HTMLElement
      row.appendChild(createAvatar({ avatarUrl: m.avatarUrl ?? null, seed: m.username, size: 24 }))
      row.appendChild(span({ class: 'ichat-member-name' },
        m.id === forumlineUserId ? `${m.displayName || m.username} (you)` : (m.displayName || m.username),
      ) as HTMLElement)
      memberPanel.appendChild(row)
    }
  }

  // Messages container
  const messagesContainer = div({ class: 'ichat-messages' }) as HTMLElement
  el.appendChild(messagesContainer)

  const emptyState = div({ class: 'ichat-messages-empty' }, 'No messages yet. Say hello!') as HTMLElement

  function createMessageRow(msg: ForumlineDirectMessage): HTMLElement {
    const conversation = conversationState.val
    const { forumlineUserId } = forumlineStore.get()
    const isMe = msg.sender_id === forumlineUserId
    const row = div({ class: isMe ? 'ichat-msg-row ichat-msg-row--me' : 'ichat-msg-row ichat-msg-row--them' }) as HTMLElement
    const wrap = div({ class: 'ichat-msg-wrap' }) as HTMLElement

    if (conversation?.isGroup && !isMe) {
      wrap.appendChild(div({ class: 'ichat-msg-sender' }, getMemberName(msg.sender_id)) as HTMLElement)
    }

    wrap.appendChild(div({ class: isMe ? 'ichat-bubble ichat-bubble--me' : 'ichat-bubble ichat-bubble--them' }, msg.content) as HTMLElement)
    wrap.appendChild(div({ class: `ichat-msg-time ${isMe ? 'ichat-msg-time--right' : ''}` }, formatMessageTime(new Date(msg.created_at))) as HTMLElement)

    row.appendChild(wrap)
    return row
  }

  function isAtBottom(): boolean {
    return messagesContainer.scrollTop + messagesContainer.clientHeight >= messagesContainer.scrollHeight - 50
  }

  function scrollToBottom() {
    messagesContainer.scrollTop = messagesContainer.scrollHeight
  }

  const listEl = list(
    div({ class: 'ichat-msg-list' }),
    messages,
    (v, _deleter, _k) => {
      const msg = v.val as ForumlineDirectMessage
      return createMessageRow(msg)
    },
  )

  let prevMessageCount = 0

  function onMessagesUpdated() {
    const count = Object.keys(messages).length

    if (count === 0) {
      listEl.style.display = 'none'
      if (!emptyState.parentNode) messagesContainer.appendChild(emptyState)
      emptyState.style.display = ''
    } else {
      listEl.style.display = ''
      emptyState.style.display = 'none'
    }

    const wasAtBottom = isAtBottom()
    const hasNewMessages = count > prevMessageCount
    prevMessageCount = count

    if (isInitialLoad.val && count > 0) {
      requestAnimationFrame(() => scrollToBottom())
      isInitialLoad.val = false
    } else if (wasAtBottom && hasNewMessages) {
      requestAnimationFrame(() => scrollToBottom())
    }
  }

  // Compose bar — iChat style
  const messageInput = input({
    class: 'ichat-compose-input',
    type: 'text',
    placeholder: 'Type a message...',
  }) as HTMLInputElement
  let newMessage = ''
  messageInput.addEventListener('input', () => { newMessage = messageInput.value })
  messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleSend() }
  })

  const sendBtn = button({ class: 'ichat-send-btn', onclick: () => void handleSend() }, 'Send') as HTMLButtonElement

  el.appendChild(div({ class: 'ichat-compose-bar' }, messageInput, sendBtn) as HTMLElement)

  function updateHeader() {
    const conversation = conversationState.val
    const { url, seed } = getAvatarInfo()
    const displayName = getDisplayName()

    if (conversation?.isGroup) {
      const groupAvatar = div({ class: 'ichat-buddy-avatar ichat-buddy-avatar--group', style: 'width:32px;height:32px' },
        html(`<svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"/></svg>`),
      ) as HTMLElement
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
      const keyed: Record<string, ForumlineDirectMessage> = {}
      for (const msg of data) {
        keyed[msg.id] = noreactive(msg)
      }
      replace(messages, keyed)
      if (spinnerWrap.parentNode) spinnerWrap.remove()
      onMessagesUpdated()
      if (data.length > 0) {
        void forumlineClient.markRead(conversationId).then(() => {
          void refreshDmConversations()
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

  // Initial loading
  const spinnerWrap = div({ class: 'ichat-loading' }) as HTMLElement
  spinnerWrap.appendChild(createSpinner())
  messagesContainer.appendChild(spinnerWrap)
  listEl.style.display = 'none'
  emptyState.style.display = 'none'
  messagesContainer.appendChild(listEl)
  messagesContainer.appendChild(emptyState)

  void fetchConversationInfo()
  void fetchMessages()

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
