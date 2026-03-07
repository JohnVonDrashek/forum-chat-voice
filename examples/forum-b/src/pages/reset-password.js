import { updatePassword, authStore } from '../lib/auth.js'
import { navigate } from '../router.js'

export function renderResetPassword(container) {
  const { user } = authStore.get()

  if (user) { showForm(container); return }

  container.innerHTML = `
    <div style="max-width:380px;margin:40px auto;text-align:center">
      <div class="skeleton" style="width:200px;height:20px;margin:0 auto"></div>
      <p style="color:var(--text-muted);margin-top:12px;font-size:12px">Verifying reset link...</p>
    </div>
  `

  const timer = setTimeout(() => {
    const { user: u } = authStore.get()
    if (u) { showForm(container) } else {
      container.innerHTML = `
        <div style="max-width:380px;margin:40px auto">
          <div class="gothic-box">
            <div class="gothic-box-header">~ Error ~</div>
            <div class="gothic-box-content text-center">
              <p style="color:var(--accent-red);font-size:14px;margin-bottom:8px">Invalid or Expired Link</p>
              <p style="font-size:12px;color:var(--text-muted)">This password reset link is invalid or has expired.</p>
              <a href="/forgot-password" class="btn btn-primary btn-small mt-4">Request New Link</a>
            </div>
          </div>
        </div>
      `
    }
  }, 2000)

  const unsub = authStore.subscribe(() => {
    const { user: u } = authStore.get()
    if (u) { clearTimeout(timer); unsub(); showForm(container) }
  })

  return () => { clearTimeout(timer); unsub() }
}

function showForm(container) {
  container.innerHTML = `
    <div style="max-width:380px;margin:40px auto">
      <div class="gothic-box">
        <div class="gothic-box-header">~ Set New Password ~</div>
        <div class="gothic-box-content">
          <form id="reset-form">
            <div class="form-group">
              <label class="form-label">New Password</label>
              <input type="password" name="password" required minlength="6" class="form-input" />
            </div>
            <div class="form-group">
              <label class="form-label">Confirm Password</label>
              <input type="password" name="confirm" required minlength="6" class="form-input" />
            </div>
            <div id="reset-error" class="form-error"></div>
            <button type="submit" class="btn btn-primary" style="width:100%">Update Password</button>
          </form>
        </div>
      </div>
    </div>
  `

  container.querySelector('#reset-form').addEventListener('submit', async (e) => {
    e.preventDefault()
    const form = e.target
    const errorEl = container.querySelector('#reset-error')

    if (form.password.value !== form.confirm.value) {
      errorEl.textContent = 'Passwords do not match'
      errorEl.classList.add('visible')
      return
    }

    const btn = form.querySelector('button[type=submit]')
    btn.disabled = true
    btn.textContent = 'Updating...'
    errorEl.classList.remove('visible')

    const { error } = await updatePassword(form.password.value)
    if (error) {
      errorEl.textContent = error.message
      errorEl.classList.add('visible')
      btn.disabled = false
      btn.textContent = 'Update Password'
    } else {
      container.innerHTML = `
        <div style="max-width:380px;margin:40px auto">
          <div class="gothic-box">
            <div class="gothic-box-header">~ Success ~</div>
            <div class="gothic-box-content text-center">
              <p style="color:var(--accent-green)">Password Updated!</p>
              <p style="font-size:12px;color:var(--text-muted);margin-top:6px">Redirecting...</p>
            </div>
          </div>
        </div>
      `
      setTimeout(() => navigate('/'), 2000)
    }
  })
}
