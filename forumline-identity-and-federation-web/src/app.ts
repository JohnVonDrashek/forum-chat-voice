/*
 * Application root (Van.js)
 *
 * This file orchestrates the top-level app lifecycle based on authentication state.
 *
 * It must:
 * - Initialize shared auth, forum, and Forumline stores used across the entire app
 * - Show a loading screen while the initial session is being restored
 * - Route to the sign-in/sign-up screen when the user is not authenticated
 * - Route to the password reset screen when a recovery link is opened
 * - Route to the main app layout when the user has an active session
 * - React to auth state changes (sign-in, sign-out, token refresh, recovery) and re-render accordingly
 * - Clean up all child views and subscriptions when the app is destroyed
 */
import { GoTrueAuthClient, type ForumlineSession } from './auth/gotrue-auth.js'
import { createForumStore, type ForumStore } from './forums/forum-store.js'
import { createForumlineStore, type ForumlineStore } from './shared/forumline-store.js'
import { createResetPassword } from './auth/reset-password.js'
import { createForumlineAuth } from './auth/forumline-auth.js'
import { createAppLayout } from './shell/app-layout.js'
import { tags } from './shared/dom.js'

const { div } = tags

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
    const screen = div({ class: 'loading-screen' }) as HTMLElement
    screen.appendChild(div({ class: 'spinner' }) as HTMLElement)
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
    const page = div({ class: 'auth-page' }) as HTMLElement
    const { el } = createForumlineAuth({ auth: forumlineAuth })
    page.appendChild(el)
    root.appendChild(page)
  }

  function renderApp(session: ForumlineSession) {
    cleanup()
    root.innerHTML = ''

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
    if (passwordRecovery) { renderResetPassword(); return }
    if (!session) { renderAuth(); return }
    renderApp(session)
  }

  function cleanup() {
    if (currentDestroy) { currentDestroy(); currentDestroy = null }
  }

  let currentSession: ForumlineSession | null = null
  let passwordRecovery = false
  let hasRenderedApp = false

  renderLoading()

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
      hasRenderedApp = false
      forumStore.clear()
      renderForSession(session)
    }
  })

  return () => {
    unsubscribe()
    cleanup()
    forumlineStore.destroy()
  }
}
