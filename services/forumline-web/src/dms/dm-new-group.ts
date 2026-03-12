/*
 * New group conversation creator — iChat theme (Van.js + VanX)
 *
 * Lets users create a new group DM with multiple Forumline users,
 * styled with brushed metal inputs, Aqua chips, and glossy buttons.
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
 */
import type { ForumlineStore } from '../shared/forumline-store.js'
import type { ForumlineProfile } from '@forumline/protocol'
import { reactive, list, replace, noreactive } from 'vanjs-ext'
import { tags, state } from '../shared/dom.js'
import { createAvatar, createSpinner } from '../shared/ui.js'

const { div, span, button: btn, input } = tags

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

  const el = div({ class: 'ichat-new-group' }) as HTMLElement

  // Group name input
  const nameInput = input({
    class: 'ichat-search-input',
    type: 'text',
    placeholder: 'Group name...',
  }) as HTMLInputElement
  nameInput.addEventListener('input', () => { groupName.val = nameInput.value })
  el.appendChild(div({ class: 'ichat-search-wrap' }, nameInput) as HTMLElement)

  // Selected member chips
  const chipsWrap = div(
    { class: 'ichat-chips-wrap' },
    list(div({ class: 'ichat-chips' }), selectedMembers, (v, deleter, _k) => {
      const member = v.val as ForumlineProfile
      const chip = div({ class: 'ichat-chip' }) as HTMLElement
      chip.appendChild(createAvatar({ avatarUrl: member.avatar_url, seed: member.username, size: 20 }))
      chip.appendChild(span({}, member.display_name || member.username) as HTMLElement)
      chip.appendChild(btn({
        class: 'ichat-chip-remove',
        onclick: deleter,
      }, '\u00d7') as HTMLElement)
      return chip
    }),
  ) as HTMLElement
  el.appendChild(chipsWrap)

  // Search input
  const searchInput = input({
    class: 'ichat-search-input',
    type: 'text',
    placeholder: 'Search users to add...',
  }) as HTMLInputElement
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
  el.appendChild(div({ class: 'ichat-search-wrap', style: 'padding-top:0' }, searchInput) as HTMLElement)

  // Results
  const resultsEl = div({ class: 'ichat-search-results' },
    () => {
      if (searching.val) {
        return div({ class: 'ichat-loading' }, createSpinner(true))
      }
      if (hasSearched.val && Object.keys(searchResults).length === 0) {
        return div({ class: 'ichat-empty-text', style: 'padding:1rem;text-align:center' }, 'No Forumline users found')
      }
      const { forumlineUserId } = forumlineStore.get()
      const selectedIds = new Set(Object.keys(selectedMembers))
      const filtered: Record<string, ForumlineProfile> = {}
      for (const [id, profile] of Object.entries(searchResults)) {
        if (id !== forumlineUserId && !selectedIds.has(id)) {
          filtered[id] = profile
        }
      }

      if (Object.keys(filtered).length === 0 && hasSearched.val) {
        return div({ class: 'ichat-empty-text', style: 'padding:1rem;text-align:center' }, 'No Forumline users found')
      }

      const container = div({ class: 'ichat-buddy-list' }) as HTMLElement
      for (const [id, profile] of Object.entries(filtered)) {
        const profileBtn = btn({
          class: 'ichat-buddy',
          onclick: () => { selectedMembers[id] = noreactive(profile) },
        }) as HTMLElement
        profileBtn.appendChild(span({ class: 'ichat-presence-orb ichat-presence--available' }) as HTMLElement)
        profileBtn.appendChild(createAvatar({ avatarUrl: profile.avatar_url, seed: profile.username, size: 36 }))
        profileBtn.appendChild(
          div({ class: 'ichat-buddy-info' },
            div({ class: 'ichat-buddy-name' }, profile.display_name || profile.username),
            div({ class: 'ichat-buddy-status' }, `@${profile.username}`),
          ) as HTMLElement,
        )
        container.appendChild(profileBtn)
      }
      return container
    },
  ) as HTMLElement
  el.appendChild(resultsEl)

  // Validation message
  const validationMsg = div(
    { class: 'ichat-validation', style: () => `display:${validationText.val ? 'block' : 'none'}` },
    () => validationText.val,
  ) as HTMLElement
  el.appendChild(validationMsg)

  // Create button
  const createBtn = btn({ class: 'ichat-create-btn', onclick: () => void handleCreate() }, 'Create Group') as HTMLButtonElement
  el.appendChild(div({ class: 'ichat-bottom-bar' }, createBtn) as HTMLElement)

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
