#!/usr/bin/env bash
# Block committing unencrypted .env files.
# Secrets live in secrets.kdbx, not in .env files.
set -euo pipefail

for file in $(git diff --cached --name-only --diff-filter=ACM); do
  basename=$(basename "$file")
  if [[ "$basename" == .env || "$basename" == .env.* ]] && [[ "$basename" != .env.example ]]; then
    echo "ERROR: Refusing to commit env file: $file"
    echo "       Secrets belong in secrets.kdbx, not .env files."
    exit 1
  fi
done
