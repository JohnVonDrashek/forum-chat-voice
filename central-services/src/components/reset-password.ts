import type { SupabaseClient } from '@supabase/supabase-js'
import { createButton, createInput } from './ui.js'

interface ResetPasswordOptions {
  supabase: SupabaseClient
  onComplete: () => void
}

export function createResetPassword({ supabase, onComplete }: ResetPasswordOptions) {
  let password = ''
  let confirmPassword = ''
  let error: string | null = null
  let loading = false
  let success = false

  const el = document.createElement('div')
  el.className = 'auth-page'

  function render() {
    el.innerHTML = ''

    const wrapper = document.createElement('div')
    wrapper.className = 'auth-form'

    if (success) {
      const icon = document.createElement('div')
      icon.className = 'success-icon'
      icon.innerHTML = `<svg fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>`
      wrapper.appendChild(icon)

      const h3 = document.createElement('h3')
      h3.className = 'auth-form__title'
      h3.textContent = 'Password Updated'
      wrapper.appendChild(h3)

      const p = document.createElement('p')
      p.className = 'auth-form__subtitle'
      p.textContent = 'Your password has been successfully reset. Redirecting...'
      wrapper.appendChild(p)

      el.appendChild(wrapper)
      return
    }

    const h3 = document.createElement('h3')
    h3.className = 'auth-form__title'
    h3.textContent = 'Set New Password'
    wrapper.appendChild(h3)

    const sub = document.createElement('p')
    sub.className = 'auth-form__subtitle'
    sub.textContent = 'Enter your new password below.'
    wrapper.appendChild(sub)

    const form = document.createElement('form')
    form.className = 'auth-form__fields'

    const pwInput = createInput({ type: 'password', placeholder: 'New password', required: true, minLength: 6, value: password })
    pwInput.addEventListener('input', () => { password = pwInput.value })
    form.appendChild(pwInput)

    const hint = document.createElement('p')
    hint.className = 'text-xs text-faint'
    hint.textContent = 'At least 6 characters'
    form.appendChild(hint)

    const confirmInput = createInput({ type: 'password', placeholder: 'Confirm new password', required: true, value: confirmPassword })
    confirmInput.addEventListener('input', () => { confirmPassword = confirmInput.value })
    form.appendChild(confirmInput)

    if (error) {
      const errEl = document.createElement('p')
      errEl.className = 'text-sm text-error'
      errEl.textContent = error
      form.appendChild(errEl)
    }

    form.appendChild(createButton({
      text: loading ? 'Updating...' : 'Update Password',
      variant: 'primary',
      className: 'w-full',
      type: 'submit',
      disabled: loading,
    }))

    form.addEventListener('submit', async (e) => {
      e.preventDefault()
      error = null

      if (password.length < 6) {
        error = 'Password must be at least 6 characters'
        render()
        return
      }
      if (password !== confirmPassword) {
        error = 'Passwords do not match'
        render()
        return
      }

      loading = true
      render()

      try {
        const { error: updateError } = await supabase.auth.updateUser({ password })
        if (updateError) throw updateError
        success = true
        render()
        setTimeout(() => onComplete(), 2000)
      } catch (err) {
        error = err instanceof Error ? err.message : String(err)
        loading = false
        render()
      }
    })

    wrapper.appendChild(form)
    el.appendChild(wrapper)
  }

  render()
  return { el, destroy() {} }
}
