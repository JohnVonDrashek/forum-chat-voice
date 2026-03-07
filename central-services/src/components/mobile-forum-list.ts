import type { ForumStore } from '@johnvondrashek/forumline-core'
import type { ForumMembership } from '@johnvondrashek/forumline-core'
import { createButton, createInput } from './ui.js'

interface MobileForumListOptions {
  forumStore: ForumStore
}

export function createMobileForumList({ forumStore }: MobileForumListOptions) {
  const el = document.createElement('div')
  let modalEl: HTMLElement | null = null
  let addUrl = ''
  let adding = false
  let addError: string | null = null

  // Persistent DOM
  const h2 = document.createElement('h2')
  h2.className = 'text-sm font-semibold uppercase tracking-wider text-muted'
  h2.style.marginBottom = '0.75rem'
  h2.textContent = 'Your Forums'
  el.appendChild(h2)

  const list = document.createElement('div')
  list.style.display = 'flex'
  list.style.flexDirection = 'column'
  list.style.gap = '0.5rem'
  el.appendChild(list)

  const addBtn = document.createElement('button')
  addBtn.className = 'add-forum-btn'
  addBtn.innerHTML = `<svg class="icon-sm" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"/></svg> Add Forum`
  addBtn.addEventListener('click', () => showModal())
  el.appendChild(addBtn)

  // Track forum card elements
  const forumCards = new Map<string, {
    btn: HTMLElement
    badgeEl: HTMLElement | null
    lastUnread: number
    lastActive: boolean
  }>()

  let prevForums: ForumMembership[] = []

  function createForumCard(forum: ForumMembership, isActive: boolean, unread: number) {
    const btn = document.createElement('button')
    btn.className = `forum-card${isActive ? ' forum-card--active' : ''}`

    // Icon
    if (forum.icon_url) {
      const iconSrc = forum.icon_url.startsWith('/') ? `${forum.web_base}${forum.icon_url}` : forum.icon_url
      const img = document.createElement('img')
      img.src = iconSrc
      img.alt = forum.name
      img.className = 'forum-card__icon'
      img.addEventListener('error', () => { img.style.display = 'none' })
      btn.appendChild(img)
    } else {
      const fallback = document.createElement('div')
      fallback.className = 'forum-card__icon-fallback'
      fallback.textContent = forum.name[0].toUpperCase()
      btn.appendChild(fallback)
    }

    // Text
    const textDiv = document.createElement('div')
    textDiv.className = 'flex-1'
    textDiv.style.textAlign = 'left'
    const name = document.createElement('p')
    name.className = 'font-medium text-white'
    name.textContent = forum.name
    const domain = document.createElement('p')
    domain.className = 'text-xs text-muted'
    domain.textContent = forum.domain
    textDiv.append(name, domain)
    btn.appendChild(textDiv)

    // Unread badge
    let badgeEl: HTMLElement | null = null
    if (unread > 0) {
      badgeEl = document.createElement('div')
      badgeEl.className = 'badge badge--red badge--inline'
      badgeEl.style.position = 'static'
      badgeEl.textContent = unread > 99 ? '99+' : String(unread)
      btn.appendChild(badgeEl)
    }

    btn.addEventListener('click', () => forumStore.switchForum(forum.domain))

    forumCards.set(forum.domain, { btn, badgeEl, lastUnread: unread, lastActive: isActive })
    return btn
  }

  function render() {
    const state = forumStore.get()
    const forumsChanged = state.forums !== prevForums

    if (forumsChanged) {
      const currentDomains = new Set(state.forums.map(f => f.domain))

      // Remove stale
      for (const [domain, entry] of forumCards) {
        if (!currentDomains.has(domain)) {
          entry.btn.remove()
          forumCards.delete(domain)
        }
      }

      // Add/reorder
      for (const forum of state.forums) {
        const counts = state.unreadCounts[forum.domain]
        const unread = counts ? counts.notifications + counts.chat_mentions + counts.dms : 0
        const isActive = state.activeForum?.domain === forum.domain

        if (!forumCards.has(forum.domain)) {
          createForumCard(forum, isActive, unread)
        }
        list.appendChild(forumCards.get(forum.domain)!.btn)
      }

      prevForums = state.forums
    }

    // Update badges and active states
    for (const forum of state.forums) {
      const entry = forumCards.get(forum.domain)
      if (!entry) continue

      const counts = state.unreadCounts[forum.domain]
      const unread = counts ? counts.notifications + counts.chat_mentions + counts.dms : 0
      const isActive = state.activeForum?.domain === forum.domain

      if (entry.lastActive !== isActive) {
        if (isActive) {
          entry.btn.classList.add('forum-card--active')
        } else {
          entry.btn.classList.remove('forum-card--active')
        }
        entry.lastActive = isActive
      }

      if (entry.lastUnread !== unread) {
        if (unread > 0) {
          if (entry.badgeEl) {
            entry.badgeEl.textContent = unread > 99 ? '99+' : String(unread)
          } else {
            entry.badgeEl = document.createElement('div')
            entry.badgeEl.className = 'badge badge--red badge--inline'
            entry.badgeEl.style.position = 'static'
            entry.badgeEl.textContent = unread > 99 ? '99+' : String(unread)
            entry.btn.appendChild(entry.badgeEl)
          }
        } else if (entry.badgeEl) {
          entry.badgeEl.remove()
          entry.badgeEl = null
        }
        entry.lastUnread = unread
      }
    }
  }

  function showModal() {
    modalEl?.remove()
    modalEl = document.createElement('div')
    modalEl.className = 'modal-backdrop'

    const overlay = document.createElement('div')
    overlay.className = 'modal-backdrop__overlay'
    overlay.addEventListener('click', closeModal)

    const dialog = document.createElement('div')
    dialog.className = 'modal'

    const title = document.createElement('h3')
    title.className = 'modal__title'
    title.textContent = 'Add a Forum'
    dialog.appendChild(title)

    const subtitle = document.createElement('p')
    subtitle.className = 'modal__subtitle'
    subtitle.textContent = 'Enter the URL of a Forumline-compatible forum'
    dialog.appendChild(subtitle)

    const input = createInput({ type: 'url', placeholder: 'https://example-forum.com', value: addUrl, autofocus: true })
    input.className = 'input modal__input'
    input.addEventListener('input', () => {
      addUrl = input.value
      addBtn.disabled = adding || !addUrl.trim()
    })
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleAdd()
      if (e.key === 'Escape') closeModal()
    })
    dialog.appendChild(input)

    if (addError) {
      const err = document.createElement('p')
      err.className = 'text-sm text-error mt-sm'
      err.textContent = addError
      dialog.appendChild(err)
    }

    const actions = document.createElement('div')
    actions.className = 'modal__actions'
    actions.appendChild(createButton({ text: 'Cancel', variant: 'ghost', onClick: closeModal }))
    const addBtn = createButton({
      text: adding ? 'Adding...' : 'Add Forum',
      variant: 'primary',
      disabled: adding || !addUrl.trim(),
      onClick: handleAdd,
    }) as HTMLButtonElement
    actions.appendChild(addBtn)
    dialog.appendChild(actions)

    modalEl.append(overlay, dialog)
    document.body.appendChild(modalEl)
  }

  async function handleAdd() {
    if (!addUrl.trim() || adding) return
    adding = true
    addError = null
    showModal() // re-render modal
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

  const unsub = forumStore.subscribe(() => render())
  render()

  return {
    el,
    destroy() {
      unsub()
      closeModal()
    },
  }
}
