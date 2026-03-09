/*
 * Welcome / home page (Van.js)
 *
 * This file is the landing screen users see when no forum is selected.
 *
 * It must:
 * - Display a welcome message explaining Forumline's purpose (multi-forum client, DMs)
 * - Show the user's Forumline connection status (connected as @username, or not connected)
 * - Provide a sign-in button when the user is not connected to Forumline
 * - Show the list of connected forums when the user has forums, with a prompt to tap one
 * - Show an "Add Forum" prompt when the user has no forums yet
 * - Reactively update when forums are added/removed or Forumline connection status changes
 */
import type { ForumlineSession } from '../auth/gotrue-auth.js'
import type { ForumStore } from './forum-store.js'
import type { ForumlineStore } from '../shared/forumline-store.js'
import { createMobileForumList } from './mobile-forum-list.js'
import { createButton } from '../shared/ui.js'
import { tags, html } from '../shared/dom.js'

const { div, h1, p, span } = tags

interface WelcomePageOptions {
  forumlineSession: ForumlineSession | null
  forumStore: ForumStore
  forumlineStore: ForumlineStore
  onGoToSettings: () => void
}

export function createWelcomePage({ forumlineSession, forumStore, forumlineStore, onGoToSettings }: WelcomePageOptions) {
  let forumListInstance: ReturnType<typeof createMobileForumList> | null = null

  function ensureForumList() {
    if (!forumListInstance) {
      forumListInstance = createMobileForumList({ forumStore })
    }
    return forumListInstance
  }

  const el = div({
    class: 'page-scroll',
    style: 'padding-left:1rem;padding-right:1rem',
  },
    // Forum list at top (when forums exist)
    () => {
      const { forums } = forumStore.state.val
      if (forums.length > 0) {
        const wrap = div({ class: 'mx-auto mt-xl', style: 'max-width:28rem;width:100%' })
        wrap.appendChild(ensureForumList().el)
        return wrap
      }
      return div()
    },

    // Center content
    div({ class: 'flex flex-1 items-center justify-center' },
      div({ class: 'text-center', style: 'max-width:28rem' },
        // Icon
        (() => {
          return div({ class: 'welcome-icon' },
            html(`<svg class="icon-xl" style="color:var(--color-primary)" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>`),
          )
        })(),
        h1({ class: 'text-2xl font-bold text-white' }, 'Welcome to Forumline'),
        p({ class: 'mt-sm text-muted' }, 'Your multi-forum client. Add forums, chat across communities, and send direct messages.'),

        // Forumline status
        div({ class: 'welcome-status' },
          () => {
            const { isForumlineConnected } = forumlineStore.state.val
            const dotCls = `status-dot ${isForumlineConnected ? 'status-dot--connected' : 'status-dot--disconnected'}`
            const statusText = isForumlineConnected
              ? `Connected as @${forumlineSession?.user?.user_metadata?.username || forumlineSession?.user?.email || 'user'}`
              : 'Not connected to Forumline'

            const statusEl = div(
              div({ class: 'flex items-center justify-center gap-sm' },
                div({ class: dotCls }),
                span({ class: 'text-sm text-secondary' }, statusText),
              ),
            )

            if (!isForumlineConnected) {
              statusEl.appendChild(createButton({
                text: 'Sign in',
                variant: 'primary',
                className: 'mt-md',
                onClick: onGoToSettings,
              }))
            }

            return statusEl
          },
        ),

        // Bottom section
        div({ class: 'mt-xl' },
          () => {
            const { forums } = forumStore.state.val
            const bottom = div()
            const text = p({ class: 'text-sm text-muted' }) as HTMLElement

            if (forums.length > 0) {
              text.textContent = `${forums.length} forum${forums.length !== 1 ? 's' : ''} connected. Tap one above to open it.`
            } else {
              text.innerHTML = 'Tap <span class="font-medium text-green">Add Forum</span> below to add your first forum'
              const addWrap = div({ class: 'mx-auto mt-lg', style: 'max-width:28rem' })
              addWrap.appendChild(ensureForumList().el)
              bottom.append(text as Node, addWrap as Node)
              return bottom
            }

            bottom.appendChild(text)
            return bottom
          },
        ),
      ),
    ),
  )

  return {
    el: el as HTMLElement,
    destroy() {
      forumListInstance?.destroy()
    },
  }
}
