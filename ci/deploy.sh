#!/usr/bin/env bash
# Deploy a service to production via direct LAN SSH.
# Called by GitHub Actions deploy workflows.
#
# Usage: ci/deploy.sh <service>
#
# Services: forumline, hosted, website, logs, auth, livekit
#
# Secrets are read from deploy/secrets.kdbx via ci/secrets.sh.
# The master password comes from KEEPASS_PASSWORD env var (CI)
# or macOS Keychain (local dev).

set -euo pipefail

SERVICE="${1:?Usage: ci/deploy.sh <service>}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# --- Website deploys to Cloudflare Pages (no LXC, no SSH) ---
if [ "$SERVICE" = "website" ]; then
  echo "=== Deploying website to Cloudflare Pages ==="
  CLOUDFLARE_API_TOKEN=$("$SCRIPT_DIR/secrets.sh" terraform | grep CLOUDFLARE_PAGES_TOKEN | cut -d= -f2-)
  CLOUDFLARE_ACCOUNT_ID="b4cf6ac20ef4cd693cd7a81113b8d031"
  export CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID
  npx wrangler pages deploy "$REPO_ROOT/services/website" \
    --project-name=forumline-website --branch=main
  echo "=== website deployed ==="
  exit 0
fi

declare -A HOSTS=(
  [forumline]="forumline-prod"
  [hosted]="hosted-prod"
  [logs]="logs-prod"
  [auth]="auth-prod"
  [livekit]="livekit-prod"
)

declare -A PATHS=(
  [forumline]="/opt/forumline"
  [hosted]="/opt/hosted"
  [logs]="/opt/logs"
  [auth]="/opt/auth"
  [livekit]="/opt/livekit"
)

# Map service name to KeePass group (services without secrets have no group)
declare -A SECRET_GROUPS=(
  [forumline]="forumline-prod"
  [hosted]="hosted-prod"
  [auth]="auth-prod"
  [livekit]="livekit-prod"
)

HOST="${HOSTS[$SERVICE]:?Unknown service: $SERVICE}"
REMOTE="${PATHS[$SERVICE]}"

echo "=== Deploying $SERVICE to $HOST ==="

# Generate and upload .env from KeePass secrets
if [ -n "${SECRET_GROUPS[$SERVICE]:-}" ]; then
  echo "Generating .env from secrets.kdbx..."
  "$SCRIPT_DIR/secrets.sh" "${SECRET_GROUPS[$SERVICE]}" /tmp/service.env
  scp /tmp/service.env "$HOST:$REMOTE/.env"
  rm -f /tmp/service.env
fi

# Upload docker-compose.yml
echo "Uploading docker-compose.yml..."
if [ "$SERVICE" = "logs" ]; then
  SRC_COMPOSE="services/logs/server/docker-compose.yml"
else
  SRC_COMPOSE="deploy/compose/$SERVICE/docker-compose.yml"
fi
scp "$SRC_COMPOSE" "$HOST:$REMOTE/docker-compose.yml"

# Upload extra config files
if [ "$SERVICE" = "logs" ]; then
  [ -f services/logs/server/loki-config.yml ] && scp services/logs/server/loki-config.yml "$HOST:$REMOTE/loki-config.yml"
  [ -f services/logs/server/users.yml ] && scp services/logs/server/users.yml "$HOST:$REMOTE/users.yml"
  # Clean up orphaned syslog logging driver config (from reverted a6665b3).
  # Only restarts Docker if the file actually exists. Waits for Docker to be ready.
  ssh "$HOST" 'if [ -f /etc/docker/daemon.json ]; then rm /etc/docker/daemon.json && systemctl restart docker && echo "Removed orphaned daemon.json, restarting Docker..." && while ! docker info >/dev/null 2>&1; do sleep 1; done && echo "Docker ready"; fi'
fi
if [ "$SERVICE" = "livekit" ]; then
  echo "Uploading livekit.yaml..."
  scp deploy/compose/livekit/livekit.yaml "$HOST:$REMOTE/livekit.yaml"
fi

# Pull latest code (skip for infrastructure-only LXCs — no repo)
if [ "$SERVICE" != "logs" ] && [ "$SERVICE" != "auth" ] && [ "$SERVICE" != "livekit" ]; then
  echo "Pulling latest code..."
  ssh "$HOST" "cd $REMOTE/repo && git fetch origin main && git reset --hard origin/main"
fi

# Run migrations for forumline
if [ "$SERVICE" = "forumline" ]; then
  echo "Running migrations..."
  ssh "$HOST" "cd $REMOTE && for f in repo/services/forumline-api/migrations/*.sql; do echo \"Applying: \$f\" && docker compose exec -T postgres psql -U postgres -d postgres < \"\$f\"; done"
fi

# Rebuild and restart
if [ "$SERVICE" = "auth" ] || [ "$SERVICE" = "logs" ] || [ "$SERVICE" = "livekit" ]; then
  echo "Pulling and restarting..."
  ssh "$HOST" "cd $REMOTE && docker compose pull && docker compose up -d --wait && docker compose ps"
  # Post-provision configuration (SMTP, etc.)
  if [ "$SERVICE" = "auth" ]; then
    echo "Running Zitadel post-deploy configuration..."
    "$SCRIPT_DIR/configure-zitadel.sh"
  fi
else
  echo "Building and restarting..."
  ssh "$HOST" "cd $REMOTE && docker compose up -d --build $SERVICE && docker compose ps"
fi

echo "=== $SERVICE deployed ==="
