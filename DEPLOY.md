# Deployment Guide

Both apps deploy via **GitHub Actions** on push to `main` → **self-hosted Proxmox LXCs** via SSH through Cloudflare Tunnel.

## Production URLs

- **Forum Demo**: https://demo.forumline.net
- **Forumline App**: https://app.forumline.net

## CI/CD

Both deploy via GitHub Actions workflows:

- `.github/workflows/deploy-forum.yml` — triggers on `go-services/` or `examples/forum-a/` changes
- `.github/workflows/deploy-hub.yml` — triggers on `go-services/`, `central-services/`, or `packages/` changes

Required GitHub secrets:
- `FORUM_SSH_KEY` — SSH key for production servers
- `GITHUB_PACKAGES_TOKEN` (automatically provided)

**Do NOT deploy manually.** Do NOT run `flyctl deploy` or push Docker images directly.

## Local Development

```bash
pnpm install                          # from root — sets up workspaces
cd go-services && docker compose up -d  # start Postgres + GoTrue
cd go-services && go run ./cmd/forum/   # start forum backend
cd examples/forum-a && pnpm dev         # start forum frontend
```

Create `examples/forum-a/.env.local` and `go-services/.env.local` — see `.env.example` in each directory.
