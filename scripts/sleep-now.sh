#!/usr/bin/env bash
# sleep-now.sh — kept for muscle memory: it delegates to `sleep.sh now`.
#
# Use `./scripts/sleep.sh help` for the manual and `./scripts/sleep.sh now` to dream.
set -euo pipefail
exec "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/sleep.sh" now "$@"
