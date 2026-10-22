#!/usr/bin/env bash
# reject.sh — ORACLE-only. Deterministic. IDEMPOTENT (a double run is a no-op, never an error).
# Usage: reject.sh <FATIA> <R_N> <PASTA_BRAINSTORM>
# Precondition: the ORACLE staged the top-score delivery at <PASTA>/output/delivery.md.
set -uo pipefail
FATIA="${1:?usage: reject.sh <FATIA> <R_N> <PASTA_BRAINSTORM>}"
RN="${2:?usage: reject.sh <FATIA> <R_N> <PASTA_BRAINSTORM>}"
PASTA="${3:?usage: reject.sh <FATIA> <R_N> <PASTA_BRAINSTORM>}"
case "$RN" in
  R1|R2|R3) ;;
  *) echo "invalid R_N: $RN (expected R1|R2|R3)" >&2; exit 1 ;;
esac
DEST="$PASTA/reject/${FATIA}-${RN}"
mkdir -p "$DEST"
moved=0
for F in "output/delivery.md:delivery.md" "forum.md:forum.md" "votes.md:votes.md"; do
  SRC="$PASTA/${F%%:*}"; NAME="${F##*:}"
  if [ -f "$SRC" ]; then mv -f "$SRC" "$DEST/$NAME"; moved=1; fi
done
if [ "$moved" -eq 0 ]; then
  echo "reject.sh: ${FATIA}-${RN} already archived (idempotent no-op)"
fi
echo "archived: $DEST"
