import type { GoTrueAuthClient, ForumlineSession } from '../lib/gotrue-auth.js'
import type { ForumStore, ForumlineStore } from '../lib/index.js'
import { createForumlineAuth } from './forumline-auth.js'
import { createSiteManager } from './site-manager.js'
import { createAvatar, createButton, createCard } from './ui.js'

interface SettingsPageOptions {
  forumlineSession: ForumlineSession | null
  forumStore: ForumStore
  forumlineStore: ForumlineStore
  auth: GoTrueAuthClient
  onClose: () => void
}

export function createSettingsPage({ forumlineSession, forumStore, forumlineStore, auth, onClose }: SettingsPageOptions) {
  let memberships: { forum_domain: string; notifications_muted: boolean }[] = []
  let removingDomain: string | null = null
  let avatarUrl: string | null = null
  let siteManagerChild: { el: HTMLElement; destroy: () => void } | null = null
  let ownedSites: Map<string, string> = new Map() // domain -> slug

  const el = document.createElement('div')
  el.className = 'page-scroll'

  // Wrapper for the main settings content (hidden when site manager is open)
  const settingsWrapper = document.createElement('div')

  // ---- Persistent DOM structure ----
  // Header
  const header = document.createElement('div')
  header.className = 'settings-header'
  const backBtn = document.createElement('button')
  backBtn.className = 'btn--icon'
  backBtn.innerHTML = `<svg class="icon-sm" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/></svg>`
  backBtn.addEventListener('click', onClose)
  header.appendChild(backBtn)
  const title = document.createElement('h1')
  title.className = 'text-xl font-bold text-white'
  title.textContent = 'Settings'
  header.appendChild(title)
  settingsWrapper.appendChild(header)

  // Content
  const content = document.createElement('div')
  content.className = 'page-content'
  settingsWrapper.appendChild(content)
  el.appendChild(settingsWrapper)

  function openSiteManager(forum: { name: string; domain: string }) {
    const slug = ownedSites.get(forum.domain)
    if (!slug) return
    settingsWrapper.style.display = 'none'
    siteManagerChild?.destroy()
    siteManagerChild = createSiteManager({
      slug,
      forumName: forum.name,
      domain: forum.domain,
      auth,
      onClose: () => {
        siteManagerChild?.el.remove()
        siteManagerChild?.destroy()
        siteManagerChild = null
        settingsWrapper.style.display = ''
      },
    })
    el.appendChild(siteManagerChild.el)
  }

  // Forumline account card
  const accountCard = createCard()
  const accountTitle = document.createElement('h2')
  accountTitle.className = 'text-lg font-semibold text-white'
  accountTitle.textContent = 'Forumline'
  accountCard.appendChild(accountTitle)
  const accountSub = document.createElement('p')
  accountSub.className = 'text-sm text-muted mt-sm'
  accountSub.textContent = 'Connect to the Forumline for cross-forum direct messages'
  accountCard.appendChild(accountSub)

  // Forumline profile/auth area (rendered once based on session state)
  const accountContentArea = document.createElement('div')
  accountContentArea.className = 'mt-lg'
  accountCard.appendChild(accountContentArea)
  content.appendChild(accountCard)

  function renderHubContent() {
    accountContentArea.innerHTML = ''
    const { isForumlineConnected } = forumlineStore.get()
    if (isForumlineConnected && forumlineSession) {
      const profileRow = document.createElement('div')
      profileRow.className = 'settings-profile-row'
      profileRow.appendChild(createAvatar({
        avatarUrl,
        seed: forumlineSession.user.user_metadata?.username as string || forumlineSession.user.email || undefined,
        size: 40,
      }))
      const info = document.createElement('div')
      info.className = 'flex-1'
      const name = document.createElement('p')
      name.className = 'font-medium text-white'
      name.textContent = (forumlineSession.user.user_metadata?.username as string) || forumlineSession.user.email || ''
      const emailEl = document.createElement('p')
      emailEl.className = 'text-sm text-muted'
      emailEl.textContent = forumlineSession.user.email || ''
      info.append(name, emailEl)
      profileRow.appendChild(info)
      profileRow.appendChild(createButton({
        text: 'Sign Out',
        variant: 'secondary',
        onClick: () => auth.signOut(),
      }))
      accountContentArea.appendChild(profileRow)
    } else {
      const { el: authEl } = createForumlineAuth({ auth })
      accountContentArea.appendChild(authEl)
    }
  }

  // Forums card
  const forumsCard = createCard()
  const forumsTitle = document.createElement('h2')
  forumsTitle.className = 'text-lg font-semibold text-white'
  forumsTitle.textContent = 'Forums'
  forumsCard.appendChild(forumsTitle)
  const forumsSub = document.createElement('p')
  forumsSub.className = 'text-sm text-muted mt-sm'
  forumsSub.textContent = 'Manage your connected forums'
  forumsCard.appendChild(forumsSub)

  // Forum list container
  const forumListContainer = document.createElement('div')
  forumListContainer.style.display = 'flex'
  forumListContainer.style.flexDirection = 'column'
  forumListContainer.style.gap = '0.5rem'
  forumListContainer.style.marginTop = '1rem'
  forumsCard.appendChild(forumListContainer)

  const forumsEmptyEl = document.createElement('p')
  forumsEmptyEl.className = 'text-sm text-faint mt-lg'
  forumsEmptyEl.textContent = 'No forums added yet. Go to Home and tap Add Forum to add one.'

  content.appendChild(forumsCard)

  // Track forum row elements
  const forumRows = new Map<string, {
    row: HTMLElement
    muteBtn: HTMLElement
    removeBtn: HTMLElement
  }>()

  function isMuted(domain: string): boolean {
    return memberships.find((m) => m.forum_domain === domain)?.notifications_muted ?? false
  }

  function createForumRow(forum: { name: string; domain: string; icon_url?: string; web_base: string }) {
    const row = document.createElement('div')
    row.className = 'settings-forum-row'

    // Icon
    if (forum.icon_url) {
      const iconSrc = forum.icon_url.startsWith('/') ? `${forum.web_base}${forum.icon_url}` : forum.icon_url
      const img = document.createElement('img')
      img.src = iconSrc
      img.alt = forum.name
      img.className = 'forum-card__icon'
      img.addEventListener('error', () => { img.style.display = 'none' })
      row.appendChild(img)
    } else {
      const fallback = document.createElement('div')
      fallback.className = 'forum-card__icon-fallback'
      fallback.textContent = forum.name[0].toUpperCase()
      row.appendChild(fallback)
    }

    // Info
    const info = document.createElement('div')
    info.className = 'flex-1'
    const name = document.createElement('p')
    name.className = 'font-medium text-white'
    name.textContent = forum.name
    const domain = document.createElement('p')
    domain.className = 'text-sm text-muted'
    domain.textContent = forum.domain
    info.append(name, domain)
    row.appendChild(info)

    // Edit Site button (only for forums the user owns on the hosted platform)
    if (ownedSites.has(forum.domain)) {
      row.appendChild(createButton({
        text: 'Edit Site',
        variant: 'ghost',
        className: 'text-sm',
        onClick: () => openSiteManager(forum),
      }))
    }

    // Mute button
    const muteBtn = document.createElement('button')
    muteBtn.className = 'btn--icon'
    updateMuteButton(muteBtn, forum.domain)
    muteBtn.addEventListener('click', () => toggleMute(forum.domain, !isMuted(forum.domain)))
    row.appendChild(muteBtn)

    // Remove button
    const removeBtn = createButton({
      text: 'Remove',
      variant: 'danger',
      className: 'text-sm',
      onClick: () => handleRemoveForum(forum.domain),
    })
    row.appendChild(removeBtn)

    forumRows.set(forum.domain, { row, muteBtn, removeBtn })
    return row
  }

  function updateMuteButton(muteBtn: HTMLElement, domain: string) {
    const muted = isMuted(domain)
    muteBtn.title = muted ? 'Unmute notifications' : 'Mute notifications'
    muteBtn.innerHTML = muted
      ? `<svg class="icon-sm" style="color:var(--color-text-faint)" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2"/></svg>`
      : `<svg class="icon-sm" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.536 8.464a5 5 0 010 7.072M18.364 5.636a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"/></svg>`
  }

  function renderForumList() {
    const { forums } = forumStore.get()

    if (forums.length === 0) {
      forumListContainer.style.display = 'none'
      if (!forumsEmptyEl.parentNode) forumsCard.appendChild(forumsEmptyEl)
      return
    }

    forumsEmptyEl.remove()
    forumListContainer.style.display = ''

    const currentDomains = new Set(forums.map(f => f.domain))

    // Remove stale rows
    for (const [domain, entry] of forumRows) {
      if (!currentDomains.has(domain)) {
        entry.row.remove()
        forumRows.delete(domain)
      }
    }

    // Add/reorder rows
    for (const forum of forums) {
      if (!forumRows.has(forum.domain)) {
        createForumRow(forum)
      }
      forumListContainer.appendChild(forumRows.get(forum.domain)!.row)
    }
  }

  async function fetchMemberships() {
    try {
      const session = auth.getSession()
      if (!session) return
      const res = await fetch('/api/memberships', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (!res.ok) return
      memberships = await res.json()
      // Update mute buttons for all existing rows
      for (const [domain, entry] of forumRows) {
        updateMuteButton(entry.muteBtn, domain)
      }
    } catch { /* non-critical */ }
  }

  async function fetchOwnedSites() {
    const session = auth.getSession()
    if (!session) return
    // Try each forum until we find one that has the platform API (hosted server)
    const { forums } = forumStore.get()
    for (const forum of forums) {
      try {
        const res = await fetch(`https://${forum.domain}/api/platform/owned-sites`, {
          headers: { 'X-Forumline-ID': session.user.id },
        })
        if (!res.ok) continue
        const sites: { domain: string; slug: string }[] = await res.json()
        ownedSites = new Map(sites.map(s => [s.domain, s.slug]))
        rebuildForumRows()
        return
      } catch { continue }
    }
  }

  function rebuildForumRows() {
    // Clear and rebuild all forum rows so Edit Site buttons reflect ownership
    for (const [, entry] of forumRows) {
      entry.row.remove()
    }
    forumRows.clear()
    renderForumList()
  }

  async function fetchAvatar() {
    const userId = forumlineSession?.user?.id
    if (!userId) return
    try {
      const session = auth.getSession()
      if (!session) return
      // Use the identity endpoint to get profile info including avatar
      const res = await fetch('/api/identity', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (!res.ok) return
      const data = await res.json()
      if (data.avatar_url) {
        avatarUrl = data.avatar_url
        renderHubContent()
      }
    } catch { /* ignore */ }
  }

  async function toggleMute(forumDomain: string, muted: boolean) {
    // Optimistic update
    memberships = memberships.map((m) =>
      m.forum_domain === forumDomain ? { ...m, notifications_muted: muted } : m,
    )
    const entry = forumRows.get(forumDomain)
    if (entry) updateMuteButton(entry.muteBtn, forumDomain)

    try {
      const session = auth.getSession()
      if (!session) throw new Error('No session')
      const res = await fetch('/api/memberships', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ forum_domain: forumDomain, muted }),
      })
      if (!res.ok) throw new Error('Failed to toggle mute')
    } catch {
      // Revert
      memberships = memberships.map((m) =>
        m.forum_domain === forumDomain ? { ...m, notifications_muted: !muted } : m,
      )
      if (entry) updateMuteButton(entry.muteBtn, forumDomain)
    }
  }

  async function handleRemoveForum(domain: string) {
    removingDomain = domain
    const entry = forumRows.get(domain)
    if (entry) {
      (entry.removeBtn as HTMLButtonElement).disabled = true
      entry.removeBtn.textContent = 'Removing...'
    }
    try {
      forumStore.removeForum(domain)
      // Row will be removed by the store subscription triggering renderForumList
    } finally {
      removingDomain = null
    }
  }

  // Only re-render forum list when forums array actually changes
  let prevForums = forumStore.get().forums
  const unsub = forumStore.subscribe(() => {
    const { forums } = forumStore.get()
    if (forums !== prevForums) {
      prevForums = forums
      renderForumList()
    }
  })

  // Init
  renderHubContent()
  renderForumList()
  fetchMemberships()
  fetchAvatar()
  fetchOwnedSites()

  return {
    el,
    destroy() { unsub(); siteManagerChild?.destroy() },
  }
}
