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
