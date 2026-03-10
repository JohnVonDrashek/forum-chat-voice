/*
 * Forumline authentication form (Van.js)
 *
 * This file provides the sign-in, sign-up, and password reset forms for Forumline accounts.
 *
 * It must:
 * - Show a sign-in form with email and password fields as the default view
 * - Show a sign-up form with username, email, and password fields when toggled
 * - Show a forgot-password form that sends a reset link to the user's email
 * - Display a confirmation screen after a reset link is sent, with a "try again" option
 * - Toggle between sign-in and sign-up modes with a link at the bottom
 * - Show inline validation errors returned by the auth API
 * - Show loading states on the submit button during API calls
 * - Communicate the purpose of Forumline accounts (cross-forum DMs) in the headings
 */
import type { GoTrueAuthClient } from './gotrue-auth.js'
import { tags, state, html } from '../shared/dom.js'
import { createButton, createInput } from '../shared/ui.js'

const { div, h3, p, button: btn, form: formTag } = tags

type AuthMode = 'signin' | 'signup' | 'forgot'

interface ForumlineAuthOptions {
  auth: GoTrueAuthClient
}

export function createForumlineAuth({ auth }: ForumlineAuthOptions) {
  const mode = state<AuthMode>('signin')
  const email = state('')
  const password = state('')
  const username = state('')
  const error = state<string | null>(null)
  const loading = state(false)
  const resetSent = state(false)

  function setMode(m: AuthMode) {
    mode.val = m
    error.val = null
    resetSent.val = false
  }

  async function handleSubmit(e: Event) {
    e.preventDefault()
    error.val = null
    loading.val = true

    try {
      if (mode.val === 'forgot') {
        const { error: resetError } = await auth.resetPasswordForEmail(email.val)
        if (resetError) throw resetError
        resetSent.val = true
      } else if (mode.val === 'signin') {
        const { error: signInError } = await auth.signIn(email.val, password.val)
        if (signInError) throw signInError
      } else {
        const { error: signUpError } = await auth.signUp(email.val, password.val, username.val)
        if (signUpError) throw signUpError
      }
    } catch (err) {
      error.val = err instanceof Error ? err.message : String(err)
    } finally {
      loading.val = false
    }
  }

  const el = div({ class: 'auth-form' },
    () => {
      // Reset sent confirmation
      if (mode.val === 'forgot' && resetSent.val) {
        const successIcon = div({ class: 'success-icon' },
          html(`<svg fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>`),
        )

        const tryAgain = p({ class: 'text-sm text-faint mt-lg' }, "Didn't receive the email? Check your spam folder or ")
        const tryAgainBtn = btn({ class: 'btn--link', onclick: () => { resetSent.val = false } }, 'try again')
        tryAgain.appendChild(tryAgainBtn)

        return div(
          successIcon,
          h3({ class: 'auth-form__title' }, 'Check your email'),
          (() => {
            const sub = p({ class: 'auth-form__subtitle' })
            sub.textContent = ''
            sub.append('We\'ve sent a password reset link to ')
            const emailSpan = document.createElement('span')
            emailSpan.className = 'font-medium text-white'
            emailSpan.textContent = email.val
            sub.append(emailSpan)
            return sub
          })(),
          tryAgain,
          createButton({
            text: 'Back to Sign In',
            variant: 'secondary',
            className: 'w-full mt-lg',
            onClick: () => setMode('signin'),
          }),
        )
      }

      // Auth form
      const heading = mode.val === 'signin' ? 'Sign in to Forumline'
        : mode.val === 'signup' ? 'Create Account' : 'Reset Password'
      const subheading = mode.val === 'signin' ? 'Connect your Forumline account to enable cross-forum DMs'
        : mode.val === 'signup' ? 'Create an account to start messaging across forums'
        : "Enter your email and we'll send you a reset link"

      const form = formTag({ class: 'auth-form__fields', onsubmit: (e: Event) => void handleSubmit(e) }) as HTMLFormElement

      if (mode.val === 'signup') {
        const usernameInput = createInput({ type: 'text', placeholder: 'Username', required: true, value: username.val })
        usernameInput.addEventListener('input', () => { username.val = usernameInput.value })
        form.appendChild(usernameInput)
      }

      const emailInput = createInput({ type: 'email', placeholder: 'Email', required: true, value: email.val })
      emailInput.addEventListener('input', () => { email.val = emailInput.value })
      form.appendChild(emailInput)

      if (mode.val !== 'forgot') {
        const pwInput = createInput({ type: 'password', placeholder: 'Password', required: true, minLength: 6, value: password.val })
        pwInput.addEventListener('input', () => { password.val = pwInput.value })
        form.appendChild(pwInput)
      }

      if (error.val) {
        form.appendChild(p({ class: 'text-sm text-error' }, error.val))
      }

      const submitText = loading.val
        ? (mode.val === 'signin' ? 'Signing in...' : mode.val === 'signup' ? 'Creating account...' : 'Sending...')
        : (mode.val === 'signin' ? 'Sign In' : mode.val === 'signup' ? 'Create Account' : 'Send Reset Link')

      form.appendChild(createButton({
        text: submitText,
        variant: 'primary',
        className: 'w-full',
        type: 'submit',
        disabled: loading.val,
      }))

      const container = div(
        h3({ class: 'auth-form__title' }, heading),
        p({ class: 'auth-form__subtitle' }, subheading),
        form,
      )

      if (mode.val === 'signin') {
        container.appendChild(btn({
          class: 'btn--link-muted mt-sm',
          onclick: () => { setMode('forgot') },
        }, 'Forgot password?'))
      }

      const toggleBtn = btn({
        class: 'btn--link text-sm mt-md',
        style: 'display:block',
        onclick: () => setMode(mode.val === 'signin' ? 'signup' : 'signin'),
      }, mode.val === 'signin' ? "Don't have an account? Create one" : 'Already have an account? Sign in')
      container.appendChild(toggleBtn)

      return container
    },
  )

  return { el: el as HTMLElement, destroy() {} }
}
