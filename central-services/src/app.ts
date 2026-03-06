import { GoTrueAuthClient, type HubSession } from './lib/gotrue-auth.js'
import { createForumStore, createHubStore, type ForumStore, type HubStore } from '@johnvondrashek/forumline-core'
import { createResetPassword } from './components/reset-password.js'
import { createHubAuth } from './components/hub-auth.js'
import { createAppLayout } from './components/app-layout.js'

export const hubAuth = new GoTrueAuthClient()

export const forumStore: ForumStore = createForumStore()
export const hubStore: HubStore = createHubStore({
  hubUrl: '',
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
      auth: hubAuth,
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
    const { el } = createHubAuth({ auth: hubAuth })
    page.appendChild(el)
    root.appendChild(page)
  }

  function renderApp(session: HubSession) {
    cleanup()
    root.innerHTML = ''

    // Init hub store with the direct session
    hubStore.init({
      access_token: session.access_token,
      user_id: session.user.id,
    })

    const { el, destroy } = createAppLayout({
      hubSession: session,
      forumStore,
      hubStore,
      auth: hubAuth,
    })
    currentDestroy = destroy
    root.appendChild(el)
  }

  function renderForSession(session: HubSession | null) {
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

  let currentSession: HubSession | null = null
  let passwordRecovery = false
  let hasRenderedApp = false

  renderLoading()

  // Check for URL hash tokens (password recovery links)
  hubAuth.restoreSessionFromUrl()

  const unsubscribe = hubAuth.onAuthStateChange((event, session) => {
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
    hubStore.destroy()
  }
}
