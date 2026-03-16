import { defineConfig } from 'vite';
import { resolve } from 'path';

const isServe = process.argv.includes('serve') || process.argv.includes('dev');
const mode = process.env.VITE_BACKEND;

if (isServe && (!mode || !['prod', 'local'].includes(mode))) {
  console.error('\n\x1b[31m  ERROR: VITE_BACKEND is required.\x1b[0m\n');
  console.error('  \x1b[33mVITE_BACKEND=prod\x1b[0m  pnpm dev   — frontend-only changes, real production data');
  console.error('  \x1b[33mVITE_BACKEND=local\x1b[0m pnpm dev   — backend changes, needs local Docker stack\n');
  process.exit(1);
}

const backend = mode === 'prod'
  ? 'https://app.forumline.net'
  : 'http://localhost:4001';

export default defineConfig({
  root: '.',
  publicDir: 'public',
  resolve: {
    alias: {
      '@forumline/client-sdk': resolve(__dirname, '../../packages/client-sdk/src/index.js'),
    },
  },
  build: {
    outDir: 'dist',
  },
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: backend, changeOrigin: true },
    },
  },
});
