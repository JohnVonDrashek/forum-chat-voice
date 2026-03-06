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

  const el = document.createElement('div')
  el.className = 'flex flex-col'
  el.style.height = '100%'

  // Message header
  const headerEl = document.createElement('div')
  headerEl.className = 'message-header'
  el.appendChild(headerEl)

  // Messages container
  const messagesContainer = document.createElement('div')
  messagesContainer.className = 'flex-1 overflow-y-auto p-lg'
  el.appendChild(messagesContainer)

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

  function renderHeader() {
    headerEl.innerHTML = ''
    headerEl.appendChild(createAvatar({ avatarUrl: recipientAvatarUrl, seed: recipientName, size: 32 }))
    const h3 = document.createElement('h3')
    h3.className = 'font-medium text-white'
    h3.textContent = recipientName
    headerEl.appendChild(h3)
  }

  function renderMessages() {
    messagesContainer.innerHTML = ''
    const { hubUserId } = hubStore.get()

    if (messages.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'text-center text-faint'
      empty.style.padding = '3rem 0'
      empty.textContent = 'No messages yet. Say hello!'
      messagesContainer.appendChild(empty)
      return
    }

    const list = document.createElement('div')
    list.style.display = 'flex'
    list.style.flexDirection = 'column'
    list.style.gap = '1rem'

    for (const msg of messages) {
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
      list.appendChild(row)
    }

    messagesContainer.appendChild(list)

    // Scroll to bottom
    messagesContainer.scrollTop = messagesContainer.scrollHeight
  }

  async function fetchMessages() {
    const { hubClient } = hubStore.get()
    if (!hubClient) return

    try {
      // Fetch conversation info for recipient name
      const convos = await hubClient.getConversations()
      const convo = convos.find((c) => c.recipientId === recipientId)
      if (convo) {
        recipientName = convo.recipientName
        recipientAvatarUrl = convo.recipientAvatarUrl ?? null
        messageInput.placeholder = `Message ${recipientName}...`
        renderHeader()
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

  renderHeader()
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
