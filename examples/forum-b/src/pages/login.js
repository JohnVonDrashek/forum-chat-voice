import { signIn } from '../lib/auth.js'
import { navigate } from '../router.js'

export function renderLogin(container) {
  container.innerHTML = `
    <div style="max-width:380px;margin:40px auto">
      <div class="gothic-box">
        <div class="gothic-box-header">~ Sign In ~</div>
        <div class="gothic-box-content">
          <form id="login-form">
            <div class="form-group">
              <label class="form-label">Email</label>
              <input type="email" name="email" required class="form-input" />
            </div>
            <div class="form-group">
              <label class="form-label">Password</label>
              <input type="password" name="password" required class="form-input" />
            </div>
            <div id="login-error" class="form-error"></div>
            <button type="submit" class="btn btn-primary" style="width:100%;margin-top:8px">Enter the Forum</button>
          </form>
          <div style="margin-top:12px;text-align:center;font-size:12px">
            <a href="/forgot-password" class="link-pink">Forgot password?</a>
            <p style="margin-top:6px;color:var(--text-muted)">No account? <a href="/register" class="link-pink">Create one</a></p>
          </div>
          <div style="border-top:1px dashed var(--border-main);margin-top:12px;padding-top:12px">
            <a href="/api/forumline/auth" class="btn" style="width:100%;text-align:center;display:block">Sign in with Forumline</a>
          </div>
        </div>
      </div>
    </div>
  `

  container.querySelector('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault()
    const form = e.target
    const email = form.email.value
    const password = form.password.value
    const errorEl = container.querySelector('#login-error')
    const btn = form.querySelector('button[type=submit]')

    btn.disabled = true
    btn.textContent = 'Entering...'
    errorEl.classList.remove('visible')

    const { error } = await signIn(email, password)
    if (error) {
      errorEl.textContent = error.message
      errorEl.classList.add('visible')
      btn.disabled = false
      btn.textContent = 'Enter the Forum'
    } else {
      navigate('/')
    }
  })
}
