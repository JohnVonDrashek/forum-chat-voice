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
| `examples/forum-a/` | Example forum — web frontend + Go backend entrypoint (Vite + vanilla JS) |
| `examples/forum-b/` | Example forum — gothic theme (Vite + vanilla JS) |
| `examples/forum/` | Shared Go forum handlers and routes |
| `examples/shared/` | Shared Go infrastructure (db, auth, SSE, middleware) |
| `forumline-identity-and-federation-web/` | Forumline app — identity & federation registry (Vite + vanilla TS) |
| `forumline-identity-and-federation-api/` | Forumline Go API server (`cmd/forumline/`) |
| `desktop-and-mobile-tauri-apps/` | Tauri native app (desktop, iOS, Android) |
| `packages/protocol/` | Federation types (zero-dependency) |
| `packages/server-sdk/` | Protocol endpoint handler factories |

## Quick Start

```bash
# Install (links workspace packages)
pnpm install

# Start local Postgres + GoTrue
cd forumline-identity-and-federation-api && docker compose up -d

# Run the forum backend
cd examples && go run ./forum-a/

# Run the forum frontend
cd examples/forum-a && pnpm dev

# Run the forumline backend
cd forumline-identity-and-federation-api && go run ./cmd/forumline/

# Run the forumline frontend
cd forumline-identity-and-federation-web && pnpm dev
```

Both apps require a `.env.local` — see `.env.example` in each directory.

## Scripts

```bash
pnpm build          # Build all packages (via Turbo)
pnpm dev:app        # Run central services dev server
pnpm lint           # ESLint
pnpm format         # Prettier
```

## Deployment

Both services are self-hosted on Proxmox LXCs with Docker Compose, exposed via Cloudflare Tunnel. Deploys are triggered automatically via GitHub Actions on push to `main`:

- **Forum** → `examples/**` changes trigger [deploy-forum.yml](.github/workflows/deploy-forum.yml)
- **Forumline App** → `forumline-identity-and-federation-api/**`, `forumline-identity-and-federation-web/**`, or `packages/**` changes trigger [deploy-forumline.yml](.github/workflows/deploy-forumline.yml)

## License

All rights reserved — Forumline is not yet ready for public use. An open-source license will be added when it is. See [LICENSE](LICENSE).
