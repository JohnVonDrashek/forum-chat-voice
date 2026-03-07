import type { ForumlineSession } from '../lib/gotrue-auth.js'
import type { ForumStore, ForumlineStore } from '@johnvondrashek/forumline-core'
import { createMobileForumList } from './mobile-forum-list.js'
import { createButton } from './ui.js'

interface WelcomePageOptions {
  forumlineSession: ForumlineSession | null
  forumStore: ForumStore
  forumlineStore: ForumlineStore
  onGoToSettings: () => void
}

export function createWelcomePage({ forumlineSession, forumStore, forumlineStore, onGoToSettings }: WelcomePageOptions) {
  const el = document.createElement('div')
  el.className = 'page-scroll'
  el.style.paddingLeft = '1rem'
  el.style.paddingRight = '1rem'

  // Create mobile forum list once — reused across renders
  let forumListInstance: ReturnType<typeof createMobileForumList> | null = null

  // Persistent DOM sections
  const listWrap = document.createElement('div')
  listWrap.className = 'mx-auto mt-xl'
  listWrap.style.maxWidth = '28rem'
  listWrap.style.width = '100%'

  const center = document.createElement('div')
  center.className = 'flex flex-1 items-center justify-center'

  const content = document.createElement('div')
  content.style.maxWidth = '28rem'
  content.className = 'text-center'

  // Icon
  const iconWrap = document.createElement('div')
  iconWrap.className = 'welcome-icon'
  iconWrap.innerHTML = `<svg class="icon-xl" style="color:var(--color-primary)" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>`
  content.appendChild(iconWrap)

  const h1 = document.createElement('h1')
  h1.className = 'text-2xl font-bold text-white'
  h1.textContent = 'Welcome to Forumline'
  content.appendChild(h1)

  const desc = document.createElement('p')
  desc.className = 'mt-sm text-muted'
  desc.textContent = 'Your multi-forum client. Add forums, chat across communities, and send direct messages.'
  content.appendChild(desc)

  // Hub status area — updated in place
  const status = document.createElement('div')
  status.className = 'welcome-status'
  const statusInner = document.createElement('div')
  statusInner.className = 'flex items-center justify-center gap-sm'
  const dot = document.createElement('div')
  const statusText = document.createElement('span')
  statusText.className = 'text-sm text-secondary'
  statusInner.append(dot, statusText)
  status.appendChild(statusInner)
  const signInBtnWrap = document.createElement('div')
  status.appendChild(signInBtnWrap)
  content.appendChild(status)

  // Bottom section
  const bottomSection = document.createElement('div')
  bottomSection.className = 'mt-xl'
  const bottomText = document.createElement('p')
  bottomText.className = 'text-sm text-muted'
  bottomSection.appendChild(bottomText)

  // Add forum list for when no forums exist (shows the add button)
  const addWrap = document.createElement('div')
  addWrap.className = 'mx-auto mt-lg'
  addWrap.style.maxWidth = '28rem'
  bottomSection.appendChild(addWrap)

  content.appendChild(bottomSection)
  center.appendChild(content)

  // Snapshot for diffing
  let prevForumsLength = -1
  let prevHubConnected: boolean | null = null

  function ensureForumList() {
    if (!forumListInstance) {
      forumListInstance = createMobileForumList({ forumStore })
    }
    return forumListInstance
  }

  function render() {
    const { forums } = forumStore.get()
    const { isForumlineConnected } = forumlineStore.get()

    const forumsLengthChanged = forums.length !== prevForumsLength
    const forumlineChanged = isForumlineConnected !== prevHubConnected

    // Update forumline status if changed
    if (forumlineChanged) {
      dot.className = `status-dot ${isForumlineConnected ? 'status-dot--connected' : 'status-dot--disconnected'}`
      statusText.textContent = isForumlineConnected
        ? `Connected as @${forumlineSession?.user?.user_metadata?.username || forumlineSession?.user?.email || 'user'}`
        : 'Not connected to Forumline'

      signInBtnWrap.innerHTML = ''
      if (!isForumlineConnected) {
        signInBtnWrap.appendChild(createButton({
          text: 'Sign in',
          variant: 'primary',
          className: 'mt-md',
          onClick: onGoToSettings,
        }))
      }
      prevHubConnected = isForumlineConnected
    }

    // Update forum-dependent layout if forums length changed
    if (forumsLengthChanged) {
      el.innerHTML = ''

      const fl = ensureForumList()

      if (forums.length > 0) {
        // Show forum list at top
        listWrap.innerHTML = ''
        listWrap.appendChild(fl.el)
        el.appendChild(listWrap)

        // Bottom text
        bottomText.textContent = `${forums.length} forum${forums.length !== 1 ? 's' : ''} connected. Tap one above to open it.`
        bottomText.innerHTML = bottomText.textContent
        addWrap.innerHTML = ''
      } else {
        // No forums — show add prompt with forum list (for add button)
        bottomText.innerHTML = 'Tap <span class="font-medium text-green">Add Forum</span> below to add your first forum'
        addWrap.innerHTML = ''
        addWrap.appendChild(fl.el)
      }

      el.appendChild(center)
      prevForumsLength = forums.length
    }
  }

  const unsub = forumStore.subscribe(() => render())
  render()

  return {
    el,
    destroy() {
      unsub()
      forumListInstance?.destroy()
    },
  }
}
