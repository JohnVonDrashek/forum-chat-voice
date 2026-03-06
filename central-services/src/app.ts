import { createClient, type SupabaseClient, type Session } from '@supabase/supabase-js'
import { createForumStore, createHubStore, type ForumStore, type HubStore } from '@johnvondrashek/forumline-core'
import { createResetPassword } from './components/reset-password.js'
import { createHubAuth } from './components/hub-auth.js'
import { createAppLayout } from './components/app-layout.js'

const hubSupabaseUrl = import.meta.env.VITE_HUB_SUPABASE_URL
const hubSupabaseAnonKey = import.meta.env.VITE_HUB_SUPABASE_ANON_KEY

// Hub Supabase client — custom storageKey avoids "Multiple GoTrueClient instances" warning
export const hubSupabase: SupabaseClient = createClient(hubSupabaseUrl, hubSupabaseAnonKey, {
  auth: { storageKey: 'forumline-hub-auth' },
})

export const forumStore: ForumStore = createForumStore()
export const hubStore: HubStore = createHubStore({
  hubSupabaseUrl,
  hubSupabaseAnonKey,
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
      supabase: hubSupabase,
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
    const { el } = createHubAuth({ supabase: hubSupabase })
    page.appendChild(el)
    root.appendChild(page)
  }

  function renderApp(session: Session) {
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
      supabase: hubSupabase,
    })
    currentDestroy = destroy
    root.appendChild(el)
  }

  function renderForSession(session: Session | null) {
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

  let currentSession: Session | null = null
  let passwordRecovery = false

  renderLoading()

  hubSupabase.auth.getSession().then(({ data: { session } }) => {
    currentSession = session
    renderForSession(session)
  })

  const { data: { subscription } } = hubSupabase.auth.onAuthStateChange((event, session) => {
    currentSession = session
    if (event === 'PASSWORD_RECOVERY') {
      passwordRecovery = true
    }
    renderForSession(session)
  })

  // Return top-level cleanup
  return () => {
    subscription.unsubscribe()
    cleanup()
    hubStore.destroy()
  }
}
