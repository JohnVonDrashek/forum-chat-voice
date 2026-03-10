#!/usr/bin/env bash
set -euo pipefail

errors=0

for file in $(git diff --cached --name-only --diff-filter=ACM); do
  basename=$(basename "$file")
  if [[ "$basename" == .env || "$basename" == .env.* ]] && [[ "$basename" != *.env.enc ]] && [[ "$basename" != .env.example ]]; then
    echo "ERROR: Refusing to commit unencrypted env file: $file"
    echo "       Use SOPS to encrypt it as a .env.enc file instead."
    errors=1
  fi
done

for file in $(git diff --cached --name-only --diff-filter=ACM | grep '\.env\.enc$' || true); do
  if ! git show ":$file" | grep -q 'sops_version='; then
    echo "ERROR: $file does not appear to be SOPS-encrypted (missing sops metadata)."
    echo "       Encrypt it first: sops --config production-docker-compose-configs/.sops.yaml --input-type dotenv --output-type dotenv -e -i $file"
    errors=1
  fi
done

if [ "$errors" -ne 0 ]; then
  exit 1
fi
