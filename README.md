# Forumline

A modern community platform combining threaded forums, real-time chat, and voice rooms — with cross-forum federation via a central identity service.

**Live demo**: [demo.forumline.net](https://demo.forumline.net)

## Why

Traditional forums lack real-time interaction. Chat apps lack structure. Forumline combines both with voice rooms and a federation layer that lets independent forum instances share identity and direct messaging.

## Stack

- **Frontend** — React 19, Vite, TailwindCSS
- **Forum Backend** — Go API server, Fly Postgres, GoTrue (self-hosted auth), Cloudflare R2 (avatars), SSE realtime
- **Hub Backend** — Supabase (auth, Postgres, realtime)
- **Voice** — LiveKit
- **Native** — Tauri (desktop, iOS, Android)
- **Deploy** — Fly.io + Docker + GitHub Actions

## Monorepo Layout

| Directory | Description |
|-----------|-------------|
| `forum-demo/` | Forum web app (Vite + React) |
| `central-services/` | Identity & federation registry service |
| `native-app/` | Tauri native app shell |
| `packages/protocol/` | Federation types (zero-dependency) |
| `packages/server-sdk/` | Protocol endpoint handler factories |
| `packages/central-services-client/` | Headless hub API client |
| `packages/react/` | Providers, components, and hooks |

## Quick Start

```bash
# Install (links workspace packages)
npm install

# Run the forum
cd forum-demo && npm run dev

# Run central services
cd central-services && npm run dev
```

Both apps require a `.env.local` — see `.env.example` in each directory.

## Scripts

```bash
npm run build:packages   # Build all packages in dependency order
npm run tauri:dev         # Run native desktop app
npm run lint              # ESLint
npm run format            # Prettier
```

## Deployment

Both services deploy automatically via GitHub Actions on push to `main`:

- **Forum** → `forum-demo/**` changes trigger [deploy-forum.yml](.github/workflows/deploy-forum.yml)
- **Central Services** → `central-services/**` changes trigger [deploy-hub.yml](.github/workflows/deploy-hub.yml)

## License

All rights reserved — Forumline is not yet ready for public use. An open-source license will be added when it is. See [LICENSE](LICENSE).
