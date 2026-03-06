import type { HubStore } from '@johnvondrashek/forumline-core'
import type { HubDirectMessage } from '@johnvondrashek/forumline-protocol'
import { createAvatar, createButton, createInput, createSpinner } from './ui.js'
import { formatMessageTime } from '../lib/dateFormatters.js'

interface DmMessageViewOptions {
  hubStore: HubStore
  recipientId: string
}

export function createDmMessageView({ hubStore, recipientId }: DmMessageViewOptions) {
  let messages: HubDirectMessage[] = []
  let recipientName = 'User'
  let recipientAvatarUrl: string | null = null
  let newMessage = ''
  let sending = false
  let pollInterval: ReturnType<typeof setInterval> | null = null
  let markedRead = false
  let initialLoad = true

  const el = document.createElement('div')
  el.className = 'flex flex-col'
  el.style.height = '100%'

  // Message header — built once, updated in place
  const headerEl = document.createElement('div')
  headerEl.className = 'message-header'
  const headerAvatar = createAvatar({ avatarUrl: null, seed: recipientName, size: 32 })
  const headerName = document.createElement('h3')
  headerName.className = 'font-medium text-white'
  headerName.textContent = recipientName
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

  const messageInput = createInput({ type: 'text', placeholder: `Message ${recipientName}...` })
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
    // Replace avatar
    const newAvatar = createAvatar({ avatarUrl: recipientAvatarUrl, seed: recipientName, size: 32 })
    headerEl.replaceChild(newAvatar, headerEl.firstChild!)
    headerName.textContent = recipientName
  }

  function isAtBottom(): boolean {
    const threshold = 50
    return messagesContainer.scrollTop + messagesContainer.clientHeight >= messagesContainer.scrollHeight - threshold
  }

  function scrollToBottom() {
    messagesContainer.scrollTop = messagesContainer.scrollHeight
  }

  function createMessageRow(msg: HubDirectMessage): HTMLElement {
    const { hubUserId } = hubStore.get()
    const isMe = msg.sender_id === hubUserId
    const row = document.createElement('div')
    row.className = isMe ? 'dm-row dm-row--mine' : 'dm-row dm-row--theirs'

    const wrap = document.createElement('div')
    wrap.style.maxWidth = '75%'

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
    const { hubClient } = hubStore.get()
    if (!hubClient) return

    try {
      // Fetch conversation info for recipient name
      const convos = await hubClient.getConversations()
      const convo = convos.find((c) => c.recipientId === recipientId)
      if (convo) {
        const nameChanged = recipientName !== convo.recipientName || recipientAvatarUrl !== (convo.recipientAvatarUrl ?? null)
        recipientName = convo.recipientName
        recipientAvatarUrl = convo.recipientAvatarUrl ?? null
        messageInput.placeholder = `Message ${recipientName}...`
        if (nameChanged) updateHeader()
      }

      // Fetch messages
      messages = await hubClient.getMessages(recipientId)
      renderMessages()

      // Mark as read
      if (!markedRead && messages.length > 0) {
        markedRead = true
        hubClient.markRead(recipientId).catch(console.error)
      }
    } catch (err) {
      console.error('[Hub:DM] Failed to fetch messages:', err)
    }
  }

  async function handleSend() {
    if (!newMessage.trim() || sending) return
    const { hubClient, hubUserId } = hubStore.get()
    if (!hubClient) return

    const content = newMessage.trim()
    sending = true

    // Optimistic update
    const optimistic: HubDirectMessage = {
      id: `temp-${Date.now()}`,
      sender_id: hubUserId || '',
      recipient_id: recipientId,
      content,
      created_at: new Date().toISOString(),
      read: false,
    }
    messages = [...messages, optimistic]
    newMessage = ''
    messageInput.value = ''
    renderMessages()

    try {
      await hubClient.sendMessage(recipientId, content)
      // Remove optimistic message before adding real ones
      renderedMessages.get(optimistic.id)?.remove()
      renderedMessages.delete(optimistic.id)
      // Refetch to get real message
      const realMessages = await hubClient.getMessages(recipientId)
      messages = realMessages
      renderMessages()
    } catch (err) {
      // Remove optimistic on failure
      messages = messages.filter((m) => m.id !== optimistic.id)
      renderMessages()
      console.error('[Hub:DM] Failed to send message:', err)
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

  // Poll for new messages
  pollInterval = setInterval(fetchMessages, 15_000)

  return {
    el,
    destroy() {
      if (pollInterval) clearInterval(pollInterval)
    },
  }
}
