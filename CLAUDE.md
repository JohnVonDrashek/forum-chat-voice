# Forumline

## Testing

**Always test locally before pushing.** Run the full local stack and Playwright tests before committing/pushing.

### Local dev stack
```bash
# Start Postgres + GoTrue (Docker)
cd go-services && docker compose up -d

# Start Go forum server (port 3000)
cd go-services && export $(grep -v '^#' .env.local | xargs) && go run ./cmd/forum/

# Start Vite dev server (port 5174, proxies /api + /auth to localhost:3000)
cd examples/forum-a && pnpm dev

# Run Playwright tests locally
cd examples/forum-a && npx playwright test
```

The Vite proxy target defaults to `http://localhost:3000`. Override with `VITE_API_TARGET` env var.

### Testing against production
```bash
cd examples/forum-a && VITE_API_TARGET=https://demo.forumline.net PLAYWRIGHT_BASE_URL=https://demo.forumline.net npx playwright test
```

- **Demo**: https://demo.forumline.net
- **Forumline App**: https://app.forumline.net

Do NOT ignore bugs that you see even if they are unrelated to your changes. Jot them down and present them to the user at the conclusion of testing as potential next steps to fix.

## Deployment

Do NOT deploy packages manually. There are GitHub Actions for that.

Both projects deploy via GitHub Actions on push to main. Do NOT deploy manually.

- **Forumline Demo** (demo.forumline.net): `.github/workflows/deploy-forum.yml` — triggers on `go-services/` or `examples/forum-a/` changes
- **Forumline App** (app.forumline.net): `.github/workflows/deploy-hub.yml` — triggers on `go-services/`, `central-services/`, or `packages/` changes

Both deploy via SSH through Cloudflare Tunnel to self-hosted Proxmox LXCs running Docker Compose. The `FORUM_SSH_KEY` GitHub secret is required.

## Monorepo Structure

```
examples/
  forum-a/             — Example forum web app (Vite + vanilla JS)
central-services/      — Forumline App (Vite + vanilla TS)
go-services/           — Go API servers (forum + forumline)
native-app/            — Tauri native app (desktop, iOS, Android)
packages/
  protocol/                  — @johnvondrashek/forumline-protocol (federation types)
  server-sdk/                — @johnvondrashek/forumline-server-sdk (protocol endpoint handlers)
  central-services-client/   — @johnvondrashek/forumline-central-services-client (API client)
  core/                      — @johnvondrashek/forumline-core (shared utilities)
```

pnpm workspaces are configured via `pnpm-workspace.yaml` at root. Run `pnpm install` from root to link all packages.

### Package Details

- **@johnvondrashek/forumline-protocol** — Zero-dependency TypeScript types for the federation contract
- **@johnvondrashek/forumline-server-sdk** — Framework-agnostic handler factories (auth, notifications, unread) with `ForumlineServer` class
- **@johnvondrashek/forumline-central-services-client** — Headless HTTP client for cross-forum DMs (conversations, messages, profiles)
- **@johnvondrashek/forumline-core** — Shared utilities

## Infrastructure

Both apps are self-hosted on Proxmox LXCs with Docker Compose, exposed to the internet via Cloudflare Tunnel.

- **Forum LXC** (CT 100, `forum-prod`, 192.168.1.23): Postgres + GoTrue + Go forum server
- **Forumline LXC** (CT 101, `forumline-prod`, 192.168.1.99): Postgres + GoTrue + Go forumline server
- Dockerfiles at repo root: `Dockerfile.go-forum`, `Dockerfile.go-forumline`
- Local dev: `cd go-services && docker compose up -d` (Postgres + GoTrue) + `go run ./cmd/forum/` or `go run ./cmd/forumline/`

## Stack

- Vanilla JS + Vite + TailwindCSS (forum frontend)
- Vanilla TS + Vite (Forumline app frontend)
- Go API server (Chi router) for forum data + auth proxy
- Self-hosted Postgres 17 (forum + forumline databases)
- GoTrue v2.186.0 (self-hosted auth)
- Cloudflare R2 (avatar/image storage)
- SSE realtime via Postgres LISTEN/NOTIFY
- LiveKit (voice rooms)
- Cloudflare Tunnel + Docker Compose on Proxmox
