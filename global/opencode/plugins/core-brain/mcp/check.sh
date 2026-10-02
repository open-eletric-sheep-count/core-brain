#!/usr/bin/env bash
#
# check.sh — Layer-A self-tests for the core-brain plugin (spec §10).
#
# Layer 1 (transport.selftest.mjs): spawns mcp/server.js on a disposable
#   CORE_BRAIN_HOME, drives the real newline-delimited JSON-RPC 2.0
#   conversation (initialize -> notifications/initialized -> tools/list ->
#   tools/call) and asserts the five-tool surface, the global-only recall, the
#   refusal shapes and the JSON-RPC error codes.
# Layer 2 (engine.selftest.mjs): drives createEngine() directly on its OWN
#   disposable seeded root, asserting the forget soft-retire, the feedback
#   ranking, the five core_doctor detections and the core_admin matrix.
#
# Removes the temp root on exit (AGENTS.md rule 21 / spec §15.3).
# Exits 0 only when every assertion in BOTH layers passes.
#
# Run:  bash mcp/check.sh
# Measured reference: Node v24.15.0 (plain `node`, type stripping built in).

set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CORE_BRAIN_HOME="$(mktemp -d "${TMPDIR:-/tmp}/core-brain-mcp-check.XXXXXX")"
export CORE_BRAIN_HOME

cleanup() {
  rm -rf "$CORE_BRAIN_HOME"
}
trap cleanup EXIT

status=0
echo "core-brain Layer-A self-tests: transport + engine"
node "$DIR/test/transport.selftest.mjs" || status=1
node "$DIR/test/engine.selftest.mjs" || status=1
exit "$status"
