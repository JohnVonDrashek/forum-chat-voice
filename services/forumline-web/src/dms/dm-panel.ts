/*
 * Direct Messages panel — iChat theme (Van.js)
 *
 * Top-level container for all DM functionality with brushed metal chrome,
 * traffic-light window controls, and an Aqua-era toolbar.
 *
 * On desktop (>=768px): two-pane iChat layout — buddy list sidebar on the left,
 * chat/new-message/new-group on the right. Both visible simultaneously.
 *
 * On mobile (<768px): single-pane navigation — list or detail, not both.
 *
 * It must:
 * - Show the conversation list as the default view
 * - Navigate to a message thread when a conversation is selected
 * - Navigate to the new 1:1 message screen when the compose button is tapped
 * - Navigate to the new group conversation screen when the group button is tapped
 * - Provide back navigation from any sub-view to the conversation list (mobile only)
 * - Show a sign-in prompt when the user is not connected to Forumline
 * - Create or retrieve a 1:1 conversation when a user is selected from new message search
 * - Keep the conversation list alive across navigation to avoid re-fetching
 * - Destroy ephemeral child views on navigation
 */
import type { ForumlineStore } from '../shared/forumline-store.js'
import { tags, html } from '../shared/dom.js'
import { createButton } from '../shared/ui.js'
import { createDmConversationList } from './dm-conversation-list.js'
import { createDmMessageView } from './dm-message-view.js'
import { createDmNewMessage } from './dm-new-message.js'
import { createDmNewGroup } from './dm-new-group.js'

const { div, button, input, span } = tags

type DmView = 'list' | 'conversation' | 'new' | 'new-group'

interface DmPanelOptions {
  forumlineStore: ForumlineStore
  onClose: () => void
  onGoToSettings: () => void
}

export function createDmPanel({ forumlineStore, onClose: _onClose, onGoToSettings }: DmPanelOptions) {
  let dmView: DmView = 'list'
  let selectedConversationId: string | null = null
  let ephemeralChild: { el: HTMLElement; destroy: () => void } | null = null
  let listChild: { el: HTMLElement; destroy: () => void } | null = null

  const el = div({ class: 'ichat-window' }) as HTMLElement

  // Toolbar — brushed metal
  const toolbar = div({ class: 'ichat-toolbar' }) as HTMLElement

  // Two-pane layout: sidebar (buddy list) + detail (chat/new/group)
  const splitPane = div({ class: 'ichat-split' }) as HTMLElement
  const sidebarPane = div({ class: 'ichat-split-sidebar' }) as HTMLElement
  const detailPane = div({ class: 'ichat-split-detail' }) as HTMLElement
  splitPane.append(sidebarPane, detailPane)

  el.append(toolbar, splitPane)

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
    sidebarPane.appendChild(listChild.el)
  }

  function render() {
    destroyEphemeral()
    const { isForumlineConnected } = forumlineStore.get()

    // Toolbar
    toolbar.innerHTML = ''

    // On mobile, show back button when in a sub-view
    if (dmView !== 'list') {
      const backBtn = button({
        class: 'ichat-toolbar-btn ichat-mobile-only',
        onclick: () => { dmView = 'list'; selectedConversationId = null; render() },
      }, html(`<svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7"/></svg>`),
        span({}, ' Back'),
      ) as HTMLButtonElement
      toolbar.appendChild(backBtn)
    }

    const toolbarRight = div({ class: 'ichat-toolbar-right' }) as HTMLElement
    if (isForumlineConnected) {
      const groupBtn = button({
        class: 'ichat-toolbar-btn',
        title: 'New group',
        onclick: () => { dmView = 'new-group'; render() },
      }, html(`<svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"/></svg>`),
        span({}, ' Group'),
      ) as HTMLButtonElement
      toolbarRight.appendChild(groupBtn)

      const newBtn = button({
        class: 'ichat-toolbar-btn',
        title: 'New message',
        onclick: () => { dmView = 'new'; render() },
      }, html(`<svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>`),
        span({}, ' New'),
      ) as HTMLButtonElement
      toolbarRight.appendChild(newBtn)

      // Search field
      const search = input({
        class: 'ichat-toolbar-search',
        type: 'text',
        placeholder: 'Search...',
      }) as HTMLInputElement
      toolbarRight.appendChild(search)
    }
    toolbar.appendChild(toolbarRight)

    // Sidebar: always show the buddy list on desktop, hide on mobile when in sub-view
    if (!isForumlineConnected) {
      sidebarPane.innerHTML = ''
      const empty = div({ class: 'ichat-empty-state' }) as HTMLElement
      empty.appendChild(
        tags.p({ class: 'ichat-empty-text' }, 'Sign in to send direct messages across forums') as HTMLElement,
      )
      empty.appendChild(createButton({
        text: 'Sign in',
        variant: 'primary',
        className: 'ichat-signin-btn',
        onClick: onGoToSettings,
      }))
      sidebarPane.appendChild(empty)
      detailPane.innerHTML = ''
      return
    }

    ensureListChild()

    // On mobile: toggle sidebar vs detail visibility
    if (dmView === 'list') {
      sidebarPane.classList.remove('ichat-split-sidebar--hidden')
      detailPane.classList.add('ichat-split-detail--hidden')
    } else {
      sidebarPane.classList.add('ichat-split-sidebar--hidden')
      detailPane.classList.remove('ichat-split-detail--hidden')
    }

    // Detail pane content
    detailPane.innerHTML = ''
    if (dmView === 'new') {
      const newMsg = createDmNewMessage({
        forumlineStore,
        onSelectUser: (userId) => {
          const { forumlineClient } = forumlineStore.get()
          if (!forumlineClient) return
          void forumlineClient.getOrCreateDM(userId).then(({ id }) => {
            selectedConversationId = id
            dmView = 'conversation'
            render()
          }).catch((err) => {
            console.error('[Forumline:DM] Failed to get/create DM:', err)
          })
        },
      })
      ephemeralChild = newMsg
      detailPane.appendChild(newMsg.el)
    } else if (dmView === 'new-group') {
      const newGroup = createDmNewGroup({
        forumlineStore,
        onCreated: (conversationId) => {
          selectedConversationId = conversationId
          dmView = 'conversation'
          render()
        },
      })
      ephemeralChild = newGroup
      detailPane.appendChild(newGroup.el)
    } else if (dmView === 'conversation' && selectedConversationId) {
      const msgView = createDmMessageView({
        forumlineStore,
        conversationId: selectedConversationId,
      })
      ephemeralChild = msgView
      detailPane.appendChild(msgView.el)
    } else {
      // List-only view (desktop: show placeholder in detail pane)
      const placeholder = div({ class: 'ichat-detail-placeholder' },
        html(`<svg width="48" height="48" style="color:#aabbcc" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/></svg>`),
        tags.p({ class: 'ichat-empty-text' }, 'Select a conversation'),
      ) as HTMLElement
      detailPane.appendChild(placeholder)
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
