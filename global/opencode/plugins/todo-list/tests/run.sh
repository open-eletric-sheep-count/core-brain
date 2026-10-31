#!/usr/bin/env bash
#
# tests/run.sh — run the ordering suite (spec-ordering.md §6).
# Dev-only: `tests/` is not shipped and check.sh gains no test step.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR/.."

# NOTE: node v24.15.0 in this environment rejects a directory positional
# (`node --test tests/` → "Cannot find module …/tests"): positional arguments
# are treated as script paths, not as directories to search. The glob form
# below is the same suite with the same runner.
exec node --test tests/*.test.mjs
