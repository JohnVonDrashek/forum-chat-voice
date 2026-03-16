# Deployment Guide

CI/CD runs on **GitHub Actions** with two self-hosted runners on Proxmox (CT 109). Deploy workflows in `.github/workflows/`, deploy script at `ci/deploy.sh`.

## Production URLs

- **Website**: https://forumline.net
- **Forumline App**: https://app.forumline.net
- **Hosted Forums**: https://hosted.forumline.net (*.forumline.net)
- **Auth (Zitadel)**: https://auth.forumline.net

## Architecture

```
GitHub push → GHA workflow → self-hosted runner (CT 109) → SSH to LXC → docker compose up
```

## CI/CD Pipelines (GitHub Actions)

Workflows in `.github/workflows/`. Runners execute on CT 109 with direct LAN access to all LXCs.

| Pipeline | Trigger | Description |
|----------|---------|-------------|
| `lint` | push, PR | Run lefthook checks (Go lint, tests, ESLint, gitleaks) |
| `deploy-forumline` | `services/forumline-api/**`, `services/forumline-web/**`, `packages/**` | Deploy Forumline app |
| `deploy-hosted` | `services/hosted/**`, `packages/backend/**` | Deploy hosted forum platform |
| `deploy-website` | `services/website/**` | Deploy static website |
| `deploy-logs` | `services/logs/server/**` | Deploy central VictoriaLogs |
| `deploy-auth` | `deploy/compose/auth/**` | Deploy Zitadel auth |
| `deploy-logs-agents` | `services/logs/agent/**` | Deploy Vector agents to all LXCs |
| `publish-packages` | `packages/frontend/**` | Publish TS packages to GitHub Packages |
| `terraform-plan` | PR touching `deploy/terraform/` | Run OpenTofu plan |
| `terraform-apply` | manual | Run OpenTofu apply |

Deploy logic lives in `ci/deploy.sh` — generates `.env` from `secrets.kdbx`, SCPs to LXC, rebuilds.

## Secrets

All secrets live in `secrets.kdbx` (KeePass, AES-256 encrypted) at the repo root. The master password is stored as the `KEEPASS_PASSWORD` GitHub Actions secret. See `ci/secrets.sh` for the helper script.

## GitHub Actions Runners

Two self-hosted runners on CT 109 (192.168.1.112). Registered at the repo level with labels `self-hosted,linux,x64,forumline`. Tools installed: Go, pnpm, keepassxc-cli, Docker, golangci-lint.

## Cloudflare Tunnel (Terraform)

Tunnel ingress and Zero Trust Access policies managed via OpenTofu in `deploy/terraform/`. Config lives in Cloudflare (remotely-managed). `cloudflared` runs with `--token` on the Proxmox host — no local config file.

**Managed resources:** tunnel ingress rules, Access applications for SSH endpoints, short-lived SSH CA certificates, service token for GitHub Actions deploys, developer email allow policies.

**Changing tunnel routes:**

```bash
cd deploy/terraform
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
5. Add tunnel routes in `deploy/terraform/tunnel.tf` and apply (see above)
6. Test the deploy:
   ```bash
   cd /opt/website/repo && git pull origin main
   cp deploy/compose/website/docker-compose.yml /opt/website/docker-compose.yml
   cd /opt/website && docker compose up -d --build website
   ```

### Forumline / Hosted LXCs

Same pattern — see existing LXC configs. Each uses `/opt/<service>/repo` and `/opt/<service>/docker-compose.yml`.

## Local Development

```bash
pnpm install                                          # from root — sets up workspaces
cd services/zitadel && docker compose up -d           # start local Zitadel + Postgres
cd services/forumline-web && VITE_BACKEND=local pnpm dev  # start forumline frontend
```

Create `services/forumline-api/.env.local` with the required env vars.
