#!/usr/bin/env bash
# Common entry point; OpenCode remains the default for existing callers.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "${PYTHON_BIN:-python3}" "$ROOT/scripts/install_global.py" "$@"
