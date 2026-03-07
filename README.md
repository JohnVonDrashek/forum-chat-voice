# Forumline

A modern community platform combining threaded forums, real-time chat, and voice rooms — with cross-forum federation via a central identity service.

**Live demo**: [demo.forumline.net](https://demo.forumline.net)
**Forumline App**: [app.forumline.net](https://app.forumline.net)

## Why

Traditional forums lack real-time interaction. Chat apps lack structure. Forumline combines both with voice rooms and a federation layer that lets independent forum instances share identity and direct messaging.

## Stack

- **Forum Frontend** — Vanilla JS, Vite, TailwindCSS
- **Forumline App Frontend** — Vanilla TS, Vite
- **Backend** — Go API servers (Chi router), Postgres 17, GoTrue (self-hosted auth)
- **Realtime** — SSE via Postgres LISTEN/NOTIFY
- **Voice** — LiveKit
- **Storage** — Cloudflare R2 (avatars/images)
- **Native** — Tauri v2 (desktop, iOS, Android)
- **Deploy** — Self-hosted Proxmox LXCs, Docker Compose, Cloudflare Tunnel, GitHub Actions

## Monorepo Layout

| Directory | Description |
|-----------|-------------|
| `examples/forum-a/` | Example forum web app (Vite + vanilla JS) |
| `central-services/` | Forumline app — identity & federation registry (Vite + vanilla TS) |
| `go-services/` | Go API servers for forum (`cmd/forum/`) and forumline (`cmd/forumline/`) |
| `native-app/` | Tauri native app shell |
| `packages/protocol/` | Federation types (zero-dependency) |
| `packages/server-sdk/` | Protocol endpoint handler factories |
| `packages/central-services-client/` | Forumline API client |
| `packages/core/` | Shared utilities |

## Quick Start

```bash
# Install (links workspace packages)
npm install

# Start local Postgres + GoTrue
cd go-services && docker compose up -d

# Run the forum backend
cd go-services && go run ./cmd/forum/

# Run the forum frontend
cd examples/forum-a && npm run dev

# Run the forumline backend
cd go-services && go run ./cmd/forumline/

# Run the forumline frontend
cd central-services && npm run dev
```

Both apps require a `.env.local` — see `.env.example` in each directory.

## Scripts

```bash
npm run build          # Build all packages (via Turbo)
npm run dev:app        # Run central services dev server
npm run lint           # ESLint
npm run format         # Prettier
```

## Deployment

Both services are self-hosted on Proxmox LXCs with Docker Compose, exposed via Cloudflare Tunnel. Deploys are triggered automatically via GitHub Actions on push to `main`:

- **Forum** → `go-services/**` or `examples/forum-a/**` changes trigger [deploy-forum.yml](.github/workflows/deploy-forum.yml)
- **Forumline App** → `go-services/**`, `central-services/**`, or `packages/**` changes trigger [deploy-hub.yml](.github/workflows/deploy-hub.yml)

## License

All rights reserved — Forumline is not yet ready for public use. An open-source license will be added when it is. See [LICENSE](LICENSE).
