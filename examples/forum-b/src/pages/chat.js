import { api } from '../lib/api.js'
import { authStore } from '../lib/auth.js'
import { avatarHTML } from '../components/avatar.js'
import { formatTime, formatDateLabel } from '../lib/date.js'
import { connectSSE } from '../lib/sse.js'

export function renderChat(container, { channelId }) {
  const { user } = authStore.get()
  let sseCleanup = null
  let channels = []
  let messages = []
  let currentChannel = null

  document.body.classList.add('chat-active')

  async function loadChannels() {
    channels = await api.getChannels()
    if (!channelId && channels.length > 0) currentChannel = channels[0]
    else currentChannel = channels.find(c => c.id === channelId) || null
  }

  async function loadMessages() {
    if (!currentChannel) return
    messages = await api.getChatMessages(currentChannel.slug)
  }

  function render() {
    container.innerHTML = `
      <div class="chat-wrapper">
        <div class="chat-header">
          <span class="chat-header-channel">#${escapeHTML(currentChannel?.name || '')}</span>
          ${currentChannel?.description ? ` <span style="color:var(--text-muted);font-size:11px">&mdash; ${escapeHTML(currentChannel.description)}</span>` : ''}
        </div>

        <div id="messages-area" class="chat-messages">
          ${renderMessages()}
        </div>

        ${user ? `
          <div class="chat-input-area">
            <input id="chat-input" type="text" placeholder="Message #${escapeHTML(currentChannel?.name || '')}" class="form-input" />
            <button id="chat-send" class="btn btn-primary btn-small">Send</button>
          </div>
        ` : `
          <div class="chat-input-area" style="justify-content:center">
            <span style="font-size:12px;color:var(--text-muted)"><a href="/login" class="link-pink">Sign in</a> to chat.</span>
          </div>
        `}
      </div>
    `

    const area = container.querySelector('#messages-area')
    if (area) area.scrollTop = area.scrollHeight

    const input = container.querySelector('#chat-input')
    const sendBtn = container.querySelector('#chat-send')

    function sendMessage() {
      const content = input?.value?.trim()
      if (!content || !currentChannel || !user) return
      input.value = ''

      const optimistic = {
        id: 'temp-' + Date.now(),
        channel_id: currentChannel.id,
        author_id: user.id,
        content,
        created_at: new Date().toISOString(),
        author: { id: user.id, username: user.username, display_name: user.username, avatar_url: user.avatar },
      }
      messages.push(optimistic)
      renderMessagesInPlace()

      api.sendChatMessage({ channel_id: currentChannel.id, author_id: user.id, content }).catch(() => {
        messages = messages.filter(m => m.id !== optimistic.id)
        renderMessagesInPlace()
      })
    }

    if (sendBtn) sendBtn.addEventListener('click', sendMessage)
    if (input) {
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendMessage() })
      input.focus()
    }

    if (currentChannel) {
      if (sseCleanup) sseCleanup()
      sseCleanup = connectSSE(`/api/channels/${currentChannel.slug}/stream`, (data) => {
        if (!data || !data.id) return
        if (messages.find(m => m.id === data.id)) return
        const tempIdx = messages.findIndex(m => m.id.startsWith('temp-') && m.content === data.content && m.author_id === data.author_id)
        if (tempIdx !== -1) messages[tempIdx] = data
        else messages.push(data)
        renderMessagesInPlace()
      }, true)
    }
  }

  function renderMessages() {
    if (!messages.length) return '<div class="empty-state"><p>No messages yet. Break the silence...</p></div>'

    let html = ''
    let lastDate = '', lastAuthor = '', lastTime = 0

    for (const msg of messages) {
      const dateLabel = formatDateLabel(msg.created_at)
      if (dateLabel !== lastDate) {
        html += `<div class="chat-date-divider"><span style="background:var(--bg-deep);padding:0 8px">${dateLabel}</span></div>`
        lastDate = dateLabel
        lastAuthor = ''
      }

      const msgTime = new Date(msg.created_at).getTime()
      const sameGroup = msg.author_id === lastAuthor && (msgTime - lastTime) < 300000

      if (sameGroup) {
        html += `<div class="chat-msg-grouped">${escapeHTML(msg.content)}</div>`
      } else {
        html += `
          <div class="chat-msg">
            ${avatarHTML({ avatarUrl: msg.author?.avatar_url, size: 32 })}
            <div class="min-w-0">
              <div>
                <a href="/u/${msg.author?.username || ''}" class="chat-msg-author">${escapeHTML(msg.author?.display_name || msg.author?.username || 'Unknown')}</a>
                <span class="chat-msg-time">${formatTime(msg.created_at)}</span>
              </div>
              <div class="chat-msg-content">${escapeHTML(msg.content)}</div>
            </div>
          </div>
        `
      }

      lastAuthor = msg.author_id
      lastTime = msgTime
    }

    return html
  }

  function renderMessagesInPlace() {
    const area = container.querySelector('#messages-area')
    if (!area) return
    const wasAtBottom = area.scrollHeight - area.scrollTop - area.clientHeight < 50
    area.innerHTML = renderMessages()
    if (wasAtBottom) area.scrollTop = area.scrollHeight
  }

  loadChannels().then(loadMessages).then(render).catch(() => {
    container.innerHTML = `
      <div class="empty-state">
        <p style="color:var(--accent-red)">Failed to load chat.</p>
        <button id="retry-chat" class="btn btn-small mt-2">Try again</button>
      </div>
    `
    container.querySelector('#retry-chat')?.addEventListener('click', () => renderChat(container, { channelId }))
  })

  return () => {
    document.body.classList.remove('chat-active')
    if (sseCleanup) sseCleanup()
  }
}

function escapeHTML(str) {
  const div = document.createElement('div')
  div.textContent = str || ''
  return div.innerHTML
}
