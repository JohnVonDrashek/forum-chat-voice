/*
 * Forum sidebar rail (Van.js)
 *
 * This file renders the vertical icon sidebar for navigating between forums on wider screens.
 *
 * It must:
 * - Display a home button that deselects the active forum
 * - Show icon buttons for each connected forum with the forum's icon or first-letter fallback
 * - Highlight the currently active forum with a visual indicator
 * - Display unread count badges (notifications + chat mentions + DMs) on each forum icon
 * - Provide an "Add Forum" button that opens a modal to add a forum by URL
 * - Show a DM button at the bottom with an unread badge for cross-forum direct messages
 * - Show a Settings button at the bottom
 * - Switch to the clicked forum when a forum icon is tapped
 * - Reactively update icons, badges, and active states when store state changes
 */
import type { ForumStore, ForumMembership } from './forum-store.js'
import type { UnreadCounts } from '@johnvondrashek/forumline-protocol'
import { tags, html, state } from '../shared/dom.js'

const { div, p, button, img: imgTag, h3, input: inputTag } = tags

export interface ForumRailOptions {
  forumStore: ForumStore
  onDmClick?: () => void
  onSettingsClick?: () => void
  dmUnreadCount?: number
}

export interface ForumRailInstance {
  el: HTMLElement
  destroy: () => void
  setDmUnreadCount: (count: number) => void
}

function totalUnread(counts: UnreadCounts | undefined): number {
  if (!counts) return 0
  return counts.notifications + counts.chat_mentions + counts.dms
}

export function createForumRail(opts: ForumRailOptions): ForumRailInstance {
  const { forumStore, onDmClick, onSettingsClick } = opts
  let dmUnreadCount = opts.dmUnreadCount ?? 0

  const showAddModal = state(false)
  const addUrl = state('')
  const adding = state(false)
  const addError = state<string | null>(null)

  const rail = div({ class: 'forum-rail' }) as HTMLElement

  // Home button — active state is reactive
  const homeBtn = button(
    {
      class: () => `forum-rail__icon${forumStore.state.val.activeForum === null ? ' forum-rail__icon--active' : ''}`,
      title: 'Home',
      onclick: () => forumStore.goHome(),
    },
    html(`<svg class="icon-md" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>`),
  ) as HTMLButtonElement
  rail.appendChild(homeBtn)

  // Divider — visibility reactive on whether forums exist
  const dividerEl = div({
    class: 'forum-rail__divider',
    style: () => `display:${forumStore.state.val.forums.length > 0 ? '' : 'none'}`,
  }) as HTMLElement
  rail.appendChild(dividerEl)

  // Reactive forum list — rebuilds when forums, activeForum, or unreadCounts change
  const forumsContainer = div(
    { style: 'display:contents' },
    () => {
      const { forums, activeForum, unreadCounts } = forumStore.state.val
      const activeDomain = activeForum?.domain ?? null
      const wrapper = div({ style: 'display:contents' })
      for (const forum of forums) {
        const unread = totalUnread(unreadCounts[forum.domain])
        const isActive = forum.domain === activeDomain
        wrapper.appendChild(createForumButton(forum, isActive, unread))
      }
      return wrapper
    },
  ) as HTMLElement
  rail.appendChild(forumsContainer)

  // Add forum button
  const addBtn = button(
    { class: 'forum-rail__icon forum-rail__icon--add', title: 'Add a forum', onclick: () => { showAddModal.val = true } },
    html(`<svg class="icon-md" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"/></svg>`),
  ) as HTMLButtonElement
  rail.appendChild(addBtn)

  // Spacer
  rail.appendChild(div({ class: 'forum-rail__spacer' }) as HTMLElement)

  // DM button
  let dmBtn: HTMLElement | null = null
  let dmBadgeEl: HTMLElement | null = null
  if (onDmClick) {
    dmBtn = button(
      { class: 'forum-rail__icon forum-rail__icon--bottom', title: 'Direct Messages', onclick: onDmClick },
      html(`<svg class="icon-md" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/></svg>`),
    ) as HTMLElement
    rail.appendChild(dmBtn)
  }

  // Settings button
  const settingsBtn = button(
    {
      class: 'forum-rail__icon forum-rail__icon--bottom',
      title: 'Settings',
      onclick: () => {
        if (onSettingsClick) {
          onSettingsClick()
        } else {
          forumStore.goHome()
          window.location.hash = '/settings'
        }
      },
    },
    html(`<svg class="icon-md" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg>`),
  ) as HTMLButtonElement
  rail.appendChild(settingsBtn)

  function updateDmBadge() {
    if (!dmBtn) return
    if (dmUnreadCount > 0) {
      if (!dmBadgeEl) {
        dmBadgeEl = div({ class: 'badge badge--red' }) as HTMLElement
        dmBtn.appendChild(dmBadgeEl)
      }
      dmBadgeEl.textContent = dmUnreadCount > 99 ? '99+' : String(dmUnreadCount)
    } else if (dmBadgeEl) {
      dmBadgeEl.remove()
      dmBadgeEl = null
    }
  }

  function createForumButton(forum: ForumMembership, isActive: boolean, unread: number): HTMLElement {
    const btn = button(
      {
        class: `forum-rail__icon${isActive ? ' forum-rail__icon--active' : ''}`,
        title: forum.name,
        onclick: () => forumStore.switchForum(forum.domain),
      },
    ) as HTMLButtonElement

    if (forum.icon_url) {
      const iconSrc = forum.icon_url.startsWith('/') ? `${forum.web_base}${forum.icon_url}` : forum.icon_url
      const img = imgTag({
        src: iconSrc,
        alt: forum.name,
        class: 'forum-rail__forum-img',
        onerror: () => {
          img.style.display = 'none'
          btn.textContent = forum.name[0].toUpperCase()
          btn.classList.add('forum-rail__icon--text')
        },
      }) as HTMLImageElement
      btn.appendChild(img)
    } else {
      btn.textContent = forum.name[0].toUpperCase()
      btn.classList.add('forum-rail__icon--text')
    }

    if (isActive) {
      btn.appendChild(div({ class: 'forum-rail__active-indicator' }) as HTMLElement)
    }

    if (unread > 0) {
      btn.appendChild(div({ class: 'badge badge--red' }, unread > 99 ? '99+' : String(unread)) as HTMLElement)
    }

    return btn
  }

  async function handleAdd() {
    if (!addUrl.val.trim() || adding.val) return
    adding.val = true
    addError.val = null
    try {
      await forumStore.addForum(addUrl.val.trim())
      closeModal()
    } catch (err) {
      addError.val = String(err)
      adding.val = false
    }
  }

  function closeModal() {
    showAddModal.val = false
    addUrl.val = ''
    addError.val = null
    adding.val = false
  }

  // Reactive modal — appended once, visibility driven by showAddModal state
  const modalInput = inputTag({
    type: 'url',
    class: 'input modal__input',
    placeholder: 'https://example-forum.com',
    autofocus: true,
    disabled: () => adding.val,
    oninput: (e: Event) => { addUrl.val = (e.target as HTMLInputElement).value },
    onkeydown: (e: KeyboardEvent) => {
      if (e.key === 'Enter') handleAdd()
      if (e.key === 'Escape') closeModal()
    },
  }) as HTMLInputElement

  const modalEl = div(
    { class: 'modal-backdrop', style: () => `display:${showAddModal.val ? '' : 'none'}` },
    div({ class: 'modal-backdrop__overlay', onclick: closeModal }),
    div(
      { class: 'modal' },
      h3({ class: 'modal__title' }, 'Add a Forum'),
      p({ class: 'modal__subtitle' }, 'Enter the URL of a Forumline-compatible forum'),
      modalInput,
      () => addError.val
        ? p({ class: 'text-error mt-sm' }, addError.val)
        : document.createTextNode(''),
      div(
        { class: 'modal__actions' },
        button({ class: 'btn btn--ghost', onclick: closeModal }, 'Cancel'),
        button(
          {
            class: 'btn btn--primary',
            disabled: () => adding.val || !addUrl.val.trim(),
            onclick: handleAdd,
          },
          () => adding.val ? 'Adding...' : 'Add Forum',
        ),
      ),
    ),
  ) as HTMLElement
  document.body.appendChild(modalEl)

  return {
    el: rail,
    destroy() {
      closeModal()
      modalEl.remove()
      rail.remove()
    },
    setDmUnreadCount(count: number) {
      if (dmUnreadCount === count) return
      dmUnreadCount = count
      updateDmBadge()
    },
  }
}
