#!/usr/bin/env bash
#
# install-vars.sh — writes into the user's environment the variable that locates
# this core-brain checkout (todo-list spec section 10).
#
#   OESC_CORE_BRAIN_HOME — absolute path to the core-brain repository
#
# Default value: detected from the location of this script
# (<core-brain>/global/opencode/install-vars.sh -> <core-brain>); can be
# overridden by exporting OESC_CORE_BRAIN_HOME before running.
#
# Writes to:
#   - /etc/environment (when writable; system scope)
#   - ~/.bashrc (block with a marker; user fallback, re-runnable without
#     duplicating — the old block is replaced)
#
# Taulukko's install-global.sh uses OESC_CORE_BRAIN_HOME to call this
# repository's install-global.sh.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DETECTED="$(dirname "$(dirname "$SCRIPT_DIR")")"
VALUE="${OESC_CORE_BRAIN_HOME:-$DETECTED}"
VAR="OESC_CORE_BRAIN_HOME"

write_env_file() {
  local file="$1"
  [ -f "$file" ] || return 0
  touch "$file" 2>/dev/null || return 1
  if grep -q "^${VAR}=" "$file" 2>/dev/null; then
    local tmp="${file}.oesc-tmp"
    sed "s|^${VAR}=.*|${VAR}=${VALUE}|" "$file" > "$tmp" && mv "$tmp" "$file"
  else
    printf '%s=%s\n' "$VAR" "$VALUE" >> "$file"
  fi
}

if [ -w /etc/environment ]; then
  if write_env_file /etc/environment; then
    echo "Written to /etc/environment: $VAR=$VALUE"
  else
    echo "WARNING: failed to write /etc/environment — using only ~/.bashrc" >&2
  fi
else
  echo "WARNING: /etc/environment not writable — using only ~/.bashrc" >&2
fi

BASHRC="$HOME/.bashrc"
BEGIN="# >>> oesc/core-brain install-vars >>>"
END="# <<< oesc/core-brain install-vars <<<"

if [ -f "$BASHRC" ] && grep -qF "$BEGIN" "$BASHRC" 2>/dev/null; then
  awk -v b="$BEGIN" -v e="$END" '
    $0 == b { skip = 1; next }
    $0 == e { skip = 0; next }
    !skip { print }
  ' "$BASHRC" > "$BASHRC.oesc-tmp" && mv "$BASHRC.oesc-tmp" "$BASHRC"
fi

printf '\n%s\nexport %s=%s\n%s\n' "$BEGIN" "$VAR" "$VALUE" "$END" >> "$BASHRC"

echo "Written to $BASHRC: export $VAR=$VALUE"
echo "Completed successfully."
