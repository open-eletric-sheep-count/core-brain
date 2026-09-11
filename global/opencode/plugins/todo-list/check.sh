#!/usr/bin/env bash
#
# check.sh — validate @oesc/todo-list in place (single-folder plugin).
#
# This directory IS the distribution artifact (global/opencode/plugins/
# todo-list/): there is no copy/build step; check.sh only proves the plugin
# is sound before install/publish.
#
# Steps:
#   1. Import smoke check — node imports index.ts (native TS type-stripping;
#      executes module top-level only, setup is NOT called). Proves syntax and
#      relative resolution of ./store.ts, ./types.ts and ./format.ts.
#   2. Typecheck — tsc -p tsconfig.json (uses `tsc` when on PATH; falls back
#      to `npx typescript@5.9.2`; skipped with a warning if neither exists).

set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "==> Import smoke check (node native TS): index.ts"
node --input-type=module -e "await import('file://$DIR/index.ts')"

echo "==> Typecheck"
if command -v tsc >/dev/null 2>&1; then
  (cd "$DIR" && tsc -p tsconfig.json)
  echo "tsc: OK"
elif command -v npx >/dev/null 2>&1; then
  (cd "$DIR" && npx --yes -p typescript@5.9.2 tsc -p tsconfig.json)
  echo "tsc (npx): OK"
else
  echo "WARN: tsc not found on PATH (and no npx); skipping typecheck"
fi

echo "All checks passed for: $(basename "$DIR")"
