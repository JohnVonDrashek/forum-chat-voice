#!/usr/bin/env bash
# Configure git to use the repo's .githooks/ directory for hooks.

set -euo pipefail

git config core.hooksPath .githooks
echo "Git hooks path set to .githooks/"
