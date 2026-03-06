import type { Session, SupabaseClient } from '@supabase/supabase-js'
import type { ForumStore, HubStore } from '@johnvondrashek/forumline-core'
import { createHubAuth } from './hub-auth.js'
import { createAvatar, createButton, createCard } from './ui.js'

interface SettingsPageOptions {
  hubSession: Session | null
  forumStore: ForumStore
  hubStore: HubStore
  supabase: SupabaseClient
  onClose: () => void
}

export function createSettingsPage({ hubSession, forumStore, hubStore, supabase, onClose }: SettingsPageOptions) {
  let memberships: { forum_domain: string; notifications_muted: boolean }[] = []
  let removingDomain: string | null = null
  let avatarUrl: string | null = null

  const el = document.createElement('div')
  el.className = 'page-scroll'

  async function fetchMemberships() {
    if (!hubSession) return
    try {
      const res = await fetch('/api/memberships', {
        headers: { Authorization: `Bearer ${hubSession.access_token}` },
      })
      if (!res.ok) return
      memberships = await res.json()
      render()
    } catch { /* non-critical */ }
  }

  async function fetchAvatar() {
    if (!hubSession) return
    try {
      const { data } = await supabase
        .from('hub_profiles')
        .select('avatar_url')
        .eq('id', hubSession.user.id)
        .single()
      if (data?.avatar_url) {
        avatarUrl = data.avatar_url
        render()
      }
    } catch { /* ignore */ }
  }

  async function toggleMute(forumDomain: string, muted: boolean) {
    if (!hubSession) return
    // Optimistic update
    memberships = memberships.map((m) =>
      m.forum_domain === forumDomain ? { ...m, notifications_muted: muted } : m,
    )
    render()

    try {
      const res = await fetch('/api/memberships', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${hubSession.access_token}`,
        },
        body: JSON.stringify({ forum_domain: forumDomain, muted }),
      })
      if (!res.ok) throw new Error('Failed to toggle mute')
    } catch {
      // Revert
      memberships = memberships.map((m) =>
        m.forum_domain === forumDomain ? { ...m, notifications_muted: !muted } : m,
      )
      render()
    }
  }

  function isMuted(domain: string): boolean {
    return memberships.find((m) => m.forum_domain === domain)?.notifications_muted ?? false
  }

  async function handleRemoveForum(domain: string) {
    removingDomain = domain
    render()
    try {
      forumStore.removeForum(domain)
    } finally {
      removingDomain = null
      render()
    }
  }

  function render() {
    el.innerHTML = ''
    const { forums } = forumStore.get()
    const { isHubConnected } = hubStore.get()

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

    el.appendChild(header)

    // Content
    const content = document.createElement('div')
    content.className = 'page-content'

    // ---- Hub card ----
    const hubCard = createCard()

    const hubTitle = document.createElement('h2')
    hubTitle.className = 'text-lg font-semibold text-white'
    hubTitle.textContent = 'Forumline Hub'
    hubCard.appendChild(hubTitle)

    const hubSub = document.createElement('p')
    hubSub.className = 'text-sm text-muted mt-sm'
    hubSub.textContent = 'Connect to the Forumline Hub for cross-forum direct messages'
    hubCard.appendChild(hubSub)

    if (isHubConnected && hubSession) {
      const profileRow = document.createElement('div')
      profileRow.className = 'settings-profile-row mt-lg'

      const avatar = createAvatar({
        avatarUrl,
        seed: hubSession.user.user_metadata?.username || hubSession.user.email || undefined,
        size: 40,
      })
      profileRow.appendChild(avatar)

      const info = document.createElement('div')
      info.className = 'flex-1'
      const name = document.createElement('p')
      name.className = 'font-medium text-white'
      name.textContent = hubSession.user.user_metadata?.username || hubSession.user.email || ''
      const emailEl = document.createElement('p')
      emailEl.className = 'text-sm text-muted'
      emailEl.textContent = hubSession.user.email || ''
      info.append(name, emailEl)
      profileRow.appendChild(info)

      profileRow.appendChild(createButton({
        text: 'Sign Out',
        variant: 'secondary',
        onClick: () => supabase.auth.signOut(),
      }))

      hubCard.appendChild(profileRow)
    } else {
      const authWrap = document.createElement('div')
      authWrap.className = 'mt-lg'
      const { el: authEl } = createHubAuth({ supabase })
      authWrap.appendChild(authEl)
      hubCard.appendChild(authWrap)
    }

    content.appendChild(hubCard)

    // ---- Forums card ----
    const forumsCard = createCard()

    const forumsTitle = document.createElement('h2')
    forumsTitle.className = 'text-lg font-semibold text-white'
    forumsTitle.textContent = 'Forums'
    forumsCard.appendChild(forumsTitle)

    const forumsSub = document.createElement('p')
    forumsSub.className = 'text-sm text-muted mt-sm'
    forumsSub.textContent = 'Manage your connected forums'
    forumsCard.appendChild(forumsSub)

    if (forums.length === 0) {
      const empty = document.createElement('p')
      empty.className = 'text-sm text-faint mt-lg'
      empty.textContent = 'No forums added yet. Go to Home and tap Add Forum to add one.'
      forumsCard.appendChild(empty)
    } else {
      const list = document.createElement('div')
      list.style.display = 'flex'
      list.style.flexDirection = 'column'
      list.style.gap = '0.5rem'
      list.style.marginTop = '1rem'

      for (const forum of forums) {
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

        // Mute button
        const muted = isMuted(forum.domain)
        const muteBtn = document.createElement('button')
        muteBtn.className = 'btn--icon'
        muteBtn.title = muted ? 'Unmute notifications' : 'Mute notifications'
        muteBtn.innerHTML = muted
          ? `<svg class="icon-sm" style="color:var(--color-text-faint)" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2"/></svg>`
          : `<svg class="icon-sm" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.536 8.464a5 5 0 010 7.072M18.364 5.636a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"/></svg>`
        muteBtn.addEventListener('click', () => toggleMute(forum.domain, !muted))
        row.appendChild(muteBtn)

        // Remove button
        row.appendChild(createButton({
          text: removingDomain === forum.domain ? 'Removing...' : 'Remove',
          variant: 'danger',
          className: 'text-sm',
          disabled: removingDomain === forum.domain,
          onClick: () => handleRemoveForum(forum.domain),
        }))

        list.appendChild(row)
      }

      forumsCard.appendChild(list)
    }

    content.appendChild(forumsCard)
    el.appendChild(content)
  }

  const unsub = forumStore.subscribe(() => render())

  // Init
  fetchMemberships()
  fetchAvatar()
  render()

  return {
    el,
    destroy() { unsub() },
  }
}
