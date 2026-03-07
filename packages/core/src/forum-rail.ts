import type { ForumStore, ForumMembership } from './forum-store.js'
import type { UnreadCounts } from '@johnvondrashek/forumline-protocol'

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

  const rail = document.createElement('div')
  rail.className = 'forum-rail'

  // State for add modal
  let showAddModal = false
  let addUrl = ''
  let adding = false
  let addError: string | null = null
  let modalEl: HTMLElement | null = null

  // ---- Persistent elements ----
  const homeBtn = document.createElement('button')
  homeBtn.title = 'Home'
  homeBtn.innerHTML = `<svg class="icon-md" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>`
  homeBtn.addEventListener('click', () => forumStore.goHome())
  rail.appendChild(homeBtn)

  const divider = document.createElement('div')
  divider.className = 'forum-rail__divider'
  rail.appendChild(divider)

  // Forum buttons container
  const forumsContainer = document.createElement('div')
  forumsContainer.style.display = 'contents'
  rail.appendChild(forumsContainer)

  // Add forum button
  const addBtn = document.createElement('button')
  addBtn.className = 'forum-rail__icon forum-rail__icon--add'
  addBtn.title = 'Add a forum'
  addBtn.innerHTML = `<svg class="icon-md" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"/></svg>`
  addBtn.addEventListener('click', () => {
    showAddModal = true
    renderModal()
  })
  rail.appendChild(addBtn)

  // Spacer
  const spacer = document.createElement('div')
  spacer.className = 'forum-rail__spacer'
  rail.appendChild(spacer)

  // DM button
  let dmBtn: HTMLElement | null = null
  let dmBadgeEl: HTMLElement | null = null
  if (onDmClick) {
    dmBtn = document.createElement('button')
    dmBtn.className = 'forum-rail__icon forum-rail__icon--bottom'
    dmBtn.title = 'Direct Messages'
    dmBtn.innerHTML = `<svg class="icon-md" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/></svg>`
    dmBtn.addEventListener('click', onDmClick)
    rail.appendChild(dmBtn)
  }

  // Settings button
  const settingsBtn = document.createElement('button')
  settingsBtn.className = 'forum-rail__icon forum-rail__icon--bottom'
  settingsBtn.title = 'Settings'
  settingsBtn.innerHTML = `<svg class="icon-md" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg>`
  settingsBtn.addEventListener('click', () => {
    if (onSettingsClick) {
      onSettingsClick()
    } else {
      forumStore.goHome()
      window.location.hash = '/settings'
    }
  })
  rail.appendChild(settingsBtn)

  // Track forum button elements
  const forumBtns = new Map<string, {
    btn: HTMLElement
    badgeEl: HTMLElement | null
    indicatorEl: HTMLElement | null
    lastUnread: number
    lastActive: boolean
  }>()

  // Snapshot for diffing
  let prevForums: ForumMembership[] = []
  let prevUnreadCounts: Record<string, UnreadCounts> = {}
  let prevActiveDomain: string | null = null

  function updateDmBadge() {
    if (!dmBtn) return
    if (dmUnreadCount > 0) {
      if (!dmBadgeEl) {
        dmBadgeEl = document.createElement('div')
        dmBadgeEl.className = 'badge badge--red'
        dmBtn.appendChild(dmBadgeEl)
      }
      dmBadgeEl.textContent = dmUnreadCount > 99 ? '99+' : String(dmUnreadCount)
    } else if (dmBadgeEl) {
      dmBadgeEl.remove()
      dmBadgeEl = null
    }
  }

  function createForumButton(forum: ForumMembership, isActive: boolean, unread: number) {
    const btn = document.createElement('button')
    btn.className = `forum-rail__icon${isActive ? ' forum-rail__icon--active' : ''}`
    btn.title = forum.name

    if (forum.icon_url) {
      const iconSrc = forum.icon_url.startsWith('/') ? `${forum.web_base}${forum.icon_url}` : forum.icon_url
      const img = document.createElement('img')
      img.src = iconSrc
      img.alt = forum.name
      img.className = 'forum-rail__forum-img'
      img.addEventListener('error', () => {
        img.style.display = 'none'
        btn.textContent = forum.name[0].toUpperCase()
        btn.classList.add('forum-rail__icon--text')
      })
      btn.appendChild(img)
    } else {
      btn.textContent = forum.name[0].toUpperCase()
      btn.classList.add('forum-rail__icon--text')
    }

    let indicatorEl: HTMLElement | null = null
    if (isActive) {
      indicatorEl = document.createElement('div')
      indicatorEl.className = 'forum-rail__active-indicator'
      btn.appendChild(indicatorEl)
    }

    let badgeEl: HTMLElement | null = null
    if (unread > 0) {
      badgeEl = document.createElement('div')
      badgeEl.className = 'badge badge--red'
      badgeEl.textContent = unread > 99 ? '99+' : String(unread)
      btn.appendChild(badgeEl)
    }

    btn.addEventListener('click', () => forumStore.switchForum(forum.domain))

    forumBtns.set(forum.domain, { btn, badgeEl, indicatorEl, lastUnread: unread, lastActive: isActive })
    return btn
  }

  function render() {
    const state = forumStore.get()
    const activeDomain = state.activeForum?.domain ?? null

    // Update home button active state
    homeBtn.className = `forum-rail__icon${activeDomain === null ? ' forum-rail__icon--active' : ''}`

    // Show/hide divider
    divider.style.display = state.forums.length > 0 ? '' : 'none'

    // Check if forums list changed (add/remove/reorder)
    const forumsChanged = state.forums !== prevForums

    if (forumsChanged) {
      // Rebuild forum buttons
      const currentDomains = new Set(state.forums.map(f => f.domain))

      // Remove stale
      for (const [domain, entry] of forumBtns) {
        if (!currentDomains.has(domain)) {
          entry.btn.remove()
          forumBtns.delete(domain)
        }
      }

      // Add/reorder
      forumsContainer.innerHTML = ''
      for (const forum of state.forums) {
        const unread = totalUnread(state.unreadCounts[forum.domain])
        const isActive = forum.domain === activeDomain
        const existing = forumBtns.get(forum.domain)
        if (existing) {
          forumsContainer.appendChild(existing.btn)
        } else {
          const btn = createForumButton(forum, isActive, unread)
          forumsContainer.appendChild(btn)
        }
      }

      prevForums = state.forums
    }

    // Update badges and active states for existing buttons
    for (const forum of state.forums) {
      const entry = forumBtns.get(forum.domain)
      if (!entry) continue

      const unread = totalUnread(state.unreadCounts[forum.domain])
      const isActive = forum.domain === activeDomain

      // Update active state
      if (entry.lastActive !== isActive) {
        if (isActive) {
          entry.btn.classList.add('forum-rail__icon--active')
          if (!entry.indicatorEl) {
            entry.indicatorEl = document.createElement('div')
            entry.indicatorEl.className = 'forum-rail__active-indicator'
            entry.btn.appendChild(entry.indicatorEl)
          }
        } else {
          entry.btn.classList.remove('forum-rail__icon--active')
          if (entry.indicatorEl) {
            entry.indicatorEl.remove()
            entry.indicatorEl = null
          }
        }
        entry.lastActive = isActive
      }

      // Update badge
      if (entry.lastUnread !== unread) {
        if (unread > 0) {
          if (entry.badgeEl) {
            entry.badgeEl.textContent = unread > 99 ? '99+' : String(unread)
          } else {
            entry.badgeEl = document.createElement('div')
            entry.badgeEl.className = 'badge badge--red'
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

    prevActiveDomain = activeDomain
    prevUnreadCounts = state.unreadCounts
    updateDmBadge()
  }

  function renderModal() {
    // Remove existing modal
    modalEl?.remove()
    modalEl = null

    if (!showAddModal) return

    modalEl = document.createElement('div')
    modalEl.className = 'modal-backdrop'

    const overlay = document.createElement('div')
    overlay.className = 'modal-backdrop__overlay'
    overlay.addEventListener('click', closeModal)

    const dialog = document.createElement('div')
    dialog.className = 'modal'
    dialog.innerHTML = `
      <h3 class="modal__title">Add a Forum</h3>
      <p class="modal__subtitle">Enter the URL of a Forumline-compatible forum</p>
      <input type="url" class="input modal__input" placeholder="https://example-forum.com" autofocus />
      ${addError ? `<p class="text-error mt-sm">${addError}</p>` : ''}
      <div class="modal__actions">
        <button class="btn btn--ghost">Cancel</button>
        <button class="btn btn--primary"${adding || !addUrl.trim() ? ' disabled' : ''}>
          ${adding ? 'Adding...' : 'Add Forum'}
        </button>
      </div>
    `

    const input = dialog.querySelector('input')!
    input.value = addUrl
    const addBtn = dialog.querySelectorAll('button')[1] as HTMLButtonElement
    input.addEventListener('input', (e) => {
      addUrl = (e.target as HTMLInputElement).value
      addBtn.disabled = adding || !addUrl.trim()
    })
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleAdd()
      if (e.key === 'Escape') closeModal()
    })

    const buttons = dialog.querySelectorAll('button')
    buttons[0].addEventListener('click', closeModal)
    addBtn.addEventListener('click', handleAdd)

    modalEl.append(overlay, dialog)
    document.body.appendChild(modalEl)
  }

  async function handleAdd() {
    if (!addUrl.trim() || adding) return
    adding = true
    addError = null
    renderModal()
    try {
      await forumStore.addForum(addUrl.trim())
      closeModal()
    } catch (err) {
      addError = String(err)
      adding = false
      renderModal()
    }
  }

  function closeModal() {
    showAddModal = false
    addUrl = ''
    addError = null
    adding = false
    modalEl?.remove()
    modalEl = null
  }

  const unsub = forumStore.subscribe(() => render())
  render()

  return {
    el: rail,
    destroy() {
      unsub()
      closeModal()
      rail.remove()
    },
    setDmUnreadCount(count: number) {
      if (dmUnreadCount === count) return
      dmUnreadCount = count
      updateDmBadge()
    },
  }
}
