import { createClient, SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../types/database'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const isConfigured = Boolean(supabaseUrl && supabaseAnonKey)

// Only create client if configured, otherwise use a dummy that won't be called
let supabase: SupabaseClient<Database>

if (isConfigured) {
  supabase = createClient<Database>(supabaseUrl!, supabaseAnonKey!)
} else {
  console.warn(
    'Supabase credentials not found. Running in demo mode.\n' +
    'Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.local'
  )
  // Create a mock client that won't throw - all calls will be guarded by isConfigured
  supabase = new Proxy({} as SupabaseClient<Database>, {
    get: () => () => Promise.resolve({ data: null, error: null })
  })
}

export { supabase }
