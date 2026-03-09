/*
 * Direct Messages panel (Van.js)
 *
 * This file is the top-level container for all DM functionality, managing navigation between DM sub-views.
 *
 * It must:
 * - Show the conversation list as the default view
 * - Navigate to a message thread when a conversation is selected
 * - Navigate to the new 1:1 message screen when the compose button is tapped
 * - Navigate to the new group conversation screen when the group button is tapped
 * - Provide back navigation from any sub-view to the conversation list
 * - Show a sign-in prompt with a link to settings when the user is not connected to Forumline
 * - Create or retrieve a 1:1 conversation when a user is selected from the new message search
 * - Display a header with contextual title (Messages, New Message, New Group) and action buttons
 * - Keep the conversation list alive across navigation to avoid re-fetching and spinner flashes
 * - Destroy ephemeral child views (conversation thread, new message, new group) on navigation
 */
import type { ForumlineStore } from '../shared/forumline-store.js'
import { tags, html } from '../shared/dom.js'
import { createButton } from '../shared/ui.js'
import { createDmConversationList } from './dm-conversation-list.js'
import { createDmMessageView } from './dm-message-view.js'
import { createDmNewMessage } from './dm-new-message.js'
import { createDmNewGroup } from './dm-new-group.js'

const { div, h2, button } = tags

type DmView = 'list' | 'conversation' | 'new' | 'new-group'

interface DmPanelOptions {
  forumlineStore: ForumlineStore
  onClose: () => void
  onGoToSettings: () => void
}

export function createDmPanel({ forumlineStore, onClose, onGoToSettings }: DmPanelOptions) {
  let dmView: DmView = 'list'
  let selectedConversationId: string | null = null
  let ephemeralChild: { el: HTMLElement; destroy: () => void } | null = null
  let listChild: { el: HTMLElement; destroy: () => void } | null = null

  const el = div({
    class: 'flex flex-col w-full overflow-hidden',
    style: 'height:100%;background:var(--color-bg)',
  }) as HTMLElement

  const header = div({ class: 'dm-header' }) as HTMLElement
  const content = div({ class: 'flex-1 overflow-hidden' }) as HTMLElement
  el.append(header, content)

  function destroyEphemeral() {
    if (ephemeralChild) {
      ephemeralChild.el.remove()
      ephemeralChild.destroy()
      ephemeralChild = null
    }
  }

  function ensureListChild() {
    if (listChild) return
    listChild = createDmConversationList({
      forumlineStore,
      onSelectConversation: (conversationId) => {
        selectedConversationId = conversationId
        dmView = 'conversation'
        render()
      },
    })
    content.appendChild(listChild.el)
  }

  function render() {
    destroyEphemeral()
    const { isForumlineConnected } = forumlineStore.get()

    // Header
    header.innerHTML = ''
    const headerLeft = div({ class: 'flex items-center gap-sm' }) as HTMLElement

    if (dmView !== 'list') {
      const backBtn = button({
        class: 'btn--icon',
        onclick: () => { dmView = 'list'; selectedConversationId = null; render() },
      }, html(`<svg class="icon-sm" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/></svg>`)) as HTMLButtonElement
      headerLeft.appendChild(backBtn)
    }

    headerLeft.appendChild(
      h2({ class: 'font-semibold text-white' },
        dmView === 'new' ? 'New Message' : dmView === 'new-group' ? 'New Group' : 'Messages',
      ) as HTMLElement,
    )
    header.appendChild(headerLeft)

    const headerRight = div({ class: 'flex items-center gap-sm' }) as HTMLElement
    if (dmView === 'list' && isForumlineConnected) {
      const groupBtn = button({
        class: 'btn--icon',
        title: 'New group',
        onclick: () => { dmView = 'new-group'; render() },
      }, html(`<svg class="icon-sm" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"/></svg>`)) as HTMLButtonElement
      headerRight.appendChild(groupBtn)

      const newBtn = button({
        class: 'btn--icon',
        title: 'New message',
        onclick: () => { dmView = 'new'; render() },
      }, html(`<svg class="icon-sm" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>`)) as HTMLButtonElement
      headerRight.appendChild(newBtn)
    }
    header.appendChild(headerRight)

    // Content
    if (!isForumlineConnected) {
      if (listChild) listChild.el.style.display = 'none'
      const empty = div({ class: 'empty-state' }) as HTMLElement
      empty.appendChild(
        tags.p({ class: 'text-muted' }, 'Sign in to send direct messages across forums') as HTMLElement,
      )
      empty.appendChild(createButton({
        text: 'Sign in',
        variant: 'primary',
        className: 'mt-lg',
        onClick: onGoToSettings,
      }))
      ephemeralChild = { el: empty, destroy() {} }
      content.appendChild(empty)
    } else if (dmView === 'new') {
      if (listChild) listChild.el.style.display = 'none'
      const newMsg = createDmNewMessage({
        forumlineStore,
        onSelectUser: async (userId) => {
          const { forumlineClient } = forumlineStore.get()
          if (!forumlineClient) return
          try {
            const { id } = await forumlineClient.getOrCreateDM(userId)
            selectedConversationId = id
            dmView = 'conversation'
            render()
          } catch (err) {
            console.error('[Forumline:DM] Failed to get/create DM:', err)
          }
        },
      })
      ephemeralChild = newMsg
      content.appendChild(newMsg.el)
    } else if (dmView === 'new-group') {
      if (listChild) listChild.el.style.display = 'none'
      const newGroup = createDmNewGroup({
        forumlineStore,
        onCreated: (conversationId) => {
          selectedConversationId = conversationId
          dmView = 'conversation'
          render()
        },
      })
      ephemeralChild = newGroup
      content.appendChild(newGroup.el)
    } else if (dmView === 'conversation' && selectedConversationId) {
      if (listChild) listChild.el.style.display = 'none'
      const msgView = createDmMessageView({
        forumlineStore,
        conversationId: selectedConversationId,
      })
      ephemeralChild = msgView
      content.appendChild(msgView.el)
    } else {
      ensureListChild()
      listChild!.el.style.display = ''
    }
  }

  render()

  return {
    el,
    destroy() {
      destroyEphemeral()
      listChild?.destroy()
    },
  }
}
