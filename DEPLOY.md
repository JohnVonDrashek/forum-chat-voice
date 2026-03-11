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
- `CF_ACCESS_CLIENT_ID` — Cloudflare Access service token client ID
- `CF_ACCESS_CLIENT_SECRET` — Cloudflare Access service token client secret
- `TF_STATE_R2_ACCESS_KEY_ID` — R2 access key for OpenTofu state backend
- `TF_STATE_R2_SECRET_ACCESS_KEY` — R2 secret key for OpenTofu state backend
- `TF_CLOUDFLARE_API_TOKEN` — Cloudflare API token for tunnel/access management
- `TF_STATE_ENCRYPTION_PASSPHRASE` — passphrase for OpenTofu state encryption
- `GITHUB_PACKAGES_TOKEN` (automatically provided)

`.github/workflows/terraform-plan.yml` runs `tofu plan` on PRs that touch `terraform/`.

**Do NOT deploy manually.**

## Cloudflare Tunnel (Terraform)

Tunnel ingress and Zero Trust Access policies managed via OpenTofu in `terraform/`. Config lives in Cloudflare (remotely-managed). `cloudflared` runs with `--token` on `forum-prod` (CT 100) — no local config file.

**Managed resources:** tunnel ingress rules, Access applications for SSH endpoints, short-lived SSH CA certificates, service token for GitHub Actions deploys, developer email allow policies.

**Changing tunnel routes:**

```bash
cd terraform
AWS_ACCESS_KEY_ID=$(security find-generic-password -a access-key-id -s cloudflare-r2-terraform-state -w) \
AWS_SECRET_ACCESS_KEY=$(security find-generic-password -a secret-access-key -s cloudflare-r2-terraform-state -w) \
TF_VAR_cloudflare_api_token=$(security find-generic-password -a api-token -s cloudflare-tunnel-terraform -w) \
TF_VAR_state_encryption_passphrase=$(security find-generic-password -a passphrase -s tofu-state-encryption -w) \
tofu plan -var-file=prod.tfvars    # review changes
tofu apply -var-file=prod.tfvars   # apply — takes effect immediately, no restart
```

**State**: stored in Cloudflare R2 (`forumline-terraform-state` bucket), encrypted client-side via AES-GCM before upload.

**Rule ordering**: specific hostnames MUST come before `*.forumline.net` wildcard, or SSH routes break.

**Do NOT run `tofu destroy`** — `prevent_destroy` blocks it, but don't try to work around it.

## Short-Lived SSH Certificates

Developer SSH uses Cloudflare Access short-lived certificates — no long-lived SSH keys needed. After browser-based Access login, `cloudflared access ssh-gen` fetches an ephemeral cert (~4 min validity) signed by Cloudflare's CA. The `~/.ssh/config` `Match exec` directive handles this automatically.

Each LXC has the CA public key in `/etc/ssh/ca.pub` and trusts it via `TrustedUserCAKeys` in sshd_config. An `AuthorizedPrincipalsCommand` maps the cert principal (`johnvondrashek`, from the email prefix) to `root`.

**GitHub Actions still uses `FORUM_SSH_KEY`** — `cloudflared access ssh-gen` doesn't support service tokens, so CI/CD continues with traditional SSH key auth through the Access tunnel.

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
   git clone https://github.com/forumline/forumline.git /opt/website/repo
   ```
4. Add the deploy SSH public key to `/root/.ssh/authorized_keys`
5. Add tunnel routes in `terraform/tunnel.tf` and apply (see above)
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
