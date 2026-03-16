#!/usr/bin/env bash
# Deploy Vector log agents to all service LXCs.
# Substitutes LOGS_HOST_LABEL per host and restarts Vector.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

declare -A AGENT_HOSTS=(
  [forumline-prod]="192.168.1.99"
  [hosted-prod]="192.168.1.107"
  [livekit-prod]="192.168.1.111"
  [auth-prod]="192.168.1.110"
)

for HOST_LABEL in "${!AGENT_HOSTS[@]}"; do
  LXC_IP="${AGENT_HOSTS[$HOST_LABEL]}"
  echo "=== Deploying Vector agent to $HOST_LABEL ($LXC_IP) ==="

  # Substitute host label in vector.toml
  sed "s/\${LOGS_HOST_LABEL}/$HOST_LABEL/g" \
    "$REPO_ROOT/services/logs/agent/vector.toml" > /tmp/vector.toml

  ssh "root@$LXC_IP" "mkdir -p /opt/logs-agent"
  scp "$REPO_ROOT/services/logs/agent/docker-compose.yml" "root@$LXC_IP:/opt/logs-agent/docker-compose.yml"
  scp /tmp/vector.toml "root@$LXC_IP:/opt/logs-agent/vector.toml"
  ssh "root@$LXC_IP" "cd /opt/logs-agent && docker compose pull && docker compose up -d --wait"

  echo "$HOST_LABEL: Vector agent running"
done

rm -f /tmp/vector.toml
echo "=== All Vector agents deployed ==="
