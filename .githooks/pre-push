#!/usr/bin/env bash
# Pre-push hook: block pushes when GitHub Actions is degraded or down.
# Uses the Statuspage components API to check Actions status.

COMPONENTS_URL="https://www.githubstatus.com/api/v2/components.json"

# Fetch with a short timeout so we don't block pushes if the status page itself is down
response=$(curl -sf --max-time 5 "$COMPONENTS_URL" 2>/dev/null)

if [ $? -ne 0 ]; then
  echo "⚠️  Could not reach githubstatus.com — pushing anyway."
  exit 0
fi

actions_status=$(echo "$response" | python3 -c "
import sys, json
data = json.load(sys.stdin)
for c in data.get('components', []):
    if c['name'] == 'Actions':
        print(c['status'])
        break
" 2>/dev/null)

if [ -z "$actions_status" ]; then
  echo "⚠️  Could not parse Actions status — pushing anyway."
  exit 0
fi

if [ "$actions_status" = "operational" ]; then
  exit 0
fi

echo ""
echo "🚫 GitHub Actions status: $actions_status"
echo "   Pushing now will likely fail to trigger workflows."
echo "   Check https://www.githubstatus.com for details."
echo ""
echo "   To push anyway: git push --no-verify"
echo ""
exit 1
