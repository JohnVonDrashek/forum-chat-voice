import { signUp } from '../lib/auth.js'
import { navigate } from '../router.js'

export function renderRegister(container) {
  container.innerHTML = `
    <div style="max-width:380px;margin:40px auto">
      <div class="gothic-box">
        <div class="gothic-box-header">~ Create Account ~</div>
        <div class="gothic-box-content">
          <form id="register-form">
            <div class="form-group">
              <label class="form-label">Username</label>
              <input type="text" name="username" required minlength="3" class="form-input" />
            </div>
            <div class="form-group">
              <label class="form-label">Email</label>
              <input type="email" name="email" required class="form-input" />
            </div>
            <div class="form-group">
              <label class="form-label">Password</label>
              <input type="password" name="password" required minlength="6" class="form-input" />
            </div>
            <div id="register-error" class="form-error"></div>
            <button type="submit" class="btn btn-primary" style="width:100%;margin-top:8px">Join the Dark Forum</button>
          </form>
          <p style="margin-top:12px;text-align:center;font-size:12px;color:var(--text-muted)">Already a member? <a href="/login" class="link-pink">Sign in</a></p>
        </div>
      </div>
    </div>
  `

  container.querySelector('#register-form').addEventListener('submit', async (e) => {
    e.preventDefault()
    const form = e.target
    const errorEl = container.querySelector('#register-error')
    const btn = form.querySelector('button[type=submit]')

    btn.disabled = true
    btn.textContent = 'Creating...'
    errorEl.classList.remove('visible')

    const { error } = await signUp(form.email.value, form.password.value, form.username.value)
    if (error) {
      errorEl.textContent = error.message
      errorEl.classList.add('visible')
      btn.disabled = false
      btn.textContent = 'Join the Dark Forum'
    } else {
      navigate('/')
    }
  })
}
