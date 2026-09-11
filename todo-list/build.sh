#!/usr/bin/env bash
#
# build.sh — typecheck + copy the @oesc/todo-list plugin into the core-brain
# distribution tree (in-place TS, no bundling; spec Q11).
#
# Usage:
#   cd todo-list && ./build.sh
#
# Steps:
#   1. Import smoke check — node imports src/index.ts (native TS type-stripping;
#      executes module top-level only, setup is NOT called). Proves syntax and
#      relative resolution of ./store.ts, ./types.ts and ./format.ts.
#   2. Typecheck — `tsc -p tsconfig.json` when tsc is on PATH (skipped with a
#      warning otherwise; never fails the build over a missing tsc).
#   3. Copy artifact -> <core-brain>/global/opencode/plugins/todo-list/
#      (flat layout: index.ts at the folder root, so "main": "./index.ts"
#      matches the local loader precedent).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"   # .../todo-list
REPO_ROOT="$(dirname "$SCRIPT_DIR")"                        # .../core-brain
SRC="$SCRIPT_DIR/src"
DEST="$REPO_ROOT/global/opencode/plugins/todo-list"

echo "==> Import smoke check (node native TS): src/index.ts"
node --input-type=module -e "await import('file://$SRC/index.ts')"

echo "==> Typecheck"
if command -v tsc >/dev/null 2>&1; then
  (cd "$SCRIPT_DIR" && tsc -p tsconfig.json)
  echo "tsc: OK"
else
  echo "WARN: tsc not found on PATH; skipping typecheck"
fi

echo "==> Copy artifact -> $DEST"
rm -rf "$DEST"
mkdir -p "$DEST"
cp "$SRC/index.ts" "$SRC/store.ts" "$SRC/types.ts" "$SRC/format.ts" \
   "$SRC/tui.tsx" "$SCRIPT_DIR/package.json" "$DEST/"

echo "Done: $DEST"
