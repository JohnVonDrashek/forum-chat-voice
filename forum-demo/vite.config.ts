import path from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: '/',
  resolve: {
    // Always resolve to package source — ensures Vite bundles the latest
    // code from the monorepo rather than stale dist files.
    alias: {
      '@johnvondrashek/forumline-protocol': path.resolve(__dirname, '../packages/protocol/src/index.ts'),
      '@johnvondrashek/forumline-central-services-client': path.resolve(__dirname, '../packages/central-services-client/src/index.ts'),
      '@johnvondrashek/forumline-react': path.resolve(__dirname, '../packages/react/src/index.ts'),
      '@johnvondrashek/forumline-server-sdk': path.resolve(__dirname, '../packages/server-sdk/src/index.ts'),
    },
  },
  clearScreen: false,
  server: {
    host: true,
    strictPort: true,
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-query': ['@tanstack/react-query'],
        },
      },
    },
  },
})
