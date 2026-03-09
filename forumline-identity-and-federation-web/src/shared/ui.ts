/*
 * Shared UI component factories (Van.js)
 *
 * This file provides reusable, styled UI primitives used across the entire Forumline app.
 *
 * It must:
 * - Create styled buttons with consistent variants (primary, secondary, danger, ghost, etc.)
 * - Create styled text inputs with common options (placeholder, required, autofocus, etc.)
 * - Create card containers with consistent styling
 * - Create avatar elements that show a user's image or fall back to a DiceBear-generated avatar
 * - Create loading spinners in regular and small sizes
 * - Provide a toast notification system that stacks messages at the bottom of the screen
 * - Support error, success, and info toast variants with auto-dismiss
 */
import type { PropValueOrDerived } from 'vanjs-core'
import { tags } from './dom.js'

const { div, button, img, span } = tags

/** Create a styled button element. */
export function createButton(opts: {
  text?: string
  html?: string
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'icon' | 'link' | 'link-muted'
  className?: string
  disabled?: boolean
  type?: 'button' | 'submit'
  title?: string
  onClick?: (e: MouseEvent) => void
}): HTMLButtonElement {
  const variant = opts.variant ?? 'primary'
  const props: Record<string, PropValueOrDerived> = {
    type: opts.type ?? 'button',
    class: `btn btn--${variant}${opts.className ? ` ${opts.className}` : ''}`,
  }
  if (opts.disabled) props.disabled = true
  if (opts.title) props.title = opts.title
  if (opts.onClick) props.onclick = opts.onClick
  const btn = button(props) as HTMLButtonElement
  if (opts.text) btn.textContent = opts.text
  if (opts.html) btn.innerHTML = opts.html
  return btn
}

/** Create a styled text input element. */
export function createInput(opts?: {
  type?: string
  placeholder?: string
  value?: string
  required?: boolean
  minLength?: number
  className?: string
  autofocus?: boolean
}): HTMLInputElement {
  const props: Record<string, PropValueOrDerived> = {
    type: opts?.type ?? 'text',
    class: `input${opts?.className ? ` ${opts.className}` : ''}`,
  }
  if (opts?.placeholder) props.placeholder = opts.placeholder
  if (opts?.value) props.value = opts.value
  if (opts?.required) props.required = true
  if (opts?.minLength) props.minlength = opts.minLength
  if (opts?.autofocus) props.autofocus = true
  const el = tags.input(props) as HTMLInputElement
  return el
}

/** Create a styled card element. */
export function createCard(className?: string): HTMLDivElement {
  return div({ class: `card${className ? ` ${className}` : ''}` }) as HTMLDivElement
}

/** Create an avatar element (img with DiceBear fallback). */
export function createAvatar(opts: {
  avatarUrl?: string | null
  seed?: string
  size?: number
}): HTMLElement {
  const size = opts.size ?? 40
  const src = opts.avatarUrl || (opts.seed ? `https://api.dicebear.com/9.x/avataaars/svg?seed=${encodeURIComponent(opts.seed)}&size=256` : null)

  if (src) {
    return img({
      src,
      alt: '',
      loading: 'lazy',
      decoding: 'async',
      class: 'avatar',
      style: `width:${size}px;height:${size}px`,
    }) as HTMLElement
  }

  const el = div({
    class: 'avatar--placeholder',
    style: `width:${size}px;height:${size}px`,
  }) as HTMLElement
  el.innerHTML = `<svg fill="currentColor" viewBox="0 0 24 24"><path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"/></svg>`
  return el
}

/** Create a loading spinner. */
export function createSpinner(small?: boolean): HTMLDivElement {
  return div({ class: small ? 'spinner spinner--sm' : 'spinner' }) as HTMLDivElement
}

/** Show a toast notification. */
let toastContainer: HTMLElement | null = null

export function showToast(message: string, variant: 'error' | 'success' | 'info' = 'info', duration = 5000) {
  const logFn = variant === 'error' ? console.error : variant === 'success' ? console.log : console.info
  logFn(`[Toast:${variant}] ${message}`)

  if (!toastContainer) {
    toastContainer = div({ class: 'toast-container' }) as HTMLElement
    document.body.appendChild(toastContainer)
  }

  const icons: Record<string, string> = {
    error: '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>',
    success: '<circle cx="12" cy="12" r="10"/><path d="M9 12l2 2 4-4"/>',
    info: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>',
  }

  const toast = div({ class: `toast toast--${variant}` }) as HTMLElement
  toast.innerHTML = `
    <svg class="toast__icon" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${icons[variant]}</svg>
    <span class="toast__text">${message}</span>
  `
  toastContainer.appendChild(toast)

  setTimeout(() => {
    toast.style.opacity = '0'
    toast.style.transition = 'opacity 0.2s'
    setTimeout(() => toast.remove(), 200)
  }, duration)
}
