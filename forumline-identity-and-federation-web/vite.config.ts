import path from 'path'
import { defineConfig } from 'vite'

export default defineConfig({
  base: '/',
  resolve: {
    // Always resolve to package source — ensures Vite bundles the latest
    // code from the monorepo rather than stale dist files.
    alias: {
      '@johnvondrashek/forumline-protocol': path.resolve(__dirname, '../published-npm-packages/protocol/src/index.ts'),
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
})
