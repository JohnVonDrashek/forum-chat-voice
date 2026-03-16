#!/usr/bin/env bash
# Deploy Vector log agents to all service LXCs.
# Substitutes LOGS_HOST_LABEL per host and restarts Vector.
# Continues deploying to remaining hosts if one is unreachable.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

declare -A AGENT_HOSTS=(
  [forumline-prod]="192.168.1.99"
  [hosted-prod]="192.168.1.107"
  [livekit-prod]="192.168.1.111"
  [auth-prod]="192.168.1.110"
)

FAILED=()

for HOST_LABEL in "${!AGENT_HOSTS[@]}"; do
  LXC_IP="${AGENT_HOSTS[$HOST_LABEL]}"
  echo "=== Deploying Vector agent to $HOST_LABEL ($LXC_IP) ==="

  # Substitute host label in vector.toml
  sed "s/\${LOGS_HOST_LABEL}/$HOST_LABEL/g" \
    "$REPO_ROOT/services/logs/agent/vector.toml" > /tmp/vector.toml

  if ! ssh -o ConnectTimeout=5 "root@$LXC_IP" "mkdir -p /opt/logs-agent" 2>&1; then
    echo "::warning::$HOST_LABEL ($LXC_IP): unreachable, skipping"
    FAILED+=("$HOST_LABEL")
    continue
  fi

  # Clean up orphaned syslog daemon.json if present (from reverted a6665b3)
  ssh "root@$LXC_IP" 'if [ -f /etc/docker/daemon.json ]; then rm /etc/docker/daemon.json && systemctl restart docker && echo "Removed orphaned daemon.json, restarting Docker..." && while ! docker info >/dev/null 2>&1; do sleep 1; done && echo "Docker ready"; fi'

  scp "$REPO_ROOT/services/logs/agent/docker-compose.yml" "root@$LXC_IP:/opt/logs-agent/docker-compose.yml"
  scp /tmp/vector.toml "root@$LXC_IP:/opt/logs-agent/vector.toml"
  ssh "root@$LXC_IP" "cd /opt/logs-agent && docker compose pull && docker compose up -d --wait"

  echo "$HOST_LABEL: Vector agent running"
done

rm -f /tmp/vector.toml

if [ ${#FAILED[@]} -gt 0 ]; then
  echo "=== WARNING: Failed hosts: ${FAILED[*]} ==="
  exit 1
fi

echo "=== All Vector agents deployed ==="
