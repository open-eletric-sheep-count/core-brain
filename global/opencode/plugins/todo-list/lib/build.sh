#!/usr/bin/env bash
#
# build.sh — emit lib/todo-laws.mjs from lib/todo-laws.mts.
#
# The .mts is the source of truth. The generated .mjs is committed because a host
# without a compiler (the Orca plugin) vendors that exact file; it must never be
# edited by hand. TypeScript resolves the `./todo-laws.mjs` import back to the
# `.mts` source, so the compiler checks the real file, not the output.

set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="$DIR/todo-laws.mjs"

cd "$DIR"
if command -v tsc >/dev/null 2>&1; then
  TS=(tsc)
else
  TS=(npx --yes -p typescript@5.9.2 tsc)
fi

"${TS[@]}" todo-laws.mts \
  --target ES2022 \
  --module ESNext \
  --moduleResolution bundler \
  --strict \
  --outDir "$DIR" \
  --declaration false \
  --sourceMap false

# tsc names the output after the source: todo-laws.mjs (ESM, from .mts).
test -f "$OUT" || { echo "missing $OUT" >&2; exit 1; }
echo "==> emitted $OUT ($(wc -c <"$OUT") bytes)"
