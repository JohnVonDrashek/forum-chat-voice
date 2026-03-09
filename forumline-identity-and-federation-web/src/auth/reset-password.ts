/*
 * Password reset form (Van.js)
 *
 * This file handles the "set new password" step after a user clicks a password recovery email link.
 *
 * It must:
 * - Show a form with new password and confirm password fields
 * - Validate that the password is at least 6 characters
 * - Validate that both password fields match before submission
 * - Show inline error messages for validation failures and API errors
 * - Show a loading state on the submit button during the API call
 * - Display a success confirmation screen after the password is updated
 * - Auto-redirect to the main app after a 2-second delay on success
 */
import type { GoTrueAuthClient } from './gotrue-auth.js'
import { tags, state, html } from '../shared/dom.js'
import { createButton, createInput } from '../shared/ui.js'

const { div, h3, p, form: formTag } = tags

interface ResetPasswordOptions {
  auth: GoTrueAuthClient
  onComplete: () => void
}

export function createResetPassword({ auth, onComplete }: ResetPasswordOptions) {
  const password = state('')
  const confirmPassword = state('')
  const error = state<string | null>(null)
  const loading = state(false)
  const success = state(false)

  async function handleSubmit(e: Event) {
    e.preventDefault()
    error.val = null

    if (password.val.length < 6) {
      error.val = 'Password must be at least 6 characters'
      return
    }
    if (password.val !== confirmPassword.val) {
      error.val = 'Passwords do not match'
      return
    }

    loading.val = true
    try {
      const { error: updateError } = await auth.updateUser({ password: password.val })
      if (updateError) throw updateError
      success.val = true
      setTimeout(() => onComplete(), 2000)
    } catch (err) {
      error.val = err instanceof Error ? err.message : String(err)
      loading.val = false
    }
  }

  const el = div({ class: 'auth-page' },
    () => {
      const wrapper = div({ class: 'auth-form' })

      if (success.val) {
        const icon = div({ class: 'success-icon' },
          html(`<svg fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>`),
        )
        wrapper.append(
          icon,
          h3({ class: 'auth-form__title' }, 'Password Updated'),
          p({ class: 'auth-form__subtitle' }, 'Your password has been successfully reset. Redirecting...'),
        )
        return wrapper
      }

      wrapper.append(
        h3({ class: 'auth-form__title' }, 'Set New Password'),
        p({ class: 'auth-form__subtitle' }, 'Enter your new password below.'),
      )

      const form = formTag({ class: 'auth-form__fields', onsubmit: handleSubmit }) as HTMLFormElement

      const pwInput = createInput({ type: 'password', placeholder: 'New password', required: true, minLength: 6, value: password.val })
      pwInput.addEventListener('input', () => { password.val = pwInput.value })
      form.appendChild(pwInput)

      form.appendChild(p({ class: 'text-xs text-faint' }, 'At least 6 characters') as HTMLElement)

      const confirmInput = createInput({ type: 'password', placeholder: 'Confirm new password', required: true, value: confirmPassword.val })
      confirmInput.addEventListener('input', () => { confirmPassword.val = confirmInput.value })
      form.appendChild(confirmInput)

      if (error.val) {
        form.appendChild(p({ class: 'text-sm text-error' }, error.val) as HTMLElement)
      }

      form.appendChild(createButton({
        text: loading.val ? 'Updating...' : 'Update Password',
        variant: 'primary',
        className: 'w-full',
        type: 'submit',
        disabled: loading.val,
      }))
      wrapper.appendChild(form)
      return wrapper
    },
  )

  return { el: el as HTMLElement, destroy() {} }
}
