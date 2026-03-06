import path from 'path'
import { defineConfig } from 'vite'

export default defineConfig({
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
    proxy: {
      '/api': 'http://localhost:4001',
      '/auth': 'http://localhost:4001',
    },
  },
  build: {
    rollupOptions: {
      external: (id) => id.startsWith('@tauri-apps/'),
    },
  },
})
