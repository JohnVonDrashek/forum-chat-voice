/*
 * Reactive store primitive (Van.js-backed)
 *
 * This file provides a minimal publish-subscribe state container backed by Van.js reactive state.
 *
 * It must:
 * - Hold a single state value readable synchronously via get() and reactively via .state.val
 * - Accept new state via set(), supporting both direct values and updater functions
 * - Notify all manual subscribers synchronously whenever state changes
 * - Provide a Van.js State object for reactive UI bindings
 * - Return an unsubscribe function from subscribe() for cleanup
 */
import van, { type State } from 'vanjs-core'

export type Subscriber<T> = (state: T) => void

export interface Store<T> {
  state: State<T>
  get: () => T
  set: (value: T | ((prev: T) => T)) => void
  subscribe: (fn: Subscriber<T>) => () => void
}

export function createStore<T>(initial: T): Store<T> {
  const state = van.state(initial) as State<T>
  const subs = new Set<Subscriber<T>>()

  return {
    state,
    get: () => state.val,
    set: (value) => {
      state.val = typeof value === 'function' ? (value as (prev: T) => T)(state.val) : value
      subs.forEach((fn) => fn(state.val))
    },
    subscribe: (fn) => {
      subs.add(fn)
      return () => { subs.delete(fn) }
    },
  }
}
