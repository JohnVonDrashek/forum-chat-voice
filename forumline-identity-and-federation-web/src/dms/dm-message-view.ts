/*
 * DM message thread view (Van.js)
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
 */
import type { ForumlineStore } from '../shared/forumline-store.js'
import type { ForumlineDirectMessage, ForumlineDmConversation, ForumlineConversationMember } from '@johnvondrashek/forumline-protocol'
import { tags, html } from '../shared/dom.js'
import { createAvatar, createButton, createInput, createSpinner } from '../shared/ui.js'
import { formatMessageTime } from '../shared/dateFormatters.js'
import { subscribeDmEvents } from './dm-sse.js'
import { initiateCall, getCallState } from '../calls/call-manager.js'

const { div, h3, p, span, button } = tags

interface DmMessageViewOptions {
  forumlineStore: ForumlineStore
  conversationId: string
}

export function createDmMessageView({ forumlineStore, conversationId }: DmMessageViewOptions) {
  let messages: ForumlineDirectMessage[] = []
  let conversation: ForumlineDmConversation | null = null
  let newMessage = ''
  let sending = false
  let initialLoad = true

  const el = div({ class: 'flex flex-col', style: 'height:100%' }) as HTMLElement

  function getDisplayName(): string {
    if (!conversation) return 'Chat'
    if (conversation.isGroup && conversation.name) return conversation.name
    const { forumlineUserId } = forumlineStore.get()
    const others = conversation.members.filter((m: ForumlineConversationMember) => m.id !== forumlineUserId)
    return others.map((m: ForumlineConversationMember) => m.displayName || m.username).join(', ')
  }

  function getAvatarInfo(): { url: string | null; seed: string } {
    if (!conversation) return { url: null, seed: 'chat' }
    if (conversation.isGroup) return { url: null, seed: conversation.name || conversation.id }
    const { forumlineUserId } = forumlineStore.get()
    const other = conversation.members.find((m: ForumlineConversationMember) => m.id !== forumlineUserId)
    return { url: other?.avatarUrl ?? null, seed: other?.username || conversation.id }
  }

  function getMemberName(senderId: string): string {
    if (!conversation) return 'User'
    const member = conversation.members.find((m: ForumlineConversationMember) => m.id === senderId)
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
      if (!conversation || conversation.isGroup || getCallState() !== 'idle') return
      const { forumlineUserId } = forumlineStore.get()
      const other = conversation.members.find((m: ForumlineConversationMember) => m.id !== forumlineUserId)
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

  const messageList = div({ style: 'display:flex;flex-direction:column;gap:0.25rem' }) as HTMLElement
  const emptyState = div({ class: 'text-center text-faint', style: 'padding:3rem 0' }, 'No messages yet. Say hello!') as HTMLElement

  // Compose bar
  const messageInput = createInput({ type: 'text', placeholder: 'Type a message...' })
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

  function isAtBottom(): boolean {
    return messagesContainer.scrollTop + messagesContainer.clientHeight >= messagesContainer.scrollHeight - 50
  }

  function scrollToBottom() {
    messagesContainer.scrollTop = messagesContainer.scrollHeight
  }

  function createMessageRow(msg: ForumlineDirectMessage): HTMLElement {
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

  function renderMessages() {
    const wasAtBottom = isAtBottom()

    if (messages.length === 0) {
      messagesContainer.innerHTML = ''
      messagesContainer.appendChild(emptyState)
      return
    }

    messagesContainer.innerHTML = ''
    messageList.innerHTML = ''
    for (const msg of messages) {
      messageList.appendChild(createMessageRow(msg))
    }
    messagesContainer.appendChild(messageList)

    if (wasAtBottom || initialLoad) {
      scrollToBottom()
      initialLoad = false
    }
  }

  async function fetchConversationInfo() {
    const { forumlineClient } = forumlineStore.get()
    if (!forumlineClient) return
    try {
      const convo = await forumlineClient.getConversation(conversationId)
      if (convo) { conversation = convo; updateHeader() }
    } catch (err) {
      console.error('[Forumline:DM] Failed to fetch conversation:', err)
    }
  }

  async function fetchMessages() {
    const { forumlineClient } = forumlineStore.get()
    if (!forumlineClient) return
    try {
      messages = await forumlineClient.getMessages(conversationId)
      renderMessages()
      if (messages.length > 0) {
        forumlineClient.markRead(conversationId).then(() => {
          window.dispatchEvent(new CustomEvent('forumline:dm-read'))
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

    const optimistic: ForumlineDirectMessage = {
      id: `temp-${Date.now()}`,
      conversation_id: conversationId,
      sender_id: forumlineUserId || '',
      content,
      created_at: new Date().toISOString(),
    }
    messages = [...messages, optimistic]
    newMessage = ''
    messageInput.value = ''
    renderMessages()

    try {
      await forumlineClient.sendMessage(conversationId, content)
    } catch (err) {
      messages = messages.filter((m) => m.id !== optimistic.id)
      renderMessages()
      console.error('[Forumline:DM] Failed to send message:', err)
    } finally {
      sending = false
    }
  }

  // Initial loading
  const spinnerWrap = div({ class: 'flex items-center justify-center flex-1' }) as HTMLElement
  spinnerWrap.appendChild(createSpinner())
  messagesContainer.appendChild(spinnerWrap)

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
