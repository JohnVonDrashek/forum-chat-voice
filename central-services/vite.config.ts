import path from 'path'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  const hubSupabaseUrl = (env.VITE_HUB_SUPABASE_URL || env.HUB_SUPABASE_URL || '').trim()
  const hubSupabaseAnonKey = (env.VITE_HUB_SUPABASE_ANON_KEY || env.HUB_SUPABASE_ANON_KEY || '').trim()

  return {
    plugins: [react(), tailwindcss()],
    base: '/',
    resolve: {
      // Always alias to monorepo package source so builds stay in sync
      // without needing to publish packages first.
      alias: {
        '@johnvondrashek/forumline-protocol': path.resolve(__dirname, '../packages/protocol/src/index.ts'),
        '@johnvondrashek/forumline-central-services-client': path.resolve(__dirname, '../packages/central-services-client/src/index.ts'),
        '@johnvondrashek/forumline-react': path.resolve(__dirname, '../packages/react/src/index.ts'),
      },
    },
    clearScreen: false,
    server: {
      host: true,
      port: 5173,
      strictPort: true,
    },
    define: {
      'import.meta.env.VITE_HUB_SUPABASE_URL': JSON.stringify(hubSupabaseUrl),
      'import.meta.env.VITE_HUB_SUPABASE_ANON_KEY': JSON.stringify(hubSupabaseAnonKey),
    },
    build: {
      rollupOptions: {
        external: (id) => id.startsWith('@tauri-apps/'),
        output: {
          manualChunks: {
            'vendor-react': ['react', 'react-dom'],
            'vendor-supabase': ['@supabase/supabase-js'],
            'vendor-query': ['@tanstack/react-query'],
          },
        },
      },
    },
  }
})
