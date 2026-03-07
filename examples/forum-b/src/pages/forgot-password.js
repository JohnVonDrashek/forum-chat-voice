import { resetPassword } from '../lib/auth.js'

export function renderForgotPassword(container) {
  container.innerHTML = `
    <div style="max-width:380px;margin:40px auto">
      <div class="gothic-box">
        <div class="gothic-box-header">~ Reset Password ~</div>
        <div class="gothic-box-content">
          <p style="font-size:12px;color:var(--text-muted);margin-bottom:12px">Enter your email and we shall send you a reset link.</p>
          <form id="forgot-form">
            <div class="form-group">
              <label class="form-label">Email</label>
              <input type="email" name="email" required class="form-input" />
            </div>
            <div id="forgot-error" class="form-error"></div>
            <button type="submit" class="btn btn-primary" style="width:100%">Send Reset Link</button>
          </form>
          <div id="forgot-success" class="hidden" style="text-align:center;padding:16px 0">
            <p style="color:var(--accent-green);font-size:13px">Check your email for the reset link.</p>
            <a href="/login" class="link-pink" style="font-size:12px;margin-top:8px;display:inline-block">Back to sign in</a>
          </div>
          <p style="margin-top:12px;text-align:center;font-size:12px"><a href="/login" class="link-pink">Back to sign in</a></p>
        </div>
      </div>
    </div>
  `

  container.querySelector('#forgot-form').addEventListener('submit', async (e) => {
    e.preventDefault()
    const form = e.target
    const errorEl = container.querySelector('#forgot-error')
    const btn = form.querySelector('button[type=submit]')

    btn.disabled = true
    btn.textContent = 'Sending...'
    errorEl.classList.remove('visible')

    const { error } = await resetPassword(form.email.value)
    if (error) {
      errorEl.textContent = error.message
      errorEl.classList.add('visible')
      btn.disabled = false
      btn.textContent = 'Send Reset Link'
    } else {
      form.classList.add('hidden')
      container.querySelector('#forgot-success').classList.remove('hidden')
    }
  })
}
