# Deployment Guide

Both apps deploy via **GitHub Actions** on push to `main` → **Fly.io**.

## Production URLs

- **Forum Demo**: https://demo.forumline.net (Go binary + SPA on Fly.io)
- **Central Services**: https://app.forumline.net (Go binary on Fly.io)
- **Voice**: LiveKit Cloud

## Architecture

- Go API server (Chi router) serves API routes + static SPA
- Fly Postgres for forum data
- Self-hosted GoTrue on Fly.io for auth
- Cloudflare R2 for avatar/image storage
- SSE realtime via Postgres LISTEN/NOTIFY

## CI/CD

Both deploy via GitHub Actions workflows:

- `.github/workflows/deploy-forum.yml` — triggers on `go-services/` or `packages/` changes
- `.github/workflows/deploy-hub.yml` — triggers on `central-services/` or `packages/` changes

Required GitHub secrets:
- `FLY_API_TOKEN`
- `VITE_AUTH_ANON_KEY` — GoTrue anonymous JWT
- `VITE_LIVEKIT_URL`
- `VITE_HUB_URL`
- `VITE_HUB_SUPABASE_URL`
- `VITE_HUB_SUPABASE_ANON_KEY`
- `VITE_SITE_URL`
- `GITHUB_PACKAGES_TOKEN` (automatically provided)

**Do NOT deploy manually** via Vercel CLI, Vercel dashboard, or `flyctl deploy`.

## Local Development

```bash
npm install        # from root — sets up workspaces
cd forum-demo && npm run dev
```

Create `forum-demo/.env.local` — see `forum-demo/.env.example` for required vars.

## LiveKit Setup

1. Create a LiveKit Cloud account at https://livekit.io
2. Create a new project
3. Copy the API credentials to your environment variables
