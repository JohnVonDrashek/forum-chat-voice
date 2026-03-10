#!/usr/bin/env bash
# Pre-push check: validate that CI workflows and Dockerfiles are consistent
# with the actual repo structure.
set -uo pipefail

errfile=$(mktemp)
trap 'rm -f "$errfile"' EXIT

# --- 1. Validate paths: triggers in workflow files exist ---
for workflow in .github/workflows/*.yml; do
  python3 -c "
import re
in_paths = False
with open('$workflow') as f:
    for line in f:
        stripped = line.strip()
        if re.match(r'^paths:\s*$', stripped):
            in_paths = True
            continue
        if in_paths:
            m = re.match(r\"^-\s+['\\\"]?([^'\\\"*{]+)\", stripped)
            if m:
                base = m.group(1).rstrip('/')
                if base:
                    print(base)
            else:
                in_paths = False
" 2>/dev/null | while read -r base; do
    if [ ! -e "$base" ]; then
      echo "❌ $workflow paths: trigger references non-existent path: $base"
      echo 1 > "$errfile"
    fi
  done
done

# --- 2. Validate Dockerfiles use --ignore-scripts for workspace installs ---
for dockerfile in docker/Dockerfile.*; do
  [ -f "$dockerfile" ] || continue
  if grep -q "pnpm-workspace.yaml" "$dockerfile" 2>/dev/null; then
    if grep "pnpm install" "$dockerfile" | grep -qv "\-\-ignore-scripts"; then
      echo "❌ $dockerfile: workspace pnpm install missing --ignore-scripts (postinstall will fail without git)"
      echo 1 > "$errfile"
    fi
  fi
done

# --- 3. Validate publish-packages.yml references existing packages ---
publish_workflow=".github/workflows/publish-packages.yml"
if [ -f "$publish_workflow" ]; then
  grep -oE 'for pkg in [^;]+;' "$publish_workflow" 2>/dev/null | sed 's/for pkg in //;s/;$//' | tr ' ' '\n' | while read -r pkg; do
    [ -z "$pkg" ] && continue
    if [ ! -d "published-npm-packages/$pkg" ]; then
      echo "❌ $publish_workflow references non-existent package: published-npm-packages/$pkg"
      echo 1 > "$errfile"
    fi
  done
fi

if [ -s "$errfile" ]; then
  echo ""
  echo "Fix the issues above before pushing."
  exit 1
fi
