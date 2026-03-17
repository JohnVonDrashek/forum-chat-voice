# Forumline

A modern community platform combining threaded forums, real-time chat, and voice rooms — with cross-forum federation via a central identity service.

**Forumline App**: [app.forumline.net](https://app.forumline.net)
**Hosted Forums**: [hosted.forumline.net](https://hosted.forumline.net)

## Why

Traditional forums lack real-time interaction. Chat apps lack structure. Forumline combines both with voice rooms and a federation layer that lets independent forum instances share identity and direct messaging.

## Stack

- **Forum Frontend** — Vanilla JS, Vite, TailwindCSS
- **Forumline App Frontend** — Vanilla TS, Vite
- **Backend** — Go API servers (Chi router), Postgres 17, Zitadel (self-hosted OIDC auth)
- **Realtime** — SSE via Postgres LISTEN/NOTIFY
- **Voice** — LiveKit
- **Storage** — Cloudflare R2 (avatars/images)
- **Deploy** — Self-hosted Proxmox LXCs, Docker Compose, Cloudflare Tunnel, GitHub Actions

## Monorepo Layout

| Directory | Description |
|-----------|-------------|
| `packages/frontend/protocol/` | Federation types (zero-dependency) |
| `packages/frontend/server-sdk/` | Protocol endpoint handler factories |
| `packages/frontend/client-sdk/` | Browser API client, auth, realtime streams |
| `packages/backend/` | Go backend packages (auth, db, httpkit, sse, valkey) |
| `services/forumline-api/` | Forumline Go API server (`cmd/forumline/`) |
| `services/forumline-web/` | Forumline app — identity & federation registry (Vite + vanilla TS) |
| `services/hosted/` | Multi-tenant hosted forum platform (Go backend + vanilla JS frontend) |
| `services/website/` | Static website (forumline.net) |
| `deploy/` | Dockerfiles, compose configs, Terraform |
| `tools/` | Cloudflare status worker |

## Quick Start

```bash
# Install (links workspace packages)
pnpm install

# Start local Postgres + Zitadel
cd services/zitadel && docker compose up -d

# Run the forumline backend
cd services/forumline-api && go run ./cmd/forumline/

# Run the forumline frontend
cd services/forumline-web && pnpm dev
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

All services are self-hosted on Proxmox LXCs with Docker Compose, exposed via Cloudflare Tunnel. CI/CD runs on GitHub Actions with self-hosted runners. Secrets managed via KeePass (`secrets.kdbx`).

## License

All rights reserved — Forumline is not yet ready for public use. An open-source license will be added when it is. See [LICENSE](LICENSE).
