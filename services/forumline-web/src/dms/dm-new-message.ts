/*
 * New 1:1 message user picker — iChat theme (Van.js + VanX)
 *
 * Lets users start a new DM by searching for a Forumline user,
 * styled as an iChat buddy search with the classic Aqua aesthetic.
 *
 * It must:
 * - Provide a search input that queries Forumline user profiles by username
 * - Debounce search queries (300ms) to avoid excessive API calls
 * - Display matching users with their avatar, display name, and @username
 * - Show a loading spinner while the search is in progress
 * - Show a "No Forumline users found" message when the search returns no results
 * - Navigate to the conversation with the selected user when tapped
 */
import type { ForumlineStore } from '../shared/forumline-store.js'
import type { ForumlineProfile } from '@forumline/protocol'
import { reactive, replace, noreactive, list } from 'vanjs-ext'
import { tags, state } from '../shared/dom.js'
import { createAvatar, createSpinner } from '../shared/ui.js'

const { div, button, input, span } = tags

interface DmNewMessageOptions {
  forumlineStore: ForumlineStore
  onSelectUser: (userId: string) => void
}

export function createDmNewMessage({ forumlineStore, onSelectUser }: DmNewMessageOptions) {
  const searchQuery = state('')
  const results = reactive<Record<string, ForumlineProfile>>({})
  const searching = state(false)
  const hasSearched = state(false)
  let searchTimer: ReturnType<typeof setTimeout> | null = null

  const el = div({ class: 'ichat-new-message' }) as HTMLElement

  const searchInput = input({
    class: 'ichat-search-input',
    type: 'text',
    placeholder: 'Search Forumline users...',
    autofocus: true,
  }) as HTMLInputElement
  searchInput.addEventListener('input', () => {
    searchQuery.val = searchInput.value
    if (searchTimer) clearTimeout(searchTimer)
    if (!searchQuery.val.trim()) {
      replace(results, {})
      hasSearched.val = false
      return
    }
    searchTimer = setTimeout(doSearch, 300)
  })
  el.appendChild(div({ class: 'ichat-search-wrap' }, searchInput) as HTMLElement)

  async function doSearch() {
    const { forumlineClient } = forumlineStore.get()
    if (!forumlineClient || !searchQuery.val.trim()) return
    searching.val = true
    try {
      const data = await forumlineClient.searchProfiles(searchQuery.val)
      const keyed: Record<string, ForumlineProfile> = {}
      for (const profile of data) {
        keyed[profile.id] = noreactive(profile)
      }
      replace(results, keyed)
    } catch (err) {
      console.error('[Forumline:DM] Profile search failed:', err)
      replace(results, {})
    }
    searching.val = false
    hasSearched.val = true
  }

  const resultsEl = div({ class: 'ichat-search-results' },
    () => {
      if (searching.val) {
        return div({ class: 'ichat-loading' }, createSpinner(true))
      }
      if (hasSearched.val && Object.keys(results).length === 0) {
        return div({ class: 'ichat-empty-text', style: 'padding:1rem;text-align:center' }, 'No Forumline users found')
      }

      return list(div({ class: 'ichat-buddy-list' }), results, (v, _deleter, _k) => {
        const profile = v.val as ForumlineProfile
        const btn = button({ class: 'ichat-buddy', onclick: () => onSelectUser(profile.id) }) as HTMLElement
        btn.appendChild(span({ class: 'ichat-presence-orb ichat-presence--available' }) as HTMLElement)
        btn.appendChild(createAvatar({ avatarUrl: profile.avatar_url, seed: profile.username, size: 36 }))
        btn.appendChild(
          div({ class: 'ichat-buddy-info' },
            div({ class: 'ichat-buddy-name' }, profile.display_name || profile.username),
            div({ class: 'ichat-buddy-status' }, `@${profile.username}`),
          ) as HTMLElement,
        )
        return btn
      })
    },
  ) as HTMLElement
  el.appendChild(resultsEl)

  return {
    el,
    destroy() { if (searchTimer) clearTimeout(searchTimer) },
  }
}
