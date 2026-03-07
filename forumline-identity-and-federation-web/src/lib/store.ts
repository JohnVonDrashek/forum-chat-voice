export type Subscriber<T> = (state: T) => void

export interface Store<T> {
  get: () => T
  set: (value: T | ((prev: T) => T)) => void
  subscribe: (fn: Subscriber<T>) => () => void
}

export function createStore<T>(initial: T): Store<T> {
  let state = initial
  const subs = new Set<Subscriber<T>>()

  return {
    get: () => state,
    set: (value) => {
      state = typeof value === 'function' ? (value as (prev: T) => T)(state) : value
      subs.forEach((fn) => fn(state))
    },
    subscribe: (fn) => {
      subs.add(fn)
      return () => { subs.delete(fn) }
    },
  }
}
