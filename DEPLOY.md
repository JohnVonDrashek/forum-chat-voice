# Deployment Guide

Both apps deploy via **GitHub Actions** on push to `main` → **self-hosted Proxmox LXCs** via SSH through Cloudflare Tunnel.

## Production URLs

- **Website**: https://forumline.net
- **Forum Demo**: https://demo.forumline.net
- **Forumline App**: https://app.forumline.net

## CI/CD

All deploy via GitHub Actions workflows:

- `.github/workflows/deploy-website.yml` — triggers on `website/` changes
- `.github/workflows/deploy-forum.yml` — triggers on `example-forum-instances-and-shared-forum-server/` changes
- `.github/workflows/deploy-forumline.yml` — triggers on `forumline-identity-and-federation-api/`, `forumline-identity-and-federation-web/`, or `published-npm-packages/` changes

Required GitHub secrets:
- `FORUM_SSH_KEY` — SSH key for production servers
- `SOPS_AGE_KEY` — age key for decrypting .env.enc files
- `GITHUB_PACKAGES_TOKEN` (automatically provided)

**Do NOT deploy manually.**

## LXC Setup

Each service runs on a Proxmox LXC with Docker, SSH access via Cloudflare Tunnel, and a public Cloudflare Tunnel route for the service.

### Website LXC (one-time setup)

1. Create a Proxmox LXC (Debian/Ubuntu, 512MB RAM is plenty)
2. Install Docker:
   ```bash
   curl -fsSL https://get.docker.com | sh
   ```
3. Set up the deploy directory and clone the repo:
   ```bash
   mkdir -p /opt/website
   git clone https://github.com/johnvondrashek/forumline.git /opt/website/repo
   ```
4. Add the deploy SSH public key to `/root/.ssh/authorized_keys`
5. Configure Cloudflare Tunnel routes:
   - `www-ssh.forumline.net` -> `ssh://localhost:22` (SSH access for deploys)
   - `forumline.net` -> `http://localhost:3000` (public website)
6. Test the deploy:
   ```bash
   cd /opt/website/repo && git pull origin main
   cp production-docker-compose-configs/website/docker-compose.yml /opt/website/docker-compose.yml
   cd /opt/website && docker compose up -d --build website
   ```

### Forum / Forumline LXCs

Same pattern — see existing LXC configs. Each uses `/opt/<service>/repo` and `/opt/<service>/docker-compose.yml`.

## Local Development

```bash
pnpm install                            # from root — sets up workspaces
cd forumline-identity-and-federation-api && docker compose up -d  # start Postgres + GoTrue
cd examples && go run ./forum-a/        # start forum backend
cd example-forum-instances-and-shared-forum-server/forum-a && pnpm dev         # start forum frontend
```

Create `example-forum-instances-and-shared-forum-server/forum-a/.env.local` and `forumline-identity-and-federation-api/.env.local` with the required env vars.
