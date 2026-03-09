/*
 * New 1:1 message user picker (Van.js + VanX)
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
 *
 * Uses list with replace for efficient search result rendering —
 * only changed results are re-rendered instead of rebuilding the entire list.
 */
import type { ForumlineStore } from '../shared/forumline-store.js'
import type { ForumlineProfile } from '@johnvondrashek/forumline-protocol'
import { reactive, replace, noreactive, list } from 'vanjs-ext'
import { tags, state } from '../shared/dom.js'
import { createAvatar, createInput, createSpinner } from '../shared/ui.js'

const { div, button } = tags

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

  const el = div({ class: 'flex flex-col', style: 'height:100%' }) as HTMLElement

  const input = createInput({ type: 'text', placeholder: 'Search Forumline users...', autofocus: true })
  input.addEventListener('input', () => {
    searchQuery.val = input.value
    if (searchTimer) clearTimeout(searchTimer)
    if (!searchQuery.val.trim()) {
      replace(results, {})
      hasSearched.val = false
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

  const resultsEl = div({ class: 'flex-1 overflow-y-auto' },
    () => {
      if (searching.val) {
        const wrap = div({ class: 'flex items-center justify-center', style: 'padding-top:2rem' }) as HTMLElement
        wrap.appendChild(createSpinner(true))
        return wrap
      }
      if (hasSearched.val && Object.keys(results).length === 0) {
        return div({ class: 'text-center text-sm text-muted', style: 'padding:0.75rem 1rem' }, 'No Forumline users found')
      }

      // list efficiently renders the keyed results object
      return list(div, results, (v, _deleter, _k) => {
        const profile = v.val as ForumlineProfile
        const btn = button({ class: 'conversation-item', onclick: () => onSelectUser(profile.id) }) as HTMLElement
        btn.appendChild(createAvatar({ avatarUrl: profile.avatar_url, seed: profile.username, size: 40 }))
        const info = div({ class: 'min-w-0' },
          div({ class: 'font-medium text-white' }, profile.display_name || profile.username),
          div({ class: 'text-sm text-muted' }, `@${profile.username}`),
        )
        btn.appendChild(info as HTMLElement)
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
