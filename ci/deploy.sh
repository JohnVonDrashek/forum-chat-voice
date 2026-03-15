#!/usr/bin/env bash
# Deploy a service to production via direct LAN SSH.
# Called by Woodpecker CI pipelines.
#
# Usage: ci/deploy.sh <service>
#
# Services: forumline, hosted, website, logs, auth
#
# Secrets are read from deploy/secrets.kdbx via ci/secrets.sh.
# The master password comes from KEEPASS_PASSWORD env var (CI)
# or macOS Keychain (local dev).

set -euo pipefail

SERVICE="${1:?Usage: ci/deploy.sh <service>}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

declare -A HOSTS=(
  [forumline]="forumline-prod"
  [hosted]="hosted-prod"
  [website]="website-prod"
  [logs]="logs-prod"
  [auth]="auth-prod"
)

declare -A PATHS=(
  [forumline]="/opt/forumline"
  [hosted]="/opt/hosted"
  [website]="/opt/website"
  [logs]="/opt/logs"
  [auth]="/opt/auth"
)

# Map service name to KeePass group (services without secrets have no group)
declare -A SECRET_GROUPS=(
  [forumline]="forumline-prod"
  [hosted]="hosted-prod"
  [auth]="auth-prod"
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
scp "deploy/compose/$SERVICE/docker-compose.yml" "$HOST:$REMOTE/docker-compose.yml"

# Upload extra config files for logs service
if [ "$SERVICE" = "logs" ]; then
  [ -f deploy/compose/logs/loki-config.yml ] && scp deploy/compose/logs/loki-config.yml "$HOST:$REMOTE/loki-config.yml"
  [ -f deploy/compose/logs/users.yml ] && scp deploy/compose/logs/users.yml "$HOST:$REMOTE/users.yml"
fi

# Pull latest code (skip for logs and auth — no repo on those LXCs)
if [ "$SERVICE" != "logs" ] && [ "$SERVICE" != "auth" ]; then
  echo "Pulling latest code..."
  ssh "$HOST" "cd $REMOTE/repo && git fetch origin main && git reset --hard origin/main"
fi

# Run migrations for forumline
if [ "$SERVICE" = "forumline" ]; then
  echo "Running migrations..."
  ssh "$HOST" "cd $REMOTE && for f in repo/services/forumline-api/migrations/*.sql; do echo \"Applying: \$f\" && docker compose exec -T postgres psql -U postgres -d postgres < \"\$f\"; done"
fi

# Rebuild and restart
if [ "$SERVICE" = "auth" ] || [ "$SERVICE" = "logs" ]; then
  echo "Pulling and restarting..."
  ssh "$HOST" "cd $REMOTE && docker compose pull && docker compose up -d --wait && docker compose ps"
else
  echo "Building and restarting..."
  ssh "$HOST" "cd $REMOTE && docker compose up -d --build $SERVICE && docker compose ps"
fi

echo "=== $SERVICE deployed ==="
