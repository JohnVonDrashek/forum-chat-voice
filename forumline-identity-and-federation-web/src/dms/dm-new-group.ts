/*
 * New group conversation creator (Van.js + VanX)
 *
 * This file lets users create a new group DM conversation with multiple Forumline users.
 *
 * It must:
 * - Provide a text input for naming the group
 * - Let users search for Forumline users by username with debounced queries
 * - Display search results with avatars, display names, and usernames
 * - Allow selecting multiple users, shown as removable chips above the search
 * - Exclude the current user and already-selected users from search results
 * - Validate that a group name is provided and at least 2 members are selected
 * - Show validation messages that auto-dismiss after 3 seconds
 * - Create the group conversation on the server and navigate to it on success
 * - Show a loading state on the create button while the request is in progress
 *
 * Uses reactive + list for the selected member chips and search
 * results — only added/removed chips and results cause DOM mutations.
 */
import type { ForumlineStore } from '../shared/forumline-store.js'
import type { ForumlineProfile } from '@johnvondrashek/forumline-protocol'
import { reactive, list, replace, noreactive } from 'vanjs-ext'
import { tags, state } from '../shared/dom.js'
import { createAvatar, createButton, createInput, createSpinner } from '../shared/ui.js'

const { div, span, button: btn } = tags

interface DmNewGroupOptions {
  forumlineStore: ForumlineStore
  onCreated: (conversationId: string) => void
}

export function createDmNewGroup({ forumlineStore, onCreated }: DmNewGroupOptions) {
  const searchQuery = state('')
  const searchResults = reactive<Record<string, ForumlineProfile>>({})
  const searching = state(false)
  const hasSearched = state(false)
  const selectedMembers = reactive<Record<string, ForumlineProfile>>({})
  const groupName = state('')
  const creating = state(false)
  const validationText = state('')
  let searchTimer: ReturnType<typeof setTimeout> | null = null
  let validationTimer: ReturnType<typeof setTimeout> | null = null

  const el = div({ class: 'flex flex-col', style: 'height:100%' }) as HTMLElement

  // Group name
  const nameInput = createInput({ type: 'text', placeholder: 'Group name...' })
  nameInput.addEventListener('input', () => { groupName.val = nameInput.value })
  el.appendChild(div({ class: 'p-lg', style: 'padding-bottom:0' }, nameInput) as HTMLElement)

  // Chips — list rebuilds only added/removed chips
  const chipsWrap = div(
    { class: 'flex flex-wrap gap-xs p-lg', style: 'padding-top:0.5rem;padding-bottom:0' },
    list(div({ class: 'contents' }), selectedMembers, (v, deleter, _k) => {
      const member = v.val as ForumlineProfile
      const chip = div({
        class: 'flex items-center gap-xs',
        style: 'background:var(--color-surface-hover);border-radius:999px;padding:4px 10px 4px 4px;font-size:13px;color:var(--color-text-secondary)',
      }) as HTMLElement
      chip.appendChild(createAvatar({ avatarUrl: member.avatar_url, seed: member.username, size: 20 }))
      chip.appendChild(span({}, member.display_name || member.username) as HTMLElement)
      chip.appendChild(btn({
        style: 'background:none;border:none;color:var(--color-text-muted);cursor:pointer;padding:0 0 0 4px;font-size:16px;line-height:1',
        onclick: deleter,
      }, '\u00d7') as HTMLElement)
      return chip
    }),
  ) as HTMLElement
  el.appendChild(chipsWrap)

  // Search input
  const searchInput = createInput({ type: 'text', placeholder: 'Search users to add...' })
  searchInput.addEventListener('input', () => {
    searchQuery.val = searchInput.value
    if (searchTimer) clearTimeout(searchTimer)
    if (!searchQuery.val.trim()) {
      replace(searchResults, {})
      hasSearched.val = false
      return
    }
    searchTimer = setTimeout(doSearch, 300)
  })
  el.appendChild(div({ class: 'p-lg', style: 'padding-top:0.5rem' }, searchInput) as HTMLElement)

  // Results — list efficiently renders search results
  const resultsEl = div({ class: 'flex-1 overflow-y-auto' },
    () => {
      if (searching.val) {
        const wrap = div({ class: 'flex items-center justify-center', style: 'padding-top:2rem' }) as HTMLElement
        wrap.appendChild(createSpinner(true))
        return wrap
      }
      if (hasSearched.val && Object.keys(searchResults).length === 0) {
        return div({ class: 'text-center text-sm text-muted', style: 'padding:0.75rem 1rem' }, 'No Forumline users found')
      }
      const { forumlineUserId } = forumlineStore.get()
      // Filter out current user and already-selected members
      const selectedIds = new Set(Object.keys(selectedMembers))
      const filtered: Record<string, ForumlineProfile> = {}
      for (const [id, profile] of Object.entries(searchResults)) {
        if (id !== forumlineUserId && !selectedIds.has(id)) {
          filtered[id] = profile
        }
      }

      if (Object.keys(filtered).length === 0 && hasSearched.val) {
        return div({ class: 'text-center text-sm text-muted', style: 'padding:0.75rem 1rem' }, 'No Forumline users found')
      }

      const container = div() as HTMLElement
      for (const [id, profile] of Object.entries(filtered)) {
        const profileBtn = btn({
          class: 'conversation-item',
          onclick: () => { selectedMembers[id] = noreactive(profile) },
        }) as HTMLElement
        profileBtn.appendChild(createAvatar({ avatarUrl: profile.avatar_url, seed: profile.username, size: 40 }))
        profileBtn.appendChild(
          div({ class: 'min-w-0' },
            div({ class: 'font-medium text-white' }, profile.display_name || profile.username),
            div({ class: 'text-sm text-muted' }, `@${profile.username}`),
          ) as HTMLElement,
        )
        container.appendChild(profileBtn)
      }
      return container
    },
  ) as HTMLElement
  el.appendChild(resultsEl)

  // Validation — reactive visibility and text
  const validationMsg = div(
    { class: 'text-sm text-error', style: () => `padding:0 1rem;display:${validationText.val ? 'block' : 'none'}` },
    () => validationText.val,
  ) as HTMLElement
  el.appendChild(validationMsg)

  // Create button
  const createBtn = createButton({
    text: 'Create Group',
    variant: 'primary',
    className: 'w-full',
    onClick: handleCreate,
  })
  const bottomBar = div({ class: 'p-lg', style: 'border-top:1px solid var(--color-border)' }, createBtn) as HTMLElement
  el.appendChild(bottomBar)

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
      replace(searchResults, keyed)
    } catch (err) {
      console.error('[Forumline:DM] Profile search failed:', err)
      replace(searchResults, {})
    }
    searching.val = false
    hasSearched.val = true
  }

  function showValidation(msg: string) {
    validationText.val = msg
    if (validationTimer) clearTimeout(validationTimer)
    validationTimer = setTimeout(() => { validationText.val = '' }, 3000)
  }

  async function handleCreate() {
    if (creating.val) return
    const name = groupName.val.trim()
    if (!name) { showValidation('Please enter a group name'); nameInput.focus(); return }
    const memberIds = Object.keys(selectedMembers)
    if (memberIds.length < 2) { showValidation('Add at least 2 members to create a group'); return }

    const { forumlineClient } = forumlineStore.get()
    if (!forumlineClient) return

    creating.val = true
    createBtn.textContent = 'Creating...'
    try {
      const convo = await forumlineClient.createGroupConversation(memberIds, name)
      onCreated(convo.id)
    } catch (err) {
      console.error('[Forumline:DM] Failed to create group:', err)
      creating.val = false
      createBtn.textContent = 'Create Group'
    }
  }

  return {
    el,
    destroy() {
      if (searchTimer) clearTimeout(searchTimer)
      if (validationTimer) clearTimeout(validationTimer)
    },
  }
}
