/*
 * DOM utility helpers (Van.js)
 *
 * This file re-exports Van.js primitives and provides helpers for raw HTML insertion
 * and non-element event listeners.
 *
 * It must:
 * - Re-export Van.js for convenient access across the app
 * - Provide a helper to create DOM elements from raw HTML strings (SVG icons, etc.)
 * - Bind event listeners on non-element targets (window, document) with cleanup functions
 */
import van from 'vanjs-core'
import * as vanX from 'vanjs-ext'

export { van, vanX }
export const { add, state, derive } = van
export const tags = van.tags

/** Create a DOM element from a raw HTML string (e.g., SVG icons). */
export function html(s: string): Element {
  const t = document.createElement('template')
  t.innerHTML = s.trim()
  return t.content.firstElementChild!.cloneNode(true) as Element
}

/** Add an event listener, return a cleanup function. */
export function on(
  el: EventTarget,
  event: string,
  handler: EventListener,
  options?: AddEventListenerOptions,
): () => void {
  el.addEventListener(event, handler, options)
  return () => el.removeEventListener(event, handler, options)
}
