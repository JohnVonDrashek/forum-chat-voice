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
import { tags, html, state, add } from '../shared/dom.js'
import { reactive, list, replace, noreactive } from 'vanjs-ext'

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

  // Local reactive state for DM unread badge and add-forum modal
  const dmUnread = state(opts.dmUnreadCount ?? 0)

  const modal = reactive({
    show: false,
    url: '',
    adding: false,
    error: null as string | null,
  })

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

  // Per-item reactive state so individual forum buttons update independently
  const activeDomain = state<string | null>(forumStore.state.val.activeForum?.domain ?? null)
  const unreadMap = state<Record<string, UnreadCounts>>(forumStore.state.val.unreadCounts)

  // Reactive keyed object for the forum list — domain is the key
  const forumsMap = reactive<Record<string, ForumMembership>>({})

  // Seed initial forums
  {
    const initial: Record<string, ForumMembership> = {}
    for (const f of forumStore.state.val.forums) {
      initial[f.domain] = noreactive(f)
    }
    replace(forumsMap, initial)
  }

  // Sync reactive proxies when the store changes
  const unsub = forumStore.subscribe((s) => {
    activeDomain.val = s.activeForum?.domain ?? null
    unreadMap.val = s.unreadCounts

    const keyed: Record<string, ForumMembership> = {}
    for (const f of s.forums) {
      keyed[f.domain] = noreactive(f)
    }
    replace(forumsMap, keyed)
  })

  // vanX.list renders each forum once; adds/removes touch only that DOM node
  const forumsContainer = list(
    div({ style: 'display:contents' }),
    forumsMap,
    (v, _deleter, domain) => {
      const forum = v.val as ForumMembership
      return createForumButton(forum, domain)
    },
  ) as HTMLElement
  rail.appendChild(forumsContainer)

  // Add forum button
  const addBtn = button(
    { class: 'forum-rail__icon forum-rail__icon--add', title: 'Add a forum', onclick: () => { modal.show = true } },
    html(`<svg class="icon-md" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"/></svg>`),
  ) as HTMLButtonElement
  rail.appendChild(addBtn)

  // Spacer
  rail.appendChild(div({ class: 'forum-rail__spacer' }) as HTMLElement)

  // DM button with reactive badge
  if (onDmClick) {
    const dmBtn = button(
      { class: 'forum-rail__icon forum-rail__icon--bottom', title: 'Direct Messages', onclick: onDmClick },
      html(`<svg class="icon-md" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/></svg>`),
      () => dmUnread.val > 0
        ? div({ class: 'badge badge--red' }, dmUnread.val > 99 ? '99+' : String(dmUnread.val))
        : document.createTextNode(''),
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

  function createForumButton(forum: ForumMembership, domain: string): HTMLElement {
    const btn = button(
      {
        class: () => `forum-rail__icon${activeDomain.val === domain ? ' forum-rail__icon--active' : ''}`,
        title: forum.name,
        onclick: () => forumStore.switchForum(domain),
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

    // Reactive active indicator — appears/disappears without rebuilding the button
    add(btn, () => activeDomain.val === domain
      ? div({ class: 'forum-rail__active-indicator' })
      : document.createTextNode(''),
    )

    // Reactive unread badge — updates independently per forum
    add(btn, () => {
      const unread = totalUnread(unreadMap.val[domain])
      return unread > 0
        ? div({ class: 'badge badge--red' }, unread > 99 ? '99+' : String(unread))
        : document.createTextNode('')
    })

    return btn
  }

  async function handleAdd() {
    if (!modal.url.trim() || modal.adding) return
    modal.adding = true
    modal.error = null
    try {
      await forumStore.addForum(modal.url.trim())
      closeModal()
    } catch (err) {
      modal.error = String(err)
      modal.adding = false
    }
  }

  function closeModal() {
    modal.show = false
    modal.url = ''
    modal.error = null
    modal.adding = false
  }

  // Reactive modal — visibility and content driven by modal reactive object
  const modalInput = inputTag({
    type: 'url',
    class: 'input modal__input',
    placeholder: 'https://example-forum.com',
    autofocus: true,
    disabled: () => modal.adding,
    oninput: (e: Event) => { modal.url = (e.target as HTMLInputElement).value },
    onkeydown: (e: KeyboardEvent) => {
      if (e.key === 'Enter') handleAdd()
      if (e.key === 'Escape') closeModal()
    },
  }) as HTMLInputElement

  const modalEl = div(
    { class: 'modal-backdrop', style: () => `display:${modal.show ? '' : 'none'}` },
    div({ class: 'modal-backdrop__overlay', onclick: closeModal }),
    div(
      { class: 'modal' },
      h3({ class: 'modal__title' }, 'Add a Forum'),
      p({ class: 'modal__subtitle' }, 'Enter the URL of a Forumline-compatible forum'),
      modalInput,
      () => modal.error
        ? p({ class: 'text-error mt-sm' }, modal.error)
        : document.createTextNode(''),
      div(
        { class: 'modal__actions' },
        button({ class: 'btn btn--ghost', onclick: closeModal }, 'Cancel'),
        button(
          {
            class: 'btn btn--primary',
            disabled: () => modal.adding || !modal.url.trim(),
            onclick: handleAdd,
          },
          () => modal.adding ? 'Adding...' : 'Add Forum',
        ),
      ),
    ),
  ) as HTMLElement
  document.body.appendChild(modalEl)

  return {
    el: rail,
    destroy() {
      unsub()
      closeModal()
      modalEl.remove()
      rail.remove()
    },
    setDmUnreadCount(count: number) {
      dmUnread.val = count
    },
  }
}
