import { defineConfig } from 'vite'

const apiTarget = process.env.VITE_API_TARGET || 'http://localhost:3000'

export default defineConfig({
  base: '/',
  clearScreen: false,
  server: {
    host: true,
    strictPort: true,
    port: 5175,
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
        secure: apiTarget.startsWith('https'),
        configure: (proxy) => {
          // Disable buffering for SSE streams
          proxy.on('proxyRes', (proxyRes) => {
            if (proxyRes.headers['content-type']?.includes('text/event-stream')) {
              proxyRes.headers['cache-control'] = 'no-cache'
              proxyRes.headers['x-accel-buffering'] = 'no'
            }
          })
        },
      },
      '/auth': {
        target: apiTarget,
        changeOrigin: true,
        secure: apiTarget.startsWith('https'),
      },
    },
  },
})
