/*
 * Mobile forum list (Van.js)
 *
 * This file renders the list of the user's connected forums as tappable cards, optimized for mobile.
 *
 * It must:
 * - Display each forum as a card with its icon (or first-letter fallback), name, and domain
 * - Highlight the currently active forum
 * - Show unread count badges (notifications + chat mentions + DMs) on each forum card
 * - Provide an "Add Forum" button that opens a modal dialog
 * - Accept a forum URL in the modal, fetch its Forumline manifest, and add it to the user's list
 * - Show error messages in the modal if the forum URL is invalid or unreachable
 * - Switch to the tapped forum when a card is clicked
 * - Reactively update when forums are added, removed, or unread counts change
 */
import type { ForumStore, ForumMembership } from './forum-store.js'
import { tags, html } from '../shared/dom.js'
import { createButton, createInput } from '../shared/ui.js'

const { div, h2, p, button: btn } = tags

interface MobileForumListOptions {
  forumStore: ForumStore
}

function totalUnread(counts: { notifications: number; chat_mentions: number; dms: number } | undefined): number {
  if (!counts) return 0
  return counts.notifications + counts.chat_mentions + counts.dms
}

export function createMobileForumList({ forumStore }: MobileForumListOptions) {
  let modalEl: HTMLElement | null = null
  let addUrl = ''
  let adding = false
  let addError: string | null = null

  function createForumCard(forum: ForumMembership, isActive: boolean, unread: number): HTMLElement {
    const card = btn({
      class: `forum-card${isActive ? ' forum-card--active' : ''}`,
      onclick: () => forumStore.switchForum(forum.domain),
    }) as HTMLElement

    if (forum.icon_url) {
      const iconSrc = forum.icon_url.startsWith('/') ? `${forum.web_base}${forum.icon_url}` : forum.icon_url
      const img = tags.img({ src: iconSrc, alt: forum.name, class: 'forum-card__icon', onerror: () => { img.style.display = 'none' } }) as HTMLImageElement
      card.appendChild(img)
    } else {
      card.appendChild(div({ class: 'forum-card__icon-fallback' }, forum.name[0].toUpperCase()) as HTMLElement)
    }

    const textDiv = div({ class: 'flex-1', style: 'text-align:left' },
      p({ class: 'font-medium text-white' }, forum.name),
      p({ class: 'text-xs text-muted' }, forum.domain),
    )
    card.appendChild(textDiv as HTMLElement)

    if (unread > 0) {
      const badge = div({ class: 'badge badge--red badge--inline', style: 'position:static' }, unread > 99 ? '99+' : String(unread))
      card.appendChild(badge as HTMLElement)
    }

    return card
  }

  const addBtn = btn({
    class: 'add-forum-btn',
    onclick: () => showModal(),
  },
    html(`<svg class="icon-sm" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"/></svg>`),
    ' Add Forum',
  ) as HTMLElement

  const el = div(
    h2({
      class: 'text-sm font-semibold uppercase tracking-wider text-muted',
      style: 'margin-bottom:0.75rem',
    }, 'Your Forums'),
    () => {
      const { forums, activeForum, unreadCounts } = forumStore.state.val
      if (forums.length === 0) return div({ style: 'display:flex;flex-direction:column;gap:0.5rem' })
      const container = div({ style: 'display:flex;flex-direction:column;gap:0.5rem' }) as HTMLElement
      for (const forum of forums) {
        const unread = totalUnread(unreadCounts[forum.domain])
        const isActive = activeForum?.domain === forum.domain
        container.appendChild(createForumCard(forum, isActive, unread))
      }
      return container
    },
    addBtn,
  ) as HTMLElement

  function showModal() {
    modalEl?.remove()
    modalEl = div({ class: 'modal-backdrop' }) as HTMLElement

    const overlay = div({ class: 'modal-backdrop__overlay', onclick: closeModal }) as HTMLElement

    const dialog = div({ class: 'modal' }) as HTMLElement
    dialog.appendChild(tags.h3({ class: 'modal__title' }, 'Add a Forum') as HTMLElement)
    dialog.appendChild(p({ class: 'modal__subtitle' }, 'Enter the URL of a Forumline-compatible forum') as HTMLElement)

    const input = createInput({ type: 'url', placeholder: 'https://example-forum.com', value: addUrl, autofocus: true })
    input.className = 'input modal__input'
    input.addEventListener('input', () => {
      addUrl = input.value
      submitBtn.disabled = adding || !addUrl.trim()
    })
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleAdd()
      if (e.key === 'Escape') closeModal()
    })
    dialog.appendChild(input)

    if (addError) {
      dialog.appendChild(p({ class: 'text-sm text-error mt-sm' }, addError) as HTMLElement)
    }

    const actions = div({ class: 'modal__actions' }) as HTMLElement
    actions.appendChild(createButton({ text: 'Cancel', variant: 'ghost', onClick: closeModal }))
    const submitBtn = createButton({
      text: adding ? 'Adding...' : 'Add Forum',
      variant: 'primary',
      disabled: adding || !addUrl.trim(),
      onClick: handleAdd,
    })
    actions.appendChild(submitBtn)
    dialog.appendChild(actions)

    modalEl.append(overlay, dialog)
    document.body.appendChild(modalEl)
  }

  async function handleAdd() {
    if (!addUrl.trim() || adding) return
    adding = true
    addError = null
    showModal()
    try {
      await forumStore.addForum(addUrl.trim())
      closeModal()
    } catch (err) {
      addError = String(err)
      adding = false
      showModal()
    }
  }

  function closeModal() {
    addUrl = ''
    addError = null
    adding = false
    modalEl?.remove()
    modalEl = null
  }

  return {
    el,
    destroy() {
      closeModal()
    },
  }
}
