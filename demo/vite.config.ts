import path from 'path'
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

  return {
    plugins: [react(), tailwindcss()],
    base: '/',
    resolve: {
      alias: {
        '@forumline/protocol': path.resolve(__dirname, '../packages/protocol/src/index.ts'),
      },
    },
    clearScreen: false,
    server: {
      host: true,
      strictPort: true,
    },
    define: {
      'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(supabaseUrl),
      'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(supabaseAnonKey),
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            'vendor-react': ['react', 'react-dom', 'react-router-dom'],
            'vendor-supabase': ['@supabase/supabase-js'],
            'vendor-query': ['@tanstack/react-query'],
          },
        },
      },
    },
  }
})
