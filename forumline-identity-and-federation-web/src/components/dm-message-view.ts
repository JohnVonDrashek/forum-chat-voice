import type { ForumlineStore } from '../lib/index.js'
import type { ForumlineDirectMessage, ForumlineDmConversation, ForumlineConversationMember } from '@johnvondrashek/forumline-protocol'
import { createAvatar, createButton, createInput, createSpinner } from './ui.js'
import { formatMessageTime } from '../lib/dateFormatters.js'
import { forumlineAuth } from '../app.js'

interface DmMessageViewOptions {
  forumlineStore: ForumlineStore
  conversationId: string
}

export function createDmMessageView({ forumlineStore, conversationId }: DmMessageViewOptions) {
  let messages: ForumlineDirectMessage[] = []
  let conversation: ForumlineDmConversation | null = null
  let newMessage = ''
  let sending = false
  let eventSource: EventSource | null = null
  let markedRead = false
  let initialLoad = true

  const el = document.createElement('div')
  el.className = 'flex flex-col'
  el.style.height = '100%'

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

  // Build a map of member IDs to display names for group sender labels
  function getMemberName(senderId: string): string {
    if (!conversation) return 'User'
    const member = conversation.members.find((m: ForumlineConversationMember) => m.id === senderId)
    return member?.displayName || member?.username || 'User'
  }

  // Message header — built once, updated in place
  const headerEl = document.createElement('div')
  headerEl.className = 'message-header'
  const headerAvatar = createAvatar({ avatarUrl: null, seed: 'chat', size: 32 })
  const headerName = document.createElement('h3')
  headerName.className = 'font-medium text-white'
  headerName.textContent = 'Chat'
  headerEl.append(headerAvatar, headerName)
  el.appendChild(headerEl)

  // Messages container
  const messagesContainer = document.createElement('div')
  messagesContainer.className = 'flex-1 overflow-y-auto p-lg'
  el.appendChild(messagesContainer)

  // Message list wrapper (lives inside messagesContainer)
  const messageList = document.createElement('div')
  messageList.style.display = 'flex'
  messageList.style.flexDirection = 'column'
  messageList.style.gap = '0.25rem'

  // Empty state
  const emptyState = document.createElement('div')
  emptyState.className = 'text-center text-faint'
  emptyState.style.padding = '3rem 0'
  emptyState.textContent = 'No messages yet. Say hello!'

  // Track rendered messages
  const renderedMessages = new Map<string, HTMLElement>()

  // Compose bar
  const composeBar = document.createElement('div')
  composeBar.className = 'compose-bar'

  const messageInput = createInput({ type: 'text', placeholder: 'Type a message...' })
  messageInput.addEventListener('input', () => { newMessage = messageInput.value })
  messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  })
  composeBar.appendChild(messageInput)

  const sendBtn = createButton({
    html: `<svg class="icon-sm" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"/></svg>`,
    variant: 'primary',
    onClick: handleSend,
  })
  composeBar.appendChild(sendBtn)
  el.appendChild(composeBar)

  function updateHeader() {
    const { url, seed } = getAvatarInfo()
    const displayName = getDisplayName()

    if (conversation?.isGroup) {
      // Group avatar icon
      const groupAvatar = document.createElement('div')
      groupAvatar.style.cssText = 'width:32px;height:32px;border-radius:50%;background:var(--color-surface-hover);display:flex;align-items:center;justify-content:center'
      groupAvatar.innerHTML = `<svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"/></svg>`
      if (headerEl.firstChild) headerEl.replaceChild(groupAvatar, headerEl.firstChild)
    } else {
      const newAvatar = createAvatar({ avatarUrl: url, seed, size: 32 })
      if (headerEl.firstChild) headerEl.replaceChild(newAvatar, headerEl.firstChild)
    }

    headerName.textContent = displayName
    messageInput.placeholder = `Message ${displayName}...`
  }

  function isAtBottom(): boolean {
    const threshold = 50
    return messagesContainer.scrollTop + messagesContainer.clientHeight >= messagesContainer.scrollHeight - threshold
  }

  function scrollToBottom() {
    messagesContainer.scrollTop = messagesContainer.scrollHeight
  }

  function createMessageRow(msg: ForumlineDirectMessage): HTMLElement {
    const { forumlineUserId } = forumlineStore.get()
    const isMe = msg.sender_id === forumlineUserId
    const row = document.createElement('div')
    row.className = isMe ? 'dm-row dm-row--mine' : 'dm-row dm-row--theirs'

    const wrap = document.createElement('div')
    wrap.style.maxWidth = '75%'

    // Show sender name in group chats for other people's messages
    if (conversation?.isGroup && !isMe) {
      const senderLabel = document.createElement('div')
      senderLabel.className = 'text-xs text-muted'
      senderLabel.style.marginBottom = '2px'
      senderLabel.textContent = getMemberName(msg.sender_id)
      wrap.appendChild(senderLabel)
    }

    const bubble = document.createElement('div')
    bubble.className = isMe ? 'dm-bubble dm-bubble--mine' : 'dm-bubble dm-bubble--theirs'
    bubble.textContent = msg.content
    wrap.appendChild(bubble)

    const time = document.createElement('div')
    time.className = `dm-time ${isMe ? 'text-right' : 'text-left'}`
    time.textContent = formatMessageTime(new Date(msg.created_at))
    wrap.appendChild(time)

    row.appendChild(wrap)
    return row
  }

  function renderMessages() {
    const wasAtBottom = isAtBottom()

    if (messages.length === 0) {
      // Show empty state
      messageList.remove()
      if (!emptyState.parentNode) {
        messagesContainer.innerHTML = ''
        messagesContainer.appendChild(emptyState)
      }
      return
    }

    // Show message list
    emptyState.remove()
    if (!messageList.parentNode) {
      messagesContainer.innerHTML = ''
      messagesContainer.appendChild(messageList)
    }

    // Build set of current message IDs for removal detection
    const currentIds = new Set(messages.map(m => m.id))

    // Remove messages that no longer exist (e.g. optimistic removed on failure)
    for (const [id, rowEl] of renderedMessages) {
      if (!currentIds.has(id)) {
        rowEl.remove()
        renderedMessages.delete(id)
      }
    }

    // Add new messages in order
    for (const msg of messages) {
      if (!renderedMessages.has(msg.id)) {
        const row = createMessageRow(msg)
        renderedMessages.set(msg.id, row)
        messageList.appendChild(row)
      }
    }

    // Auto-scroll only if user was at bottom or this is the initial load
    if (wasAtBottom || initialLoad) {
      scrollToBottom()
      initialLoad = false
    }
  }

  async function fetchMessages() {
    const { forumlineClient } = forumlineStore.get()
    if (!forumlineClient) return

    try {
      // Fetch conversation info
      const convo = await forumlineClient.getConversation(conversationId)
      if (convo) {
        conversation = convo
        updateHeader()
      }

      // Fetch messages
      messages = await forumlineClient.getMessages(conversationId)
      renderMessages()

      // Mark as read
      if (!markedRead && messages.length > 0) {
        markedRead = true
        forumlineClient.markRead(conversationId).catch(console.error)
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

    // Optimistic update
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
      // Remove optimistic message before adding real ones
      renderedMessages.get(optimistic.id)?.remove()
      renderedMessages.delete(optimistic.id)
      // Refetch to get real message
      const realMessages = await forumlineClient.getMessages(conversationId)
      messages = realMessages
      renderMessages()
    } catch (err) {
      // Remove optimistic on failure
      messages = messages.filter((m) => m.id !== optimistic.id)
      renderMessages()
      console.error('[Forumline:DM] Failed to send message:', err)
    } finally {
      sending = false
    }
  }

  // Initial loading
  const spinnerWrap = document.createElement('div')
  spinnerWrap.className = 'flex items-center justify-center flex-1'
  spinnerWrap.appendChild(createSpinner())
  messagesContainer.appendChild(spinnerWrap)

  fetchMessages()

  // SSE for real-time updates
  let destroyed = false
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null

  function connectSSE() {
    if (destroyed) return
    const session = forumlineAuth.getSession()
    if (!session) return

    const url = `/api/conversations/stream?access_token=${encodeURIComponent(session.access_token)}`
    eventSource = new EventSource(url)
    eventSource.onmessage = (event) => {
      // Only refetch if the event is for this conversation
      try {
        const data = JSON.parse(event.data)
        if (data.conversation_id !== conversationId) return
      } catch {
        // If we can't parse, refetch to be safe
      }
      fetchMessages()
    }
    eventSource.onerror = () => {
      eventSource?.close()
      eventSource = null
      // Reconnect after 5 seconds (unless destroyed)
      if (!destroyed) {
        reconnectTimer = setTimeout(connectSSE, 5000)
      }
    }
  }
  connectSSE()

  return {
    el,
    destroy() {
      destroyed = true
      eventSource?.close()
      eventSource = null
      if (reconnectTimer) clearTimeout(reconnectTimer)
    },
  }
}
