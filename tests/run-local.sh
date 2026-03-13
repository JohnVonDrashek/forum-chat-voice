#!/usr/bin/env bash
# Run e2e tests locally, sourcing test user passwords from macOS Keychain.
# Usage:
#   ./tests/run-local.sh                    # all tests
#   ./tests/run-local.sh --project=smoke    # smoke only
#   ./tests/run-local.sh --project=app      # app e2e only

set -euo pipefail

export TESTCALLER_PASSWORD
TESTCALLER_PASSWORD="$(security find-generic-password -a testcaller -s forumline-test-user -w)" # gitleaks:allow

export TESTUSER_DEBUG_PASSWORD
TESTUSER_DEBUG_PASSWORD="$(security find-generic-password -a testuser_debug -s forumline-test-user -w)" # gitleaks:allow

exec pnpm test:e2e "$@"
