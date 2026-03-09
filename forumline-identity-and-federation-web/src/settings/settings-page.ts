/*
 * Settings page (Van.js + VanX)
 *
 * This file provides the user's account and forum management settings.
 *
 * It must:
 * - Display the Forumline account section: show profile (avatar, username, email) when signed in, or the auth form when not
 * - Provide a sign-out button for the connected Forumline account
 * - Display a list of all connected forums with their icons, names, and domains
 * - Allow removing forums from the user's list
 * - Allow muting/unmuting notifications per forum with optimistic UI updates
 * - Show an "Edit Site" button for forums the user owns on the hosted platform
 * - Open the site manager (file editor) for owned hosted forums
 * - Fetch forum membership data and notification mute states from the server
 * - Fetch the user's avatar from the identity API
 * - Detect which forums are hosted sites owned by the current user
 * - Reactively update the forum list when forums are added or removed
 */
import type { GoTrueAuthClient, ForumlineSession } from '../auth/gotrue-auth.js'
import type { ForumStore } from '../forums/forum-store.js'
import type { ForumlineStore } from '../shared/forumline-store.js'
import { createForumlineAuth } from '../auth/forumline-auth.js'
import { createSiteManager } from './site-manager.js'
import { tags, html, vanX } from '../shared/dom.js'
import { createAvatar, createButton, createCard } from '../shared/ui.js'

const { div, h1, h2, p } = tags

interface SettingsPageOptions {
  forumlineSession: ForumlineSession | null
  forumStore: ForumStore
  forumlineStore: ForumlineStore
  auth: GoTrueAuthClient
  onClose: () => void
}

export function createSettingsPage({ forumlineSession, forumStore, forumlineStore, auth, onClose }: SettingsPageOptions) {
  const settings = vanX.reactive({
    memberships: [] as { forum_domain: string; notifications_muted: boolean }[],
    avatarUrl: null as string | null,
    ownedSites: {} as Record<string, string>, // domain -> slug
  })

  let siteManagerChild: { el: HTMLElement; destroy: () => void } | null = null

  const el = div({ class: 'page-scroll' }) as HTMLElement
  const settingsWrapper = div() as HTMLElement

  // Header
  const header = div({ class: 'settings-header' }) as HTMLElement
  const backBtn = tags.button({ class: 'btn--icon', onclick: onClose },
    html(`<svg class="icon-sm" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/></svg>`),
  ) as HTMLButtonElement
  header.append(backBtn, h1({ class: 'text-xl font-bold text-white' }, 'Settings') as HTMLElement)
  settingsWrapper.appendChild(header)

  const content = div({ class: 'page-content' }) as HTMLElement
  settingsWrapper.appendChild(content)
  el.appendChild(settingsWrapper)

  function openSiteManager(forum: { name: string; domain: string }) {
    const slug = settings.ownedSites[forum.domain]
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

  // Account card
  const accountCard = createCard()
  accountCard.appendChild(h2({ class: 'text-lg font-semibold text-white' }, 'Forumline') as HTMLElement)
  accountCard.appendChild(p({ class: 'text-sm text-muted mt-sm' }, 'Connect to the Forumline for cross-forum direct messages') as HTMLElement)
  const accountContentArea = div({ class: 'mt-lg' }) as HTMLElement
  accountCard.appendChild(accountContentArea)
  content.appendChild(accountCard)

  function renderHubContent() {
    accountContentArea.innerHTML = ''
    const { isForumlineConnected } = forumlineStore.get()
    if (isForumlineConnected && forumlineSession) {
      const profileRow = div({ class: 'settings-profile-row' }) as HTMLElement
      profileRow.appendChild(createAvatar({
        avatarUrl: settings.avatarUrl,
        seed: forumlineSession.user.user_metadata?.username as string || forumlineSession.user.email || undefined,
        size: 40,
      }))
      const info = div({ class: 'flex-1' }) as HTMLElement
      info.append(
        p({ class: 'font-medium text-white' },
          (forumlineSession.user.user_metadata?.username as string) || forumlineSession.user.email || '',
        ) as HTMLElement,
        p({ class: 'text-sm text-muted' }, forumlineSession.user.email || '') as HTMLElement,
      )
      profileRow.appendChild(info)
      profileRow.appendChild(createButton({ text: 'Sign Out', variant: 'secondary', onClick: () => auth.signOut() }))
      accountContentArea.appendChild(profileRow)
    } else {
      const { el: authEl } = createForumlineAuth({ auth })
      accountContentArea.appendChild(authEl)
    }
  }

  // Forums card
  const forumsCard = createCard()
  forumsCard.appendChild(h2({ class: 'text-lg font-semibold text-white' }, 'Forums') as HTMLElement)
  forumsCard.appendChild(p({ class: 'text-sm text-muted mt-sm' }, 'Manage your connected forums') as HTMLElement)

  function isMuted(domain: string): boolean {
    return settings.memberships.find(m => m.forum_domain === domain)?.notifications_muted ?? false
  }

  function buildMuteButton(domain: string): HTMLElement {
    const muted = isMuted(domain)
    const muteBtn = tags.button({
      class: 'btn--icon',
      title: muted ? 'Unmute notifications' : 'Mute notifications',
      onclick: () => toggleMute(domain, !isMuted(domain)),
    }) as HTMLButtonElement
    muteBtn.innerHTML = muted
      ? `<svg class="icon-sm" style="color:var(--color-text-faint)" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2"/></svg>`
      : `<svg class="icon-sm" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.536 8.464a5 5 0 010 7.072M18.364 5.636a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"/></svg>`
    return muteBtn
  }

  function buildForumRow(forum: { name: string; domain: string; icon_url?: string; web_base: string }) {
    const row = div({ class: 'settings-forum-row' }) as HTMLElement

    if (forum.icon_url) {
      const iconSrc = forum.icon_url.startsWith('/') ? `${forum.web_base}${forum.icon_url}` : forum.icon_url
      const img = tags.img({ src: iconSrc, alt: forum.name, class: 'forum-card__icon', onerror: () => { img.style.display = 'none' } }) as HTMLImageElement
      row.appendChild(img)
    } else {
      row.appendChild(div({ class: 'forum-card__icon-fallback' }, forum.name[0].toUpperCase()) as HTMLElement)
    }

    const info = div({ class: 'flex-1' },
      p({ class: 'font-medium text-white' }, forum.name),
      p({ class: 'text-sm text-muted' }, forum.domain),
    ) as HTMLElement
    row.appendChild(info)

    if (settings.ownedSites[forum.domain]) {
      row.appendChild(createButton({ text: 'Edit Site', variant: 'ghost', className: 'text-sm', onClick: () => openSiteManager(forum) }))
    }

    row.appendChild(buildMuteButton(forum.domain))

    const removeBtn = createButton({
      text: 'Remove',
      variant: 'danger',
      className: 'text-sm',
      onClick: () => handleRemoveForum(forum.domain, removeBtn),
    })
    row.appendChild(removeBtn)

    return row
  }

  // Reactive forum list — automatically re-renders when forumStore or memberships state changes
  const reactiveForumList = div(
    () => {
      const { forums } = forumStore.state.val
      void settings.memberships // read to subscribe to membership changes
      void settings.ownedSites  // read to subscribe to owned sites changes
      if (forums.length === 0) {
        return p({ class: 'text-sm text-faint mt-lg' }, 'No forums added yet. Go to Home and tap Add Forum to add one.') as HTMLElement
      }
      const container = div({ style: 'display:flex;flex-direction:column;gap:0.5rem;margin-top:1rem' }) as HTMLElement
      forums.forEach(f => container.appendChild(buildForumRow(f)))
      return container
    },
  ) as HTMLElement
  forumsCard.appendChild(reactiveForumList)

  async function fetchMemberships() {
    try {
      const session = auth.getSession()
      if (!session) return
      const res = await fetch('/api/memberships', { headers: { Authorization: `Bearer ${session.access_token}` } })
      if (!res.ok) return
      vanX.replace(settings.memberships, await res.json())
    } catch { /* non-critical */ }
  }

  async function fetchOwnedSites() {
    const session = auth.getSession()
    if (!session) return
    const { forums } = forumStore.get()
    const results = await Promise.allSettled(
      forums.map(async (forum) => {
        const res = await fetch(`https://${forum.domain}/api/platform/owned-sites`, {
          headers: { 'X-Forumline-ID': session.user.id },
        })
        if (!res.ok) throw new Error('not found')
        return res.json() as Promise<{ domain: string; slug: string }[]>
      }),
    )
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value.length >= 0) {
        const newOwned: Record<string, string> = {}
        for (const s of result.value) newOwned[s.domain] = s.slug
        vanX.replace(settings.ownedSites, newOwned)
        return
      }
    }
  }

  async function fetchAvatar() {
    const userId = forumlineSession?.user?.id
    if (!userId) return
    try {
      const session = auth.getSession()
      if (!session) return
      const res = await fetch('/api/identity', { headers: { Authorization: `Bearer ${session.access_token}` } })
      if (!res.ok) return
      const data = await res.json()
      if (data.avatar_url) { settings.avatarUrl = data.avatar_url; renderHubContent() }
    } catch { /* ignore */ }
  }

  async function toggleMute(forumDomain: string, muted: boolean) {
    // Optimistic update
    vanX.replace(settings.memberships, settings.memberships.map(
      m => m.forum_domain === forumDomain ? { ...m, notifications_muted: muted } : m,
    ))
    try {
      const session = auth.getSession()
      if (!session) throw new Error('No session')
      const res = await fetch('/api/memberships', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ forum_domain: forumDomain, muted }),
      })
      if (!res.ok) throw new Error('Failed to toggle mute')
    } catch {
      // Revert on failure
      vanX.replace(settings.memberships, settings.memberships.map(
        m => m.forum_domain === forumDomain ? { ...m, notifications_muted: !muted } : m,
      ))
    }
  }

  function handleRemoveForum(domain: string, removeBtn: HTMLElement) {
    (removeBtn as HTMLButtonElement).disabled = true
    removeBtn.textContent = 'Removing...'
    forumStore.removeForum(domain)
  }

  renderHubContent()
  fetchMemberships()
  fetchAvatar()
  fetchOwnedSites()

  return {
    el,
    destroy() { siteManagerChild?.destroy() },
  }
}
