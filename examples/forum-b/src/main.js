import './style.css'
import { route, setNotFound, resolve, navigate } from './router.js'
import { initAuth, authStore } from './lib/auth.js'
import { initVoice } from './lib/voice.js'
import { renderLayout, getPageContainer } from './components/layout.js'
import { closeMobileSidebar } from './components/sidebar.js'

// Pages
import { renderHome } from './pages/home.js'
import { renderLogin } from './pages/login.js'
import { renderRegister } from './pages/register.js'
import { renderForgotPassword } from './pages/forgot-password.js'
import { renderResetPassword } from './pages/reset-password.js'
import { renderCategory } from './pages/category.js'
import { renderThread } from './pages/thread.js'
import { renderNewThread } from './pages/new-thread.js'
import { renderProfile } from './pages/profile.js'
import { renderChat } from './pages/chat.js'
import { renderSearch } from './pages/search.js'
import { renderVoice } from './pages/voice.js'
import { renderBookmarks } from './pages/bookmarks.js'
import { renderSettings } from './pages/settings.js'
import { renderAdmin } from './pages/admin.js'
import { renderNotFound } from './pages/not-found.js'

console.log('[Forum-B] Starting The Dark Forum...')

function page(renderFn) {
  return (params) => {
    closeMobileSidebar()
    const container = getPageContainer()
    if (!container) return
    return renderFn(container, params)
  }
}

function requireAuth(renderFn) {
  return (params) => {
    const { user, loading } = authStore.get()
    if (loading) return
    if (!user) {
      const container = getPageContainer()
      if (container) container.innerHTML = `
        <div class="gothic-box" style="margin-top:40px">
          <div class="gothic-box-header">~ Forbidden ~</div>
          <div class="gothic-box-content text-center">
            <p style="color:var(--accent-red)">You must <a href="/login" class="link-pink">sign in</a> to enter this domain.</p>
          </div>
        </div>
      `
      return
    }
    return page(renderFn)(params)
  }
}

function redirectIfAuth(renderFn) {
  return (params) => {
    const { user, loading } = authStore.get()
    if (loading) return
    if (user) {
      navigate('/', true)
      return
    }
    return page(renderFn)(params)
  }
}

// Register routes
route('/', page(renderHome))
route('/login', redirectIfAuth(renderLogin))
route('/register', redirectIfAuth(renderRegister))
route('/forgot-password', redirectIfAuth(renderForgotPassword))
route('/reset-password', page(renderResetPassword))
route('/c/:categorySlug', page(renderCategory))
route('/c/:categorySlug/new', requireAuth(renderNewThread))
route('/t/:threadId', page(renderThread))
route('/u/:username', page(renderProfile))
route('/chat', page(renderChat))
route('/chat/:channelId', page(renderChat))
route('/search', page(renderSearch))
route('/voice', page(renderVoice))
route('/voice/:roomId', page(renderVoice))
route('/bookmarks', requireAuth(renderBookmarks))
route('/settings', requireAuth(renderSettings))
route('/admin', page(renderAdmin))
setNotFound(page(renderNotFound))

async function boot() {
  renderLayout(document.getElementById('app'))
  await initAuth()
  initVoice()
  resolve()
  authStore.subscribe(() => {})
}

boot()

// ---- Forumline protocol: respond to parent iframe messages ----
if (window.parent !== window) {
  function sendAuthState() {
    const { user } = authStore.get()
    window.parent.postMessage({ type: 'forumline:auth_state', signedIn: !!user }, '*')
  }

  window.addEventListener('message', (e) => {
    if (e.data?.type === 'forumline:request_auth_state') {
      sendAuthState()
    }
  })

  // Notify parent we're ready once auth is resolved
  authStore.subscribe(() => {
    const { loading } = authStore.get()
    if (!loading) {
      window.parent.postMessage({ type: 'forumline:ready' }, '*')
      sendAuthState()
    }
  })
}
