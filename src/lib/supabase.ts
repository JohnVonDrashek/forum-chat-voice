import { createClient } from '@supabase/supabase-js'
import type { Database } from '../types/database'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

// Simple in-memory mutex to replace navigator.locks (which deadlocks in
// production bundles) while still serializing token refresh operations.
const locks = new Map<string, Promise<unknown>>()
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function inMemoryLock(_name: string, acquireTimeout: number, fn: () => Promise<any>) {
  const name = _name
  const timeout = acquireTimeout > 0 ? acquireTimeout : 5000

  while (locks.has(name)) {
    const existing = locks.get(name)!
    const result = await Promise.race([
      existing.then(() => 'resolved' as const, () => 'resolved' as const),
      new Promise<'timeout'>(r => setTimeout(() => r('timeout'), timeout)),
    ])
    if (result === 'timeout') {
      // Previous lock holder hung — force-release so we can proceed
      locks.delete(name)
    }
  }
  const promise = fn()
  locks.set(name, promise)
  try {
    return await promise
  } finally {
    locks.delete(name)
  }
}

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    lock: inMemoryLock as any,
  },
} as any)
