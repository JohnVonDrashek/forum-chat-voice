import type { ForumlineStore } from '../lib/index.js'
import type { ForumlineProfile } from '@johnvondrashek/forumline-protocol'
import { createAvatar, createButton, createInput, createSpinner } from './ui.js'

interface DmNewGroupOptions {
  forumlineStore: ForumlineStore
  onCreated: (conversationId: string) => void
}

export function createDmNewGroup({ forumlineStore, onCreated }: DmNewGroupOptions) {
  let searchQuery = ''
  let results: ForumlineProfile[] = []
  let searching = false
  let searchTimer: ReturnType<typeof setTimeout> | null = null
  let selectedMembers: ForumlineProfile[] = []
  let groupName = ''
  let creating = false

  const el = document.createElement('div')
  el.className = 'flex flex-col'
  el.style.height = '100%'

  // Group name input
  const nameWrap = document.createElement('div')
  nameWrap.className = 'p-lg'
  nameWrap.style.paddingBottom = '0'
  const nameInput = createInput({ type: 'text', placeholder: 'Group name...' })
  nameInput.addEventListener('input', () => { groupName = nameInput.value })
  nameWrap.appendChild(nameInput)
  el.appendChild(nameWrap)

  // Selected members chips
  const chipsWrap = document.createElement('div')
  chipsWrap.className = 'flex flex-wrap gap-xs p-lg'
  chipsWrap.style.paddingTop = '0.5rem'
  chipsWrap.style.paddingBottom = '0'
  el.appendChild(chipsWrap)

  // Search input
  const searchWrap = document.createElement('div')
  searchWrap.className = 'p-lg'
  searchWrap.style.paddingTop = '0.5rem'
  const input = createInput({ type: 'text', placeholder: 'Search users to add...' })
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

  // Create button at bottom
  const bottomBar = document.createElement('div')
  bottomBar.className = 'p-lg'
  bottomBar.style.borderTop = '1px solid var(--color-border)'
  const createBtn = createButton({
    text: 'Create Group',
    variant: 'primary',
    className: 'w-full',
    onClick: handleCreate,
  })
  bottomBar.appendChild(createBtn)
  el.appendChild(bottomBar)

  function renderChips() {
    chipsWrap.innerHTML = ''
    for (const member of selectedMembers) {
      const chip = document.createElement('div')
      chip.className = 'flex items-center gap-xs'
      chip.style.cssText = 'background:var(--color-surface-hover);border-radius:999px;padding:4px 10px 4px 4px;font-size:13px;color:var(--color-text-secondary)'

      chip.appendChild(createAvatar({ avatarUrl: member.avatar_url, seed: member.username, size: 20 }))

      const name = document.createElement('span')
      name.textContent = member.display_name || member.username
      chip.appendChild(name)

      const removeBtn = document.createElement('button')
      removeBtn.style.cssText = 'background:none;border:none;color:var(--color-text-muted);cursor:pointer;padding:0 0 0 4px;font-size:16px;line-height:1'
      removeBtn.innerHTML = '&times;'
      removeBtn.addEventListener('click', () => {
        selectedMembers = selectedMembers.filter(m => m.id !== member.id)
        renderChips()
        renderResults()
      })
      chip.appendChild(removeBtn)

      chipsWrap.appendChild(chip)
    }
  }

  async function doSearch() {
    const { forumlineClient } = forumlineStore.get()
    if (!forumlineClient || !searchQuery.trim()) return

    searching = true
    renderResults()

    try {
      results = await forumlineClient.searchProfiles(searchQuery)
    } catch (err) {
      console.error('[Forumline:DM] Profile search failed:', err)
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

    const { forumlineUserId } = forumlineStore.get()
    const selectedIds = new Set(selectedMembers.map(m => m.id))

    for (const profile of results) {
      // Skip self and already selected
      if (profile.id === forumlineUserId || selectedIds.has(profile.id)) continue

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

      btn.addEventListener('click', () => {
        selectedMembers.push(profile)
        renderChips()
        renderResults()
      })
      resultsEl.appendChild(btn)
    }
  }

  // Validation message element
  const validationMsg = document.createElement('div')
  validationMsg.className = 'text-sm text-error'
  validationMsg.style.cssText = 'padding:0 1rem;display:none'
  el.insertBefore(validationMsg, bottomBar)

  function showValidation(msg: string) {
    validationMsg.textContent = msg
    validationMsg.style.display = 'block'
    setTimeout(() => { validationMsg.style.display = 'none' }, 3000)
  }

  async function handleCreate() {
    if (creating) return
    const name = groupName.trim()
    if (!name) {
      showValidation('Please enter a group name')
      nameInput.focus()
      return
    }
    if (selectedMembers.length < 2) {
      showValidation('Add at least 2 members to create a group')
      return
    }

    const { forumlineClient } = forumlineStore.get()
    if (!forumlineClient) return

    creating = true
    createBtn.textContent = 'Creating...'

    try {
      const convo = await forumlineClient.createGroupConversation(
        selectedMembers.map(m => m.id),
        name,
      )
      onCreated(convo.id)
    } catch (err) {
      console.error('[Forumline:DM] Failed to create group:', err)
      creating = false
      createBtn.textContent = 'Create Group'
    }
  }

  return {
    el,
    destroy() {
      if (searchTimer) clearTimeout(searchTimer)
    },
  }
}
