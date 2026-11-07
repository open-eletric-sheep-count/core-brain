#!/usr/bin/env bash
# winner.sh — ORACLE-only. Deterministic. IDEMPOTENT (a double run is a no-op, never an error).
# Usage: winner.sh <AGENTE> <PASTA_BRAINSTORM>
set -euo pipefail
AGENTE="${1:?usage: winner.sh <AGENTE> <PASTA_BRAINSTORM>}"
PASTA="${2:?usage: winner.sh <AGENTE> <PASTA_BRAINSTORM>}"
case "$AGENTE" in
  BAD_GUY|MARKETER|MINIMALIST|NAME_MAKER) ;;
  *) echo "invalid AGENTE: $AGENTE (expected BAD_GUY|MARKETER|MINIMALIST|NAME_MAKER)" >&2; exit 1 ;;
esac
WINNER_FILE="$PASTA/output/$AGENTE/delivery.md"
[ -f "$WINNER_FILE" ] || { echo "winner delivery missing: $WINNER_FILE" >&2; exit 1; }
CANON="$PASTA/output/delivery.md"
for P in BAD_GUY MARKETER MINIMALIST NAME_MAKER; do
  [ "$P" = "$AGENTE" ] && continue
  rm -f "$PASTA/output/$P/delivery.md"
done
cp -f "$WINNER_FILE" "$CANON"
for P in BAD_GUY MARKETER MINIMALIST NAME_MAKER; do
  [ "$P" = "$AGENTE" ] && continue
  cp -f "$WINNER_FILE" "$PASTA/output/$P/delivery.md"
done
echo "winner: $AGENTE -> all output folders"
