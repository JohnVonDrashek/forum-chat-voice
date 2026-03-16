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
| `deploy-hosted` | `services/hosted/**`, `packages/shared-go/**` | Deploy hosted forum platform |
| `deploy-website` | `services/website/**` | Deploy static website |
| `deploy-logs` | `deploy/compose/logs/**` | Deploy VictoriaLogs + configure Docker syslog on all LXCs |
| `deploy-auth` | `deploy/compose/auth/**` | Deploy Zitadel auth |
| `ensure-fleet-sync` | every push to `main` | Install/update fleet sync on Proxmox (SSH keys + syslog for all LXCs) |
| `publish-packages` | `packages/**` | Publish TS packages to GitHub Packages |
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

Each service runs on a Proxmox LXC. New LXCs are **automatically configured** by the fleet sync — a systemd timer on the Proxmox host that runs every 5 minutes and ensures all running LXCs have:
- CI runner SSH deploy key (for GitHub Actions deploys)
- Docker syslog logging → VictoriaLogs

### Adding a new service LXC

1. Create a Proxmox LXC (Debian/Ubuntu) and start it
2. Install Docker: `pct exec <ctid> -- bash -c 'curl -fsSL https://get.docker.com | sh'`
3. Fleet sync handles the rest automatically (SSH key, syslog config) — wait 5 min or force: `systemctl start forumline-fleet-sync`
4. Add tunnel routes in `deploy/terraform/tunnel.tf` and apply
5. Add to `ci/deploy.sh` HOSTS/PATHS/SECRET_GROUPS maps
6. Create `.github/workflows/deploy-<service>.yml`

### Fleet sync

Fully automatic — the `ensure-fleet-sync` workflow runs on every push to `main` and installs/updates the fleet sync timer on the Proxmox host if needed. No manual setup required. Source in `deploy/proxmox/`, config lives at `/etc/forumline/` on Proxmox.

```bash
# On Proxmox — check status or force a sync:
systemctl status forumline-fleet-sync.timer
systemctl start forumline-fleet-sync
journalctl -u forumline-fleet-sync
```

## Local Development

```bash
pnpm install                                          # from root — sets up workspaces
cd services/zitadel && docker compose up -d           # start local Zitadel + Postgres
cd services/forumline-web && VITE_BACKEND=local pnpm dev  # start forumline frontend
```

Create `services/forumline-api/.env.local` with the required env vars.
