import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // loadEnv with '' prefix loads ALL env vars from .env files + process.env.
  // Vercel's Supabase Marketplace sets SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY
  // (plus NEXT_PUBLIC_ variants). Vite only exposes VITE_-prefixed vars to the
  // client, so we bridge all known naming conventions here.
  const env = loadEnv(mode, process.cwd(), '')

  // Log which Supabase env vars are available (values masked for security)
  const supabaseEnvVars = [
    'VITE_SUPABASE_URL', 'SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL',
    'VITE_SUPABASE_ANON_KEY', 'SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEY',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  ]
  console.log('[vite] Supabase env vars:',
    supabaseEnvVars.map(k => `${k}=${env[k] ? 'SET' : 'unset'}`).join(', '))

  const supabaseUrl = (
    env.VITE_SUPABASE_URL || env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || ''
  ).trim()
  const supabaseAnonKey = (
    env.VITE_SUPABASE_ANON_KEY
      || env.SUPABASE_ANON_KEY
      || env.SUPABASE_PUBLISHABLE_KEY
      || env.NEXT_PUBLIC_SUPABASE_ANON_KEY
      || env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
      || ''
  ).trim()

  console.log(`[vite] Resolved: URL=${supabaseUrl ? 'SET' : 'MISSING'}, KEY=${supabaseAnonKey ? 'SET' : 'MISSING'}`)

  return {
    plugins: [react(), tailwindcss()],
    base: '/',
    define: {
      'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(supabaseUrl),
      'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(supabaseAnonKey),
    },
  }
})
