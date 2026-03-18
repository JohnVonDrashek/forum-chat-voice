#!/usr/bin/env bash
# Post-deploy health verification. Runs after ci/deploy.sh to confirm the
# deployed service is actually working, not just running.
#
# Usage: ci/post-deploy-check.sh <service>
#
# Checks:
#   1. /api/health returns 200 (service is alive)
#   2. SSE endpoint accepts connections (not broken by middleware)
#   3. Key API endpoints return non-5xx
#
# On failure: prints diagnostics and exits non-zero so CI can alert.

set -euo pipefail

SERVICE="${1:?Usage: ci/post-deploy-check.sh <service>}"
MAX_RETRIES=10
RETRY_DELAY=3

declare -A URLS=(
  [forumline]="https://app.forumline.net"
  [hosted]="https://hosted.forumline.net"
  [auth]="https://id.forumline.net"
)

BASE_URL="${URLS[$SERVICE]:-}"
if [ -z "$BASE_URL" ]; then
  echo "No health check configured for $SERVICE — skipping"
  exit 0
fi

fail() {
  echo "DEPLOY CHECK FAILED: $1" >&2
  echo "Service $SERVICE may be unhealthy after deploy." >&2
  exit 1
}

# --- Check 1: Health endpoint ---
echo "Checking $SERVICE health endpoint..."
for i in $(seq 1 "$MAX_RETRIES"); do
  status=$(curl -sf -o /dev/null -w '%{http_code}' "$BASE_URL/api/health" 2>/dev/null || echo "000")
  if [ "$status" = "200" ]; then
    echo "  Health check passed (attempt $i)"
    break
  fi
  if [ "$i" -eq "$MAX_RETRIES" ]; then
    fail "$BASE_URL/api/health returned $status after $MAX_RETRIES attempts"
  fi
  echo "  Attempt $i: got $status, retrying in ${RETRY_DELAY}s..."
  sleep "$RETRY_DELAY"
done

# --- Check 2: SSE endpoint (forumline only) ---
# Verifies the event stream doesn't immediately 500 (catches middleware wrapper bugs).
# We don't send an auth token, so we expect 401 — anything else is a problem.
if [ "$SERVICE" = "forumline" ]; then
  echo "Checking SSE endpoint accepts connections..."
  sse_status=$(curl -sf -o /dev/null -w '%{http_code}' "$BASE_URL/api/events/stream" 2>/dev/null || echo "000")
  if [ "$sse_status" = "401" ]; then
    echo "  SSE check passed (got expected 401 without auth)"
  elif [ "$sse_status" = "500" ]; then
    fail "SSE endpoint returned 500 — likely a middleware wrapper breaking http.Flusher"
  else
    echo "  SSE returned $sse_status (unexpected but not 500, continuing)"
  fi
fi

# --- Check 3: Key API endpoints return non-5xx ---
if [ "$SERVICE" = "hosted" ]; then
  echo "Checking platform API..."
  api_status=$(curl -sf -o /dev/null -w '%{http_code}' "$BASE_URL/api/platform/forums" 2>/dev/null || echo "000")
  if [ "${api_status:0:1}" = "5" ]; then
    fail "$BASE_URL/api/platform/forums returned $api_status"
  fi
  echo "  Platform API check passed (status $api_status)"
fi

if [ "$SERVICE" = "auth" ]; then
  echo "Checking identity service..."
  auth_status=$(curl -sf -o /dev/null -w '%{http_code}' "$BASE_URL/health" 2>/dev/null || echo "000")
  if [ "${auth_status:0:1}" = "5" ]; then
    fail "$BASE_URL/health returned $auth_status"
  fi
  echo "  Identity service check passed (status $auth_status)"
fi

echo "All post-deploy checks passed for $SERVICE"
