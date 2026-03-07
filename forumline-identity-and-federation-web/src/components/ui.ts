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
  const btn = document.createElement('button')
  btn.type = opts.type ?? 'button'
  const variant = opts.variant ?? 'primary'
  btn.className = `btn btn--${variant}${opts.className ? ` ${opts.className}` : ''}`
  if (opts.text) btn.textContent = opts.text
  if (opts.html) btn.innerHTML = opts.html
  if (opts.disabled) btn.disabled = true
  if (opts.title) btn.title = opts.title
  if (opts.onClick) btn.addEventListener('click', opts.onClick)
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
  const input = document.createElement('input')
  input.type = opts?.type ?? 'text'
  input.className = `input${opts?.className ? ` ${opts.className}` : ''}`
  if (opts?.placeholder) input.placeholder = opts.placeholder
  if (opts?.value) input.value = opts.value
  if (opts?.required) input.required = true
  if (opts?.minLength) input.minLength = opts.minLength
  if (opts?.autofocus) input.autofocus = true
  return input
}

/** Create a styled card element. */
export function createCard(className?: string): HTMLDivElement {
  const div = document.createElement('div')
  div.className = `card${className ? ` ${className}` : ''}`
  return div
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
    const img = document.createElement('img')
    img.src = src
    img.alt = ''
    img.loading = 'lazy'
    img.decoding = 'async'
    img.className = 'avatar'
    img.style.width = `${size}px`
    img.style.height = `${size}px`
    return img
  }

  const div = document.createElement('div')
  div.className = 'avatar--placeholder'
  div.style.width = `${size}px`
  div.style.height = `${size}px`
  div.innerHTML = `<svg fill="currentColor" viewBox="0 0 24 24"><path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"/></svg>`
  return div
}

/** Create a loading spinner. */
export function createSpinner(small?: boolean): HTMLDivElement {
  const div = document.createElement('div')
  div.className = small ? 'spinner spinner--sm' : 'spinner'
  return div
}

/** Show a toast notification. */
let toastContainer: HTMLElement | null = null

export function showToast(message: string, variant: 'error' | 'success' | 'info' = 'info', duration = 5000) {
  const logFn = variant === 'error' ? console.error : variant === 'success' ? console.log : console.info
  logFn(`[Toast:${variant}] ${message}`)

  if (!toastContainer) {
    toastContainer = document.createElement('div')
    toastContainer.className = 'toast-container'
    document.body.appendChild(toastContainer)
  }

  const icons: Record<string, string> = {
    error: '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>',
    success: '<circle cx="12" cy="12" r="10"/><path d="M9 12l2 2 4-4"/>',
    info: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>',
  }

  const toast = document.createElement('div')
  toast.className = `toast toast--${variant}`
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
