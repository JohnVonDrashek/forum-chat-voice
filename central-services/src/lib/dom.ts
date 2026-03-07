/** Create an HTML element with optional attributes and children. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Record<string, string | boolean | number | EventListener | null | undefined>,
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)

  if (attrs) {
    for (const [key, val] of Object.entries(attrs)) {
      if (val == null || val === false) continue
      if (key.startsWith('on') && typeof val === 'function') {
        el.addEventListener(key.slice(2).toLowerCase(), val as EventListener)
      } else if (val === true) {
        el.setAttribute(key, '')
      } else {
        el.setAttribute(key, String(val))
      }
    }
  }

  for (const child of children) {
    el.append(typeof child === 'string' ? document.createTextNode(child) : child)
  }

  return el
}

/** Add an event listener, return a cleanup function. */
export function on<K extends keyof HTMLElementEventMap>(
  el: EventTarget,
  event: K,
  handler: (e: HTMLElementEventMap[K]) => void,
  options?: AddEventListenerOptions,
): () => void {
  el.addEventListener(event, handler as EventListener, options)
  return () => el.removeEventListener(event, handler as EventListener, options)
}

/** Set classes on an element. Accepts a record of class → boolean. */
export function cls(el: HTMLElement, classes: Record<string, boolean>) {
  for (const [name, active] of Object.entries(classes)) {
    if (name.includes(' ')) {
      // Handle space-separated classes
      for (const c of name.split(' ').filter(Boolean)) {
        el.classList.toggle(c, active)
      }
    } else {
      el.classList.toggle(name, active)
    }
  }
}
