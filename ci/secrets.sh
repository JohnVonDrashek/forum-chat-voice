#!/usr/bin/env bash
# Read secrets from the KeePass database and generate a .env file for a service.
#
# Usage: ci/secrets.sh <group> [output-file]
#
# Examples:
#   ci/secrets.sh hosted-prod              # prints to stdout
#   ci/secrets.sh hosted-prod /tmp/.env    # writes to file
#   ci/secrets.sh forumline-prod .env      # writes to file
#
# The master password is read from:
#   1. KEEPASS_PASSWORD env var (CI)
#   2. macOS Keychain "forumline-secrets" (local dev)

set -euo pipefail

GROUP="${1:?Usage: ci/secrets.sh <group> [output-file]}"
OUTPUT="${2:-}"
DB="$(cd "$(dirname "$0")/.." && pwd)/secrets.kdbx"

if [ ! -f "$DB" ]; then
  echo "Error: secrets.kdbx not found at $DB" >&2
  exit 1
fi

# Get master password
if [ -n "${KEEPASS_PASSWORD:-}" ]; then
  MASTER="$KEEPASS_PASSWORD"
elif command -v security &>/dev/null; then
  MASTER=$(security find-generic-password -a master -s forumline-secrets -w 2>/dev/null) || {
    echo "Error: master password not found in Keychain (forumline-secrets)" >&2
    exit 1
  }
else
  echo "Error: set KEEPASS_PASSWORD or use macOS Keychain" >&2
  exit 1
fi

# List entries in the group and build KEY=VALUE pairs
ENV=""
for key in $(printf '%s\n' "$MASTER" | keepassxc-cli ls "$DB" "$GROUP/" -q 2>/dev/null); do
  val=$(printf '%s\n' "$MASTER" | keepassxc-cli show "$DB" "$GROUP/$key" -q -sa password 2>/dev/null)
  ENV+="$key=$val"$'\n'
done

if [ -z "$ENV" ]; then
  echo "Error: no secrets found in group '$GROUP'" >&2
  exit 1
fi

if [ -n "$OUTPUT" ]; then
  printf '%s' "$ENV" > "$OUTPUT"
  chmod 600 "$OUTPUT"
  echo "Wrote $(echo "$ENV" | wc -l | tr -d ' ') secrets to $OUTPUT" >&2
else
  printf '%s' "$ENV"
fi
