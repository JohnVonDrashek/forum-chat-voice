import type { ForumlineStore } from '@johnvondrashek/forumline-core'
import type { ForumlineProfile } from '@johnvondrashek/forumline-protocol'
import { createAvatar, createInput, createSpinner } from './ui.js'

interface DmNewMessageOptions {
  forumlineStore: ForumlineStore
  onSelectUser: (userId: string) => void
}

export function createDmNewMessage({ forumlineStore, onSelectUser }: DmNewMessageOptions) {
  let searchQuery = ''
  let results: ForumlineProfile[] = []
  let searching = false
  let searchTimer: ReturnType<typeof setTimeout> | null = null

  const el = document.createElement('div')
  el.className = 'flex flex-col'
  el.style.height = '100%'

  // Search input
  const searchWrap = document.createElement('div')
  searchWrap.className = 'p-lg'
  const input = createInput({ type: 'text', placeholder: 'Search Forumline users...', autofocus: true })
  input.addEventListener('input', () => {
    searchQuery = input.value
    if (searchTimer) clearTimeout(searchTimer)
    if (!searchQuery.trim()) {
      results = []
      renderResults()
      return
    }
    searchTimer = setTimeout(doSearch, 300)
  })
  searchWrap.appendChild(input)
  el.appendChild(searchWrap)

  // Results container
  const resultsEl = document.createElement('div')
  resultsEl.className = 'flex-1 overflow-y-auto'
  el.appendChild(resultsEl)

  async function doSearch() {
    const { forumlineClient } = forumlineStore.get()
    if (!forumlineClient || !searchQuery.trim()) return

    searching = true
    renderResults()

    try {
      results = await forumlineClient.searchProfiles(searchQuery)
    } catch (err) {
      console.error('[Hub:DM] Profile search failed:', err)
      results = []
    }

    searching = false
    renderResults()
  }

  function renderResults() {
    resultsEl.innerHTML = ''

    if (searching) {
      const spinnerWrap = document.createElement('div')
      spinnerWrap.className = 'flex items-center justify-center'
      spinnerWrap.style.paddingTop = '2rem'
      spinnerWrap.appendChild(createSpinner(true))
      resultsEl.appendChild(spinnerWrap)
      return
    }

    if (searchQuery.trim() && results.length === 0) {
      const p = document.createElement('div')
      p.className = 'text-center text-sm text-muted'
      p.style.padding = '0.75rem 1rem'
      p.textContent = 'No Forumline users found'
      resultsEl.appendChild(p)
      return
    }

    for (const profile of results) {
      const btn = document.createElement('button')
      btn.className = 'conversation-item'

      btn.appendChild(createAvatar({ avatarUrl: profile.avatar_url, seed: profile.username, size: 40 }))

      const info = document.createElement('div')
      info.className = 'min-w-0'
      const name = document.createElement('div')
      name.className = 'font-medium text-white'
      name.textContent = profile.display_name || profile.username
      const username = document.createElement('div')
      username.className = 'text-sm text-muted'
      username.textContent = `@${profile.username}`
      info.append(name, username)
      btn.appendChild(info)

      btn.addEventListener('click', () => onSelectUser(profile.id))
      resultsEl.appendChild(btn)
    }
  }

  return {
    el,
    destroy() {
      if (searchTimer) clearTimeout(searchTimer)
    },
  }
}
