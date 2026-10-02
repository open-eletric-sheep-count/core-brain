#!/usr/bin/env bash
#
# check.sh — executable isolation matrix for the core-brain plugin (spec §9.2, Layer A).
#
# What it does:
#   1. Creates a disposable data root: CORE_BRAIN_HOME="$(mktemp -d)".
#   2. Writes config.json with the 4 configured agents (§9.1):
#        CB_ALPHA public+global, CB_BETA private+global,
#        CB_GAMMA private+no-global, CB_DELTA public+no-global (INVALID row).
#   3. Runs test/matrix.selftest.mjs against that root (native TS type-stripping).
#   4. Prints the matrix table `7 PASS … 19 PASS`.
#   5. Removes the temp root on exit (AGENTS.md rule 21 / spec §15.3).
#   6. Exits 0 only if every line PASSes; non-zero otherwise.
#
# Run:  bash check.sh        (or: chmod +x check.sh && ./check.sh)
#
# STATUS (updated 2026-10-02): the plugin implementation EXISTS (../store.ts,
# ../types.ts, ../index.ts) and the default-policy slice is IMPLEMENTED (spec §2/§3).
# All lines 7–19 were executed by the ORACLE: 13/13 PASS, exit code 0, Node v24.15.0.
# Lines 15–19 pin docs/specs/core-brain-default-policy-spec.md §7 and are GREEN.
# Step 3 below drives the real store + authorizer.

set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# --- 1. disposable data root + guaranteed cleanup -------------------------
CORE_BRAIN_HOME="$(mktemp -d "${TMPDIR:-/tmp}/core-brain-selftest.XXXXXX")"
export CORE_BRAIN_HOME
cleanup() {
  rm -rf "$CORE_BRAIN_HOME"
}
trap cleanup EXIT INT TERM

# --- 2. the 4-agent config fixture ----------------------------------------
cat > "$CORE_BRAIN_HOME/config.json" <<'JSON'
{
  "agents": [
    { "name": "CB_ALPHA", "hasGlobalAccess": true,  "private": false },
    { "name": "CB_BETA",  "hasGlobalAccess": true,  "private": true  },
    { "name": "CB_GAMMA", "hasGlobalAccess": false, "private": true  },
    { "name": "CB_DELTA", "hasGlobalAccess": false, "private": false }
  ]
}
JSON

NODE_BIN="${NODE_BIN:-node}"
if ! command -v "$NODE_BIN" >/dev/null 2>&1; then
  echo "check.sh: '$NODE_BIN' not found on PATH" >&2
  exit 127
fi

LOG="$CORE_BRAIN_HOME/selftest.log"

# --- 3. run the selftest (feature-detect the type-stripping flag) ----------
# Node >= 22.6 needs --experimental-strip-types; Node >= 23.6 strips by default.
# First try WITH the flag; if the build rejects the flag ("bad option"), retry
# plain. Any other failure (incl. the missing implementation) is a real failure.
run_node() {
  "$NODE_BIN" "$@" "$DIR/test/matrix.selftest.mjs" >"$LOG" 2>&1
}

status=0
if run_node --experimental-strip-types; then
  status=0
elif grep -qiE "bad option|unknown argument|unrecognized option|not recognized" "$LOG"; then
  run_node || status=$?
else
  status=1
fi

# --- 4. report ------------------------------------------------------------
cat "$LOG"

if [ "$status" -ne 0 ]; then
  echo "core-brain check.sh: FAILED (exit $status)" >&2
  exit "$status"
fi

echo "core-brain check.sh: all matrix lines PASS (CORE_BRAIN_HOME cleaned up)"
