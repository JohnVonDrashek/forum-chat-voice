import path from 'path'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  const hubSupabaseUrl = (env.VITE_HUB_SUPABASE_URL || env.HUB_SUPABASE_URL || '').trim()
  const hubSupabaseAnonKey = (env.VITE_HUB_SUPABASE_ANON_KEY || env.HUB_SUPABASE_ANON_KEY || '').trim()

  return {
    base: '/',
    resolve: {
      // Always resolve to package source — ensures Vite bundles the latest
      // code from the monorepo rather than stale dist files.
      alias: {
        '@johnvondrashek/forumline-protocol': path.resolve(__dirname, '../packages/protocol/src/index.ts'),
        '@johnvondrashek/forumline-central-services-client': path.resolve(__dirname, '../packages/central-services-client/src/index.ts'),
        '@johnvondrashek/forumline-core': path.resolve(__dirname, '../packages/core/src/index.ts'),
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
            'vendor-supabase': ['@supabase/supabase-js'],
          },
        },
      },
    },
  }
})
