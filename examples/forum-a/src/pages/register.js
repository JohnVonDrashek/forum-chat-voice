import { signUp } from '../lib/auth.js'
import { navigate } from '../router.js'

export function renderRegister(container) {
  container.innerHTML = `
    <div class="max-w-md mx-auto mt-12">
      <h1 class="text-2xl font-bold mb-6">Create Account</h1>
      <form id="register-form" class="space-y-4">
        <div>
          <label class="block text-sm font-medium text-slate-300 mb-1">Username</label>
          <input type="text" name="username" required minlength="3" class="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        </div>
        <div>
          <label class="block text-sm font-medium text-slate-300 mb-1">Email</label>
          <input type="email" name="email" required class="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        </div>
        <div>
          <label class="block text-sm font-medium text-slate-300 mb-1">Password</label>
          <input type="password" name="password" required minlength="6" class="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        </div>
        <div id="register-error" class="hidden text-sm text-red-400"></div>
        <button type="submit" class="w-full py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-medium transition-colors">Create Account</button>
      </form>
      <p class="mt-4 text-center text-sm text-slate-400">Already have an account? <a href="/login" class="text-indigo-400 hover:text-indigo-300">Sign in</a></p>
    </div>
  `

  container.querySelector('#register-form').addEventListener('submit', async (e) => {
    e.preventDefault()
    const form = e.target
    const errorEl = container.querySelector('#register-error')
    const btn = form.querySelector('button[type=submit]')

    btn.disabled = true
    btn.textContent = 'Creating account...'
    errorEl.classList.add('hidden')

    const { error } = await signUp(form.email.value, form.password.value, form.username.value)
    if (error) {
      errorEl.textContent = error.message
      errorEl.classList.remove('hidden')
      btn.disabled = false
      btn.textContent = 'Create Account'
    } else {
      navigate('/')
    }
  })
}
