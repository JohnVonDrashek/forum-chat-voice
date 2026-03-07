import type { GoTrueAuthClient } from '../lib/gotrue-auth.js'
import { createButton, createInput } from './ui.js'

type AuthMode = 'signin' | 'signup' | 'forgot'

interface ForumlineAuthOptions {
  auth: GoTrueAuthClient
}

export function createForumlineAuth({ auth }: ForumlineAuthOptions) {
  let mode: AuthMode = 'signin'
  let email = ''
  let password = ''
  let username = ''
  let error: string | null = null
  let loading = false
  let resetSent = false

  const el = document.createElement('div')
  el.className = 'auth-form'

  function render() {
    el.innerHTML = ''

    // Reset sent confirmation
    if (mode === 'forgot' && resetSent) {
      const successIcon = document.createElement('div')
      successIcon.className = 'success-icon'
      successIcon.innerHTML = `<svg fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>`
      el.appendChild(successIcon)

      const h3 = document.createElement('h3')
      h3.className = 'auth-form__title'
      h3.textContent = 'Check your email'
      el.appendChild(h3)

      const p = document.createElement('p')
      p.className = 'auth-form__subtitle'
      p.innerHTML = `We've sent a password reset link to <span class="font-medium text-white">${email}</span>`
      el.appendChild(p)

      const tryAgain = document.createElement('p')
      tryAgain.className = 'text-sm text-faint mt-lg'
      tryAgain.textContent = "Didn't receive the email? Check your spam folder or "
      const tryAgainBtn = document.createElement('button')
      tryAgainBtn.className = 'btn--link'
      tryAgainBtn.textContent = 'try again'
      tryAgainBtn.addEventListener('click', () => { resetSent = false; render() })
      tryAgain.appendChild(tryAgainBtn)
      el.appendChild(tryAgain)

      el.appendChild(createButton({
        text: 'Back to Sign In',
        variant: 'secondary',
        className: 'w-full mt-lg',
        onClick: () => { mode = 'signin'; resetSent = false; error = null; render() },
      }))
      return
    }

    // Heading
    const heading = mode === 'signin'
      ? 'Sign in to Forumline'
      : mode === 'signup'
        ? 'Create Account'
        : 'Reset Password'
    const subheading = mode === 'signin'
      ? 'Connect your Forumline account to enable cross-forum DMs'
      : mode === 'signup'
        ? 'Create an account to start messaging across forums'
        : "Enter your email and we'll send you a reset link"

    const h3 = document.createElement('h3')
    h3.className = 'auth-form__title'
    h3.textContent = heading
    el.appendChild(h3)

    const sub = document.createElement('p')
    sub.className = 'auth-form__subtitle'
    sub.textContent = subheading
    el.appendChild(sub)

    // Form
    const form = document.createElement('form')
    form.className = 'auth-form__fields'

    if (mode === 'signup') {
      const usernameInput = createInput({ type: 'text', placeholder: 'Username', required: true, value: username })
      usernameInput.addEventListener('input', () => { username = usernameInput.value })
      form.appendChild(usernameInput)
    }

    const emailInput = createInput({ type: 'email', placeholder: 'Email', required: true, value: email })
    emailInput.addEventListener('input', () => { email = emailInput.value })
    form.appendChild(emailInput)

    if (mode !== 'forgot') {
      const pwInput = createInput({ type: 'password', placeholder: 'Password', required: true, minLength: 6, value: password })
      pwInput.addEventListener('input', () => { password = pwInput.value })
      form.appendChild(pwInput)
    }

    if (error) {
      const errEl = document.createElement('p')
      errEl.className = 'text-sm text-error'
      errEl.textContent = error
      form.appendChild(errEl)
    }

    const submitText = loading
      ? (mode === 'signin' ? 'Signing in...' : mode === 'signup' ? 'Creating account...' : 'Sending...')
      : (mode === 'signin' ? 'Sign In' : mode === 'signup' ? 'Create Account' : 'Send Reset Link')

    form.appendChild(createButton({
      text: submitText,
      variant: 'primary',
      className: 'w-full',
      type: 'submit',
      disabled: loading,
    }))

    form.addEventListener('submit', async (e) => {
      e.preventDefault()
      error = null
      loading = true
      render()

      try {
        if (mode === 'forgot') {
          const { error: resetError } = await auth.resetPasswordForEmail(email)
          if (resetError) throw resetError
          resetSent = true
        } else if (mode === 'signin') {
          const { error: signInError } = await auth.signIn(email, password)
          if (signInError) throw signInError
        } else {
          const { error: signUpError } = await auth.signUp(email, password, username)
          if (signUpError) throw signUpError
        }
      } catch (err) {
        error = err instanceof Error ? err.message : String(err)
      } finally {
        loading = false
        render()
      }
    })

    el.appendChild(form)

    // Forgot password link
    if (mode === 'signin') {
      const forgotBtn = document.createElement('button')
      forgotBtn.className = 'btn--link-muted mt-sm'
      forgotBtn.textContent = 'Forgot password?'
      forgotBtn.addEventListener('click', () => { mode = 'forgot'; error = null; render() })
      el.appendChild(forgotBtn)
    }

    // Toggle signin/signup
    const toggleBtn = document.createElement('button')
    toggleBtn.className = 'btn--link text-sm mt-md'
    toggleBtn.style.display = 'block'
    toggleBtn.textContent = mode === 'signin'
      ? "Don't have an account? Create one"
      : 'Already have an account? Sign in'
    toggleBtn.addEventListener('click', () => {
      mode = mode === 'signin' ? 'signup' : 'signin'
      error = null
      resetSent = false
      render()
    })
    el.appendChild(toggleBtn)
  }

  render()
  return { el, destroy() {} }
}
