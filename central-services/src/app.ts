import { GoTrueAuthClient, type ForumlineSession } from './lib/gotrue-auth.js'
import { createForumStore, createForumlineStore, type ForumStore, type ForumlineStore } from '@johnvondrashek/forumline-core'
import { createResetPassword } from './components/reset-password.js'
import { createForumlineAuth } from './components/forumline-auth.js'
import { createAppLayout } from './components/app-layout.js'

export const forumlineAuth = new GoTrueAuthClient()

export const forumStore: ForumStore = createForumStore()
export const forumlineStore: ForumlineStore = createForumlineStore({
  forumlineUrl: '',
})

export function createApp(root: HTMLElement) {
  let currentDestroy: (() => void) | null = null

  function renderLoading() {
    cleanup()
    root.innerHTML = ''
    const screen = document.createElement('div')
    screen.className = 'loading-screen'
    const spinner = document.createElement('div')
    spinner.className = 'spinner'
    screen.appendChild(spinner)
    root.appendChild(screen)
  }

  function renderResetPassword() {
    cleanup()
    root.innerHTML = ''
    const { el, destroy } = createResetPassword({
      auth: forumlineAuth,
      onComplete() {
        passwordRecovery = false
        renderForSession(currentSession)
      },
    })
    currentDestroy = destroy
    root.appendChild(el)
  }

  function renderAuth() {
    cleanup()
    root.innerHTML = ''
    const page = document.createElement('div')
    page.className = 'auth-page'
    const { el } = createForumlineAuth({ auth: forumlineAuth })
    page.appendChild(el)
    root.appendChild(page)
  }

  function renderApp(session: ForumlineSession) {
    cleanup()
    root.innerHTML = ''

    // Init Forumline store with the direct session
    forumlineStore.init({
      access_token: session.access_token,
      user_id: session.user.id,
    })

    const { el, destroy } = createAppLayout({
      forumlineSession: session,
      forumStore,
      forumlineStore,
      auth: forumlineAuth,
    })
    currentDestroy = destroy
    root.appendChild(el)
  }

  function renderForSession(session: ForumlineSession | null) {
    if (passwordRecovery) {
      renderResetPassword()
      return
    }
    if (!session) {
      renderAuth()
      return
    }
    renderApp(session)
  }

  function cleanup() {
    if (currentDestroy) {
      currentDestroy()
      currentDestroy = null
    }
  }

  let currentSession: ForumlineSession | null = null
  let passwordRecovery = false
  let hasRenderedApp = false

  renderLoading()

  // Check for URL hash tokens (password recovery links)
  forumlineAuth.restoreSessionFromUrl()

  const unsubscribe = forumlineAuth.onAuthStateChange((event, session) => {
    currentSession = session
    if (event === 'PASSWORD_RECOVERY') {
      passwordRecovery = true
      renderForSession(session)
      hasRenderedApp = !!session
    } else if (event === 'TOKEN_REFRESHED') {
      // Token refresh doesn't need to re-create the app layout
    } else if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN') {
      if (!hasRenderedApp) {
        renderForSession(session)
        hasRenderedApp = !!session
      }
    } else {
      // SIGNED_OUT or other events
      hasRenderedApp = false
      renderForSession(session)
    }
  })

  // Return top-level cleanup
  return () => {
    unsubscribe()
    cleanup()
    forumlineStore.destroy()
  }
}
