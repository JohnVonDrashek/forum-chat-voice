import type { ForumlineStore } from '../lib/index.js'
import type { ForumlineDirectMessage, ForumlineDmConversation, ForumlineConversationMember } from '@johnvondrashek/forumline-protocol'
import { createAvatar, createButton, createInput, createSpinner } from './ui.js'
import { formatMessageTime } from '../lib/dateFormatters.js'
import { subscribeDmEvents } from '../lib/dm-sse.js'
import { initiateCall, getCallState } from '../lib/call-manager.js'

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
  const headerTextWrap = document.createElement('div')
  headerTextWrap.style.cssText = 'min-width:0;flex:1'
  const headerName = document.createElement('h3')
  headerName.className = 'font-medium text-white'
  headerName.textContent = 'Chat'
  const headerMembers = document.createElement('button')
  headerMembers.className = 'text-xs text-muted truncate'
  headerMembers.style.cssText = 'margin-top:1px;background:none;border:none;padding:0;cursor:pointer;text-align:left;width:100%;color:inherit'
  headerTextWrap.append(headerName, headerMembers)

  // Call button (1:1 only)
  const callBtn = document.createElement('button')
  callBtn.style.cssText = 'background:none;border:none;cursor:pointer;padding:0.25rem;color:var(--color-text-secondary);display:none'
  callBtn.title = 'Start voice call'
  callBtn.innerHTML = `<svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"/></svg>`
  callBtn.addEventListener('click', () => {
    if (!conversation || conversation.isGroup || getCallState() !== 'idle') return
    const { forumlineUserId } = forumlineStore.get()
    const other = conversation.members.find((m: ForumlineConversationMember) => m.id !== forumlineUserId)
    if (!other) return
    initiateCall(conversationId, other.id, other.displayName || other.username, (other as any).avatarUrl ?? null)
  })

  headerEl.append(headerAvatar, headerTextWrap, callBtn)
  el.appendChild(headerEl)

  // Expandable member list panel
  const memberPanel = document.createElement('div')
  memberPanel.style.cssText = 'display:none;background:var(--color-surface);border-bottom:1px solid var(--color-border);padding:0.5rem 1rem;max-height:200px;overflow-y:auto'
  el.insertBefore(memberPanel, el.children[1])
  let memberPanelOpen = false

  headerMembers.addEventListener('click', () => {
    memberPanelOpen = !memberPanelOpen
    memberPanel.style.display = memberPanelOpen ? '' : 'none'
  })

  function renderMemberPanel() {
    if (!conversation?.isGroup) return
    memberPanel.innerHTML = ''
    const { forumlineUserId } = forumlineStore.get()
    const label = document.createElement('div')
    label.className = 'text-xs text-faint'
    label.style.cssText = 'margin-bottom:0.375rem;font-weight:600'
    label.textContent = `Members (${conversation.members.length})`
    memberPanel.appendChild(label)
    for (const m of conversation.members) {
      const row = document.createElement('div')
      row.style.cssText = 'display:flex;align-items:center;gap:0.5rem;padding:0.25rem 0'
      const avatar = createAvatar({ avatarUrl: (m as any).avatarUrl ?? null, seed: m.username, size: 24 })
      const name = document.createElement('span')
      name.className = 'text-sm text-secondary'
      name.textContent = m.id === forumlineUserId
        ? `${m.displayName || m.username} (you)`
        : (m.displayName || m.username)
      row.append(avatar, name)
      memberPanel.appendChild(row)
    }
  }

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

    // Show call button for 1:1 conversations
    callBtn.style.display = (conversation && !conversation.isGroup) ? '' : 'none'

    // Show member names for group chats (cap at 4 names + "N more")
    if (conversation?.isGroup && conversation.members.length > 0) {
      const { forumlineUserId } = forumlineStore.get()
      const names = conversation.members.map((m: ForumlineConversationMember) =>
        m.id === forumlineUserId ? 'you' : (m.displayName || m.username)
      )
      const maxShow = 4
      const shown = names.slice(0, maxShow)
      const remaining = names.length - maxShow
      headerMembers.textContent = remaining > 0
        ? `${shown.join(', ')} + ${remaining} more`
        : names.join(', ')
      headerMembers.style.display = ''
      renderMemberPanel()
    } else {
      headerMembers.style.display = 'none'
      memberPanel.style.display = 'none'
      memberPanelOpen = false
    }
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

  async function fetchConversationInfo() {
    const { forumlineClient } = forumlineStore.get()
    if (!forumlineClient) return
    try {
      const convo = await forumlineClient.getConversation(conversationId)
      if (convo) {
        conversation = convo
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
      messages = await forumlineClient.getMessages(conversationId)
      renderMessages()

      // Mark as read on every fetch (handles new messages arriving after initial load)
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
      // Keep optimistic visible — SSE-triggered fetchMessages() will replace it
      // with the real message (optimistic temp-* id won't match, so it gets swapped)
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

  fetchConversationInfo()
  fetchMessages()

  // SSE for real-time updates via shared connection (filtered to this conversation, debounced)
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
