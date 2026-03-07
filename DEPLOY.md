# Deployment Guide

Both apps deploy via **GitHub Actions** on push to `main` → **self-hosted Proxmox LXCs** via SSH through Cloudflare Tunnel.

## Production URLs

- **Forum Demo**: https://demo.forumline.net
- **Forumline App**: https://app.forumline.net

## CI/CD

Both deploy via GitHub Actions workflows:

- `.github/workflows/deploy-forum.yml` — triggers on `examples/` changes
- `.github/workflows/deploy-forumline.yml` — triggers on `forumline-identity-and-federation-api/`, `forumline-identity-and-federation-web/`, or `packages/` changes

Required GitHub secrets:
- `FORUM_SSH_KEY` — SSH key for production servers
- `GITHUB_PACKAGES_TOKEN` (automatically provided)

**Do NOT deploy manually.**

## Local Development

```bash
pnpm install                            # from root — sets up workspaces
cd forumline-identity-and-federation-api && docker compose up -d  # start Postgres + GoTrue
cd examples && go run ./forum-a/        # start forum backend
cd examples/forum-a && pnpm dev         # start forum frontend
```

Create `examples/forum-a/.env.local` and `forumline-identity-and-federation-api/.env.local` with the required env vars.
