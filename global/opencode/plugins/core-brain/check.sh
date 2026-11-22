#!/usr/bin/env bash
#
# check.sh — the executable suites for the core-brain plugin.
#
#   Suite A (test/matrix.selftest.mjs): the isolation matrix (spec §9.2) —
#     13 rows, `7 PASS … 19 PASS`, same observables as before (plan D3: async).
#   Suite B (test/search.selftest.mjs): the AC probe runner (plan §9) —
#     semantic, fusion, fusion-verbose, rerank, isolation-hybrid, stale-index,
#     reindex. The two weight-dependent probes (`rerank-real`, `offline`) are
#     NOT run here; their AC commands set CORE_BRAIN_EMBEDDER=real explicitly.
#   Suite C (test/hooks.selftest.mjs): the automatic layer (Fatia 2) —
#     A1 context / A2 prompt / A3 compaction; A4 SKIP (UNKNOWN).
#   Suite D (test/timeline.selftest.mjs): the episodic timeline (Fatia 3,
#     CONTRACT.md §10) — TL1..TL6. RED until the ops land (declared).
#
# The engine seam is injected with the offline fixture by default
# (CORE_BRAIN_EMBEDDER=fixture); `CORE_BRAIN_EMBEDDER=real bash check.sh` runs
# the same suites against the cached model (plan §8 step 3 / AC4).
#
# Removes the temp root on exit (rule 21). Exits 0 only when EVERY matrix row,
# EVERY probe, EVERY hook ledger and EVERY timeline ledger passes.
#
# Run:  bash check.sh

set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# --- 1. disposable data root + guaranteed cleanup -------------------------
# The suite still asserts the JSON contract (files on disk, STALE_INDEX by header, `reindex` writing an
# index file). The SQLite backend is the runtime default from 2026-11-20; the probes that speak JSON set
# CORE_BRAIN_STORE=json so both worlds stay honest until the SQLite suite exists (item 6.1.2.2.2).
export CORE_BRAIN_STORE=json
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

# --- 3. feature-detect the type-stripping flag (Node >= 22.6) --------------
STRIP_FLAG=""
if "$NODE_BIN" --experimental-strip-types -e 'process.exit(0)' >/dev/null 2>&1; then
  STRIP_FLAG="--experimental-strip-types"
fi

# --- 4. the embedder seam (fixture by default; AC4 overrides with `real`) --
export CORE_BRAIN_EMBEDDER="${CORE_BRAIN_EMBEDDER:-fixture}"

run_script() { # <script> <logfile> [args...]
  local script="$1" logfile="$2"
  shift 2
  if [ -n "$STRIP_FLAG" ]; then
    "$NODE_BIN" "$STRIP_FLAG" "$script" "$@" >"$logfile" 2>&1
  else
    "$NODE_BIN" "$script" "$@" >"$logfile" 2>&1
  fi
}

status=0

# --- 5. Suite A: the 13-row isolation matrix ------------------------------
MATRIX_LOG="$CORE_BRAIN_HOME/matrix.log"
if ! run_script "$DIR/test/matrix.selftest.mjs" "$MATRIX_LOG"; then
  status=1
fi
cat "$MATRIX_LOG"
if [ "$status" -ne 0 ]; then
  echo "core-brain check.sh: matrix FAILED" >&2
  exit "$status"
fi

# --- 6. Suite B: the AC probes (offline subset) ---------------------------
PROBES="semantic fusion fusion-verbose rerank isolation-hybrid stale-index reindex"
for probe in $PROBES; do
  PROBE_LOG="$CORE_BRAIN_HOME/probe-$probe.log"
  if ! run_script "$DIR/test/search.selftest.mjs" "$PROBE_LOG" --probe "$probe"; then
    status=1
  fi
  cat "$PROBE_LOG"
done

if [ "$status" -ne 0 ]; then
  echo "core-brain check.sh: probes FAILED (see the probe logs above)" >&2
  exit "$status"
fi

# --- 7. Suite C: the automatic-layer hooks (Fatia 2, CONTRACT.md §9) -------
# A1 context injection / A2 prompt learning / A3 compaction carry; A4 SKIP
# (UNKNOWN). RED until the DEVELOPER lands the layer. Needs the engine
# embedder (the provisioned runtime, or CORE_BRAIN_EMBEDDER=fixture honoured
# by the plugin path). Creates and removes its own temp root (rule 21).
HOOKS_LOG="$CORE_BRAIN_HOME/hooks.log"
if ! run_script "$DIR/test/hooks.selftest.mjs" "$HOOKS_LOG"; then
  status=1
fi
cat "$HOOKS_LOG"

if [ "$status" -ne 0 ]; then
  echo "core-brain check.sh: hooks FAILED (see the log above)" >&2
  exit "$status"
fi

# --- 8. Suite D: the episodic timeline (Fatia 3, CONTRACT.md §10) -----------
# TL1 episode / TL2 isolation / TL3 import / TL4 search by meaning / TL5
# promote; TL6 SKIP (the backup mirror is UNKNOWN, another repo). RED until
# the DEVELOPER lands the `episode`/`timeline`/`promote` ops; the suite makes
# and removes its own temp root (rule 21).
TIMELINE_LOG="$CORE_BRAIN_HOME/timeline.log"
if ! run_script "$DIR/test/timeline.selftest.mjs" "$TIMELINE_LOG"; then
  status=1
fi
cat "$TIMELINE_LOG"

if [ "$status" -ne 0 ]; then
  echo "core-brain check.sh: timeline FAILED (see the log above)" >&2
  exit "$status"
fi

# --- 10. Suite F: the maintenance pass that collapses duplicated memories ---
# "Remove one and reinforce the other" (USER, 2026-11-18): dry-run writes nothing, apply retires
# the copies and sums the counters, a second run is a no-op. Own temp root (rule 21).
DEDUPE_LOG="$CORE_BRAIN_HOME/dedupe.log"
if ! run_script "$DIR/test/dedupe.selftest.mjs" "$DEDUPE_LOG"; then
  status=1
fi
cat "$DEDUPE_LOG"

if [ "$status" -ne 0 ]; then
  echo "core-brain check.sh: dedupe FAILED (see the log above)" >&2
  exit "$status"
fi

# --- 10b. Suite F2: memories that say the same thing in DIFFERENT words ------
# USER design (2026-11-20, item 6.1): the DREAM looks among the memories that already exist and
# JOINS the two into one, summing the score; the admin sweep applies the same rule to the records
# already on disk. The exact-text suite above cannot see a paraphrase — this one pins the vector path.
DEDUPE_SEMANTIC_LOG="$CORE_BRAIN_HOME/dedupe-semantic.log"
if ! run_script "$DIR/test/dedupe-semantic.selftest.mjs" "$DEDUPE_SEMANTIC_LOG"; then
  status=1
fi
cat "$DEDUPE_SEMANTIC_LOG"

if [ "$status" -ne 0 ]; then
  echo "core-brain check.sh: dedupe-semantic FAILED (see the log above)" >&2
  exit "$status"
fi

# --- 10d. Suite F4: retired memories leave the live table --------------------
# USER design (2026-11-20): at the end of a dream the retired rows move to memories_history — with
# their FTS entry and vector — so the table agents read on every call stops accumulating audit data.
# SQLite-only suite: it deletes CORE_BRAIN_STORE itself to force the production backend.
HISTORY_LOG="$CORE_BRAIN_HOME/history.log"
if ! run_script "$DIR/test/history-archive.selftest.mjs" "$HISTORY_LOG"; then
  status=1
fi
cat "$HISTORY_LOG"

if [ "$status" -ne 0 ]; then
  echo "core-brain check.sh: history-archive FAILED (see the log above)" >&2
  exit "$status"
fi

# --- 10c. Suite F3: a merge NEVER crosses a namespace ------------------------
# USER rule (2026-11-20): one agent's memories become that agent's memory; two globals become one
# global; and a global beside an agent memory is NOT duplication — both stay. Pinned so a refactor
# cannot quietly mix the spaces.
DEDUPE_NS_LOG="$CORE_BRAIN_HOME/dedupe-ns.log"
if ! run_script "$DIR/test/dedupe-namespaces.selftest.mjs" "$DEDUPE_NS_LOG"; then
  status=1
fi
cat "$DEDUPE_NS_LOG"

if [ "$status" -ne 0 ]; then
  echo "core-brain check.sh: dedupe-namespaces FAILED (see the log above)" >&2
  exit "$status"
fi

# --- 11. Suite G: the embedding-model profiles ------------------------------
# `CORE_BRAIN_EMBED_MODEL` picks the model; silence keeps bge-small; a typo is refused.
PROFILE_LOG="$CORE_BRAIN_HOME/profile.log"
if ! run_script "$DIR/test/embedder-profile.selftest.mjs" "$PROFILE_LOG"; then
  status=1
fi
cat "$PROFILE_LOG"

if [ "$status" -ne 0 ]; then
  echo "core-brain check.sh: embedder profile FAILED (see the log above)" >&2
  exit "$status"
fi

# --- 12. Suite H: the dream pass (episodes in, memories out) -----------------
# USER design 2026-11-19: dreams.json, dreamedAt on the episode, meta.dreams on the memory.
DREAM_LOG="$CORE_BRAIN_HOME/dream.log"
if ! run_script "$DIR/test/dream.selftest.mjs" "$DREAM_LOG"; then
  status=1
fi
cat "$DREAM_LOG"

if [ "$status" -ne 0 ]; then
  echo "core-brain check.sh: dream FAILED (see the log above)" >&2
  exit "$status"
fi

# --- 13. Suite I: the insertion record (insertions.jsonl, two lines per case) --
# USER design 2026-11-19: kind = initialization | finalization, joined by id; a case with no answer survives.
INSERTION_LOG="$CORE_BRAIN_HOME/insertions.log"
if ! run_script "$DIR/test/memory-insertions.selftest.mjs" "$INSERTION_LOG"; then
  status=1
fi
cat "$INSERTION_LOG"

if [ "$status" -ne 0 ]; then
  echo "core-brain check.sh: insertions FAILED (see the log above)" >&2
  exit "$status"
fi

echo "core-brain check.sh: matrix 13/13 + probes + hooks + timeline + dedupe + dedupe-semantic + dedupe-namespaces + history + profile + dream + insertions (CORE_BRAIN_HOME cleaned up)"