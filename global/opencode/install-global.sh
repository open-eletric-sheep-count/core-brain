#!/usr/bin/env bash
# Backward-compatible OESC entry point; accepts either --host value.
# OpenCode is the default. -s SOURCE and -d DESTINATION remain supported.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
exec bash "$ROOT/install.sh" "$@"
