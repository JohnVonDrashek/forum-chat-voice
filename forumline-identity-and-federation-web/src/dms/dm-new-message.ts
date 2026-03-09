/*
 * New 1:1 message user picker (Van.js)
 *
 * This file lets users start a new direct message by searching for and selecting a Forumline user.
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
import type { ForumlineProfile } from '@johnvondrashek/forumline-protocol'
import { tags, state } from '../shared/dom.js'
import { createAvatar, createInput, createSpinner } from '../shared/ui.js'

const { div, button } = tags

interface DmNewMessageOptions {
  forumlineStore: ForumlineStore
  onSelectUser: (userId: string) => void
}

export function createDmNewMessage({ forumlineStore, onSelectUser }: DmNewMessageOptions) {
  const searchQuery = state('')
  const results = state<ForumlineProfile[]>([])
  const searching = state(false)
  let searchTimer: ReturnType<typeof setTimeout> | null = null

  const el = div({ class: 'flex flex-col', style: 'height:100%' }) as HTMLElement

  const input = createInput({ type: 'text', placeholder: 'Search Forumline users...', autofocus: true })
  input.addEventListener('input', () => {
    searchQuery.val = input.value
    if (searchTimer) clearTimeout(searchTimer)
    if (!searchQuery.val.trim()) {
      results.val = []
      return
    }
    searchTimer = setTimeout(doSearch, 300)
  })
  el.appendChild(div({ class: 'p-lg' }, input) as HTMLElement)

  async function doSearch() {
    const { forumlineClient } = forumlineStore.get()
    if (!forumlineClient || !searchQuery.val.trim()) return
    searching.val = true
    try {
      results.val = await forumlineClient.searchProfiles(searchQuery.val)
    } catch (err) {
      console.error('[Forumline:DM] Profile search failed:', err)
      results.val = []
    }
    searching.val = false
  }

  const resultsEl = div({ class: 'flex-1 overflow-y-auto' },
    () => {
      if (searching.val) {
        const wrap = div({ class: 'flex items-center justify-center', style: 'padding-top:2rem' }) as HTMLElement
        wrap.appendChild(createSpinner(true))
        return wrap
      }
      if (searchQuery.val.trim() && results.val.length === 0) {
        return div({ class: 'text-center text-sm text-muted', style: 'padding:0.75rem 1rem' }, 'No Forumline users found')
      }
      const container = div() as HTMLElement
      for (const profile of results.val) {
        const btn = button({ class: 'conversation-item', onclick: () => onSelectUser(profile.id) }) as HTMLElement
        btn.appendChild(createAvatar({ avatarUrl: profile.avatar_url, seed: profile.username, size: 40 }))
        const info = div({ class: 'min-w-0' },
          div({ class: 'font-medium text-white' }, profile.display_name || profile.username),
          div({ class: 'text-sm text-muted' }, `@${profile.username}`),
        )
        btn.appendChild(info as HTMLElement)
        container.appendChild(btn)
      }
      return container
    },
  ) as HTMLElement
  el.appendChild(resultsEl)

  return {
    el,
    destroy() { if (searchTimer) clearTimeout(searchTimer) },
  }
}
