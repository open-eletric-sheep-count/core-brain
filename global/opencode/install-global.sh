#!/usr/bin/env bash
#
# install-global.sh — Installs the OpenCode global configuration from the
# core-brain repository (equivalent to taulukko's src/install-global.sh;
# this repository is the open-source home of the plugins, including todo-list).
#
# Usage:
#   global/opencode/install-global.sh [-s SOURCE] [-d DESTINATION]
#
# Defaults:
#   SOURCE  = <core-brain>/global/opencode
#   DESTINATION = ~/.config/opencode
#
# Behavior:
#   - Copies the entire content of SOURCE to DESTINATION (recursively)
#   - Preserves the directory structure
#   - Silently overwrites existing files
#   - Creates DESTINATION if it does not exist
#   - If SOURCE does not exist, prints an error and exits immediately
#
# Note: called by taulukko's install-global.sh when the OESC_CORE_BRAIN_HOME
# variable points at this checkout (todo-list spec section 10).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

DEFAULT_SRC="$SCRIPT_DIR"
DEFAULT_DST="$HOME/.config/opencode"

SRC="$DEFAULT_SRC"
DST="$DEFAULT_DST"

while getopts "s:d:h" opt; do
  case "$opt" in
    s) SRC="$OPTARG" ;;
    d) DST="$OPTARG" ;;
    h)
      echo "Usage: $0 [-s SOURCE] [-d DESTINATION]"
      echo ""
      echo "Installs the OpenCode global configuration from core-brain."
      echo ""
      echo "Defaults:"
      echo "  SOURCE  = $DEFAULT_SRC"
      echo "  DESTINATION = $DEFAULT_DST"
      echo ""
      echo "Note: SOURCE must exist; otherwise the script aborts with an error."
      exit 0
      ;;
    *) exit 1 ;;
  esac
done

if [ ! -d "$SRC" ]; then
  echo "ERROR: Source directory not found: $SRC" >&2
  exit 1
fi

if [ ! -d "$SRC/plugins" ]; then
  echo "WARNING: $SRC/plugins not found — incomplete repository?" >&2
fi

mkdir -p "$DST"

cp -r "$SRC/." "$DST/"

echo "Copied from:  $SRC"
echo "Copied to: $DST"
echo "Completed successfully."
