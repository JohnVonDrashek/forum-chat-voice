import { defineConfig } from 'vite';

const isServe = process.argv.includes('serve') || process.argv.includes('dev');
const mode = process.env.VITE_BACKEND;

if (isServe && (!mode || !['prod', 'local'].includes(mode))) {
  console.error('\n\x1b[31m  ERROR: VITE_BACKEND is required.\x1b[0m\n');
  console.error(
    '  \x1b[33mVITE_BACKEND=prod\x1b[0m  pnpm dev   — frontend-only changes, real production data',
  );
  console.error(
    '  \x1b[33mVITE_BACKEND=local\x1b[0m pnpm dev   — backend changes, needs local Docker stack\n',
  );
  process.exit(1);
}

const backend = mode === 'prod' ? 'https://app.forumline.net' : 'http://localhost:4001';

export default defineConfig({
  root: '.',
  publicDir: 'public',
  build: {
    outDir: 'dist',
    sourcemap: 'hidden', // generates .map files but doesn't add //# sourceMappingURL to bundles
  },
  plugins: [
    {
      name: 'inject-runtime-config',
      transformIndexHtml(html) {
        // In production the Go server injects this; in dev we do it here
        return html.replace(
          '</head>',
          `<script>window.ZITADEL_CLIENT_ID="364146623619530755";</script>\n</head>`,
        );
      },
    },
  ],
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: backend, changeOrigin: true },
    },
  },
});
