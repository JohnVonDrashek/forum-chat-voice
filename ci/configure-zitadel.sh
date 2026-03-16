#!/usr/bin/env bash
# Configure Zitadel instance after deploy (SMTP, etc).
# Idempotent — safe to run multiple times.
#
# Usage: ci/configure-zitadel.sh
#
# Requires: ZITADEL_SERVICE_USER_PAT and RESEND_API_KEY in secrets.kdbx

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ZITADEL_URL="${ZITADEL_URL:-https://auth.forumline.net}"

# --- Resolve secrets ---
if [ -n "${KEEPASS_PASSWORD:-}" ]; then
  MASTER="$KEEPASS_PASSWORD"
else
  MASTER=$(security find-generic-password -a master -s forumline-secrets -w)
fi
SECRETS_KDBX="$(cd "$SCRIPT_DIR/.." && pwd)/secrets.kdbx"

get_secret() {
  printf '%s\n' "$MASTER" | keepassxc-cli show "$SECRETS_KDBX" "$1" -q -sa password
}

PAT=$(get_secret "forumline-prod/ZITADEL_SERVICE_USER_PAT")
RESEND_API_KEY=$(get_secret "services/RESEND_API_KEY")

# --- Helper ---
zitadel_api() {
  local method="$1" path="$2"
  shift 2
  curl -sf -X "$method" "$ZITADEL_URL$path" \
    -H "Authorization: Bearer $PAT" \
    -H "Content-Type: application/json" \
    "$@"
}

# --- SMTP Configuration ---
echo "Checking SMTP configuration..."

# Check if an active SMTP config already exists
if zitadel_api GET /admin/v1/smtp >/dev/null 2>&1; then
  echo "SMTP already configured and active — skipping."
else
  echo "No active SMTP config found. Creating..."
  SMTP_RESPONSE=$(zitadel_api POST /admin/v1/smtp -d "{
    \"senderAddress\": \"noreply@forumline.net\",
    \"senderName\": \"Forumline\",
    \"host\": \"smtp.resend.com:465\",
    \"tls\": true,
    \"user\": \"resend\",
    \"password\": \"$RESEND_API_KEY\"
  }")

  SMTP_ID=$(echo "$SMTP_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
  echo "Created SMTP config $SMTP_ID — activating..."

  zitadel_api POST "/admin/v1/smtp/${SMTP_ID}/_activate" -d '{}' >/dev/null
  echo "SMTP activated: noreply@forumline.net via smtp.resend.com"
fi

echo "=== Zitadel configuration complete ==="
