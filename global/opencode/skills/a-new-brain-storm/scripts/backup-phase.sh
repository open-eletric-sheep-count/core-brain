#!/usr/bin/env bash
# backup-phase.sh — ORACLE-only. Deterministic. IDEMPOTENT (a double run is a no-op, never an error).
# Usage: backup-phase.sh <SLICE> <WINNER> <PASTA_BRAINSTORM>
# Precondition: all 4 deliveries exist at <PASTA>/output/<AGENTE>/delivery.md (even the losers).
# Effect: copies all 4 deliveries to backup/<SLICE>/<AGENTE>/delivery.md BEFORE winner.sh
#   overwrites the losers, and records the winner in backup/report.md as a doc list
#   with a (winner) marker next to the winner.
set -euo pipefail
SLICE="${1:?usage: backup-phase.sh <SLICE> <WINNER> <PASTA_BRAINSTORM>}"
WINNER="${2:?usage: backup-phase.sh <SLICE> <WINNER> <PASTA_BRAINSTORM>}"
PASTA="${3:?usage: backup-phase.sh <SLICE> <WINNER> <PASTA_BRAINSTORM>}"
case "$WINNER" in
  BAD_GUY|MARKETER|MINIMALIST|NAME_MAKER) ;;
  *) echo "invalid WINNER: $WINNER (expected BAD_GUY|MARKETER|MINIMALIST|NAME_MAKER)" >&2; exit 1 ;;
esac
for P in BAD_GUY MARKETER MINIMALIST NAME_MAKER; do
  SRC="$PASTA/output/$P/delivery.md"
  [ -f "$SRC" ] || { echo "backup-phase: delivery missing: $SRC" >&2; exit 1; }
done
DEST="$PASTA/backup/$SLICE"
mkdir -p "$DEST"
for P in BAD_GUY MARKETER MINIMALIST NAME_MAKER; do
  mkdir -p "$DEST/$P"
  if [ ! -f "$DEST/$P/delivery.md" ]; then
    cp -f "$PASTA/output/$P/delivery.md" "$DEST/$P/delivery.md"
  fi
done
REPORT="$PASTA/backup/report.md"
if [ ! -f "$REPORT" ]; then
  printf '# Backup report\n\n' > "$REPORT"
fi
if grep -q "^## $SLICE\$" "$REPORT" 2>/dev/null; then
  echo "backup-phase: $SLICE already recorded (idempotent no-op)"
  echo "backed up: $DEST"
  exit 0
fi
{
  echo "## $SLICE"
  for P in BAD_GUY MARKETER MINIMALIST NAME_MAKER; do
    if [ "$P" = "$WINNER" ]; then
      echo "- $P/delivery.md (winner)"
    else
      echo "- $P/delivery.md"
    fi
  done
  echo ""
} >> "$REPORT"
echo "backed up: $DEST"
