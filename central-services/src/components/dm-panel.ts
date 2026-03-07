import type { ForumlineStore } from '@johnvondrashek/forumline-core'
import { createButton } from './ui.js'
import { createDmConversationList } from './dm-conversation-list.js'
import { createDmMessageView } from './dm-message-view.js'
import { createDmNewMessage } from './dm-new-message.js'

type DmView = 'list' | 'conversation' | 'new'

interface DmPanelOptions {
  forumlineStore: ForumlineStore
  onClose: () => void
  onGoToSettings: () => void
}

export function createDmPanel({ forumlineStore, onClose, onGoToSettings }: DmPanelOptions) {
  let dmView: DmView = 'list'
  let selectedRecipientId: string | null = null
  let currentChild: { el: HTMLElement; destroy: () => void } | null = null

  const el = document.createElement('div')
  el.className = 'flex flex-col w-full overflow-hidden'
  el.style.height = '100%'
  el.style.background = 'var(--color-bg)'

  function render() {
    currentChild?.destroy()
    currentChild = null
    el.innerHTML = ''

    const { isForumlineConnected } = forumlineStore.get()

    // Header
    const header = document.createElement('div')
    header.className = 'dm-header'

    const headerLeft = document.createElement('div')
    headerLeft.className = 'flex items-center gap-sm'

    if (dmView !== 'list') {
      const backBtn = document.createElement('button')
      backBtn.className = 'btn--icon'
      backBtn.innerHTML = `<svg class="icon-sm" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/></svg>`
      backBtn.addEventListener('click', () => {
        dmView = 'list'
        selectedRecipientId = null
        render()
      })
      headerLeft.appendChild(backBtn)
    }

    const title = document.createElement('h2')
    title.className = 'font-semibold text-white'
    title.textContent = dmView === 'new' ? 'New Message' : 'Messages'
    headerLeft.appendChild(title)
    header.appendChild(headerLeft)

    const headerRight = document.createElement('div')
    headerRight.className = 'flex items-center gap-sm'
    if (dmView === 'list' && isForumlineConnected) {
      const newBtn = document.createElement('button')
      newBtn.className = 'btn--icon'
      newBtn.title = 'New message'
      newBtn.innerHTML = `<svg class="icon-sm" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>`
      newBtn.addEventListener('click', () => { dmView = 'new'; render() })
      headerRight.appendChild(newBtn)
    }
    header.appendChild(headerRight)
    el.appendChild(header)

    // Content
    const content = document.createElement('div')
    content.className = 'flex-1 overflow-hidden'

    if (!isForumlineConnected) {
      const empty = document.createElement('div')
      empty.className = 'empty-state'
      const p = document.createElement('p')
      p.className = 'text-muted'
      p.textContent = 'Sign in to send direct messages across forums'
      empty.appendChild(p)
      empty.appendChild(createButton({
        text: 'Sign in',
        variant: 'primary',
        className: 'mt-lg',
        onClick: onGoToSettings,
      }))
      content.appendChild(empty)
    } else if (dmView === 'new') {
      const newMsg = createDmNewMessage({
        forumlineStore,
        onSelectUser: (userId) => {
          selectedRecipientId = userId
          dmView = 'conversation'
          render()
        },
      })
      currentChild = newMsg
      content.appendChild(newMsg.el)
    } else if (dmView === 'conversation' && selectedRecipientId) {
      const msgView = createDmMessageView({
        forumlineStore,
        recipientId: selectedRecipientId,
      })
      currentChild = msgView
      content.appendChild(msgView.el)
    } else {
      const convList = createDmConversationList({
        forumlineStore,
        onSelectConversation: (recipientId) => {
          selectedRecipientId = recipientId
          dmView = 'conversation'
          render()
        },
      })
      currentChild = convList
      content.appendChild(convList.el)
    }

    el.appendChild(content)
  }

  render()

  return {
    el,
    destroy() {
      currentChild?.destroy()
    },
  }
}
