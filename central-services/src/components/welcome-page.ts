import type { Session } from '@supabase/supabase-js'
import type { ForumStore, HubStore } from '@johnvondrashek/forumline-core'
import { createMobileForumList } from './mobile-forum-list.js'
import { createButton } from './ui.js'

interface WelcomePageOptions {
  hubSession: Session | null
  forumStore: ForumStore
  hubStore: HubStore
  onGoToSettings: () => void
}

export function createWelcomePage({ hubSession, forumStore, hubStore, onGoToSettings }: WelcomePageOptions) {
  const el = document.createElement('div')
  el.className = 'page-scroll'
  el.style.paddingLeft = '1rem'
  el.style.paddingRight = '1rem'

  const cleanups: (() => void)[] = []

  function render() {
    el.innerHTML = ''
    const { forums } = forumStore.get()
    const { isHubConnected } = hubStore.get()

    // Show forum list at top if forums exist
    if (forums.length > 0) {
      const listWrap = document.createElement('div')
      listWrap.className = 'mx-auto mt-xl'
      listWrap.style.maxWidth = '28rem'
      listWrap.style.width = '100%'
      const { el: listEl, destroy } = createMobileForumList({ forumStore })
      cleanups.push(destroy)
      listWrap.appendChild(listEl)
      el.appendChild(listWrap)
    }

    // Center content
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

    // Hub status
    const status = document.createElement('div')
    status.className = 'welcome-status'
    const statusInner = document.createElement('div')
    statusInner.className = 'flex items-center justify-center gap-sm'
    const dot = document.createElement('div')
    dot.className = `status-dot ${isHubConnected ? 'status-dot--connected' : 'status-dot--disconnected'}`
    const statusText = document.createElement('span')
    statusText.className = 'text-sm text-secondary'
    statusText.textContent = isHubConnected
      ? `Connected as @${hubSession?.user?.user_metadata?.username || hubSession?.user?.email || 'user'}`
      : 'Not connected to Forumline Hub'
    statusInner.append(dot, statusText)
    status.appendChild(statusInner)

    if (!isHubConnected) {
      status.appendChild(createButton({
        text: 'Sign in',
        variant: 'primary',
        className: 'mt-md',
        onClick: onGoToSettings,
      }))
    }
    content.appendChild(status)

    // Forum count / add prompt
    const bottomSection = document.createElement('div')
    bottomSection.className = 'mt-xl'
    if (forums.length === 0) {
      const p = document.createElement('p')
      p.className = 'text-sm text-muted'
      p.innerHTML = 'Tap <span class="font-medium text-green">Add Forum</span> below to add your first forum'
      bottomSection.appendChild(p)

      const addWrap = document.createElement('div')
      addWrap.className = 'mx-auto mt-lg'
      addWrap.style.maxWidth = '28rem'
      const { el: addListEl, destroy } = createMobileForumList({ forumStore })
      cleanups.push(destroy)
      addWrap.appendChild(addListEl)
      bottomSection.appendChild(addWrap)
    } else {
      const p = document.createElement('p')
      p.className = 'text-sm text-muted'
      p.textContent = `${forums.length} forum${forums.length !== 1 ? 's' : ''} connected. Tap one above to open it.`
      bottomSection.appendChild(p)
    }
    content.appendChild(bottomSection)

    center.appendChild(content)
    el.appendChild(center)
  }

  const unsub = forumStore.subscribe(() => {
    cleanups.forEach((fn) => fn())
    cleanups.length = 0
    render()
  })
  render()

  return {
    el,
    destroy() {
      unsub()
      cleanups.forEach((fn) => fn())
    },
  }
}
