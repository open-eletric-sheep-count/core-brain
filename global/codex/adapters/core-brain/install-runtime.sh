#!/usr/bin/env bash
#
# install-runtime.sh — provision the core-brain engine runtime (USER-run).
#
# core-brain Slice 1, plan §7 file 3.6 (D1 / E4).
#
# Installs @huggingface/transformers@4.3.0 into a dedicated runtime directory
# OUTSIDE the plugin tree and OUTSIDE the generated OpenCode mirror:
#
#   ${CORE_BRAIN_RUNTIME_DIR:-$HOME/.config/core-brain/runtime}
#
# The npm cache is redirected to a temporary directory (default
# /tmp/opencode/npm-cache) so that ~/.npm is never written. This is a USER-run
# provisioning step: agents write the script, the USER runs it.
#
# Usage:
#   bash install-runtime.sh              # install (or reinstall) the runtime
#   bash install-runtime.sh --dry-run    # print what would be done, change nothing
#   bash install-runtime.sh --help
#
# Environment:
#   CORE_BRAIN_RUNTIME_DIR  destination (default: ~/.config/core-brain/runtime)
#   NPM_CACHE_DIR           npm cache   (default: /tmp/opencode/npm-cache)
#
# Rollback: rm -rf "$CORE_BRAIN_RUNTIME_DIR" — no repository change.

set -euo pipefail

PKG="@huggingface/transformers"
VERSION="4.3.0"
PKG_SPEC="${PKG}@${VERSION}"

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$DIR/../../../.." && pwd)"

DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    -h|--help)
      echo "Usage: bash install-runtime.sh [--dry-run] [--help]"
      echo "  Installs ${PKG_SPEC} into \${CORE_BRAIN_RUNTIME_DIR:-$HOME/.config/core-brain/runtime}."
      exit 0
      ;;
    *)
      echo "install-runtime.sh: unknown argument: $arg" >&2
      exit 2
      ;;
  esac
done

# --- destination + cache, with ~ expansion --------------------------------
DEST="${CORE_BRAIN_RUNTIME_DIR:-$HOME/.config/core-brain/runtime}"
case "$DEST" in
  "~")   DEST="$HOME" ;;
  "~/"*) DEST="$HOME/${DEST#\~/}" ;;
esac
CACHE_DIR="${NPM_CACHE_DIR:-/tmp/opencode/npm-cache}"

# --- canonicalise paths that may not exist yet ----------------------------
canon() {
  if command -v realpath >/dev/null 2>&1 && realpath -m / >/dev/null 2>&1; then
    realpath -m -- "$1"
    return 0
  fi
  local p="$1" suffix=""
  while [ ! -e "$p" ] && [ "$p" != "/" ] && [ "$p" != "." ]; do
    suffix="/$(basename "$p")$suffix"
    p="$(dirname "$p")"
  done
  printf '%s%s\n' "$(cd -- "$p" && pwd)" "$suffix"
}

DEST_ABS="$(canon "$DEST")"
REPO_ABS="$(canon "$REPO_ROOT")"
CONFIG_DIR="$(canon "${XDG_CONFIG_HOME:-$HOME/.config}/opencode")"
HOME_ABS="$(canon "$HOME")"

# --- refusals: never write the mirror, the repo, or a dangerous target -----
refuse() {
  printf 'install-runtime.sh: REFUSED: %s\n' "$1" >&2
  exit 2
}

case "$DEST_ABS" in
  "$CONFIG_DIR"|"$CONFIG_DIR"/*)
    refuse "destination is inside the generated OpenCode mirror ($CONFIG_DIR); the mirror is USER-owned and never written by tooling" ;;
  "$REPO_ABS"|"$REPO_ABS"/*)
    refuse "destination is inside this repository ($REPO_ABS); the runtime must never enter the repo" ;;
esac
[ "$DEST_ABS" = "/" ] && refuse "destination is the filesystem root"
[ "$DEST_ABS" = "$HOME_ABS" ] && refuse "destination is your home directory; use a dedicated subdirectory"
[ "$DEST_ABS" = "$REPO_ABS" ] && refuse "destination is the repository root"

# --- tool checks ----------------------------------------------------------
if ! command -v npm >/dev/null 2>&1; then
  echo "install-runtime.sh: npm not found on PATH" >&2
  exit 127
fi
if command -v node >/dev/null 2>&1; then
  NODE_VERSION="$(node --version)"
else
  NODE_VERSION="(node not found)"
fi

echo "install-runtime.sh — core-brain engine runtime"
echo "  package   : $PKG_SPEC"
echo "  runtime   : $DEST_ABS"
echo "  npm cache : $CACHE_DIR   (keeps ~/.npm untouched)"
echo "  node      : $NODE_VERSION"

if [ "$DRY_RUN" -eq 1 ]; then
  echo
  echo "[dry-run] would run:"
  echo "  mkdir -p $(printf '%q' "$DEST_ABS") $(printf '%q' "$CACHE_DIR")"
  echo "  npm install --prefix $(printf '%q' "$DEST_ABS") --cache $(printf '%q' "$CACHE_DIR") --no-audit --no-fund $(printf '%q' "$PKG_SPEC")"
  if [ -d "$DEST_ABS/node_modules/$PKG" ]; then
    echo "  (note: $DEST_ABS/node_modules/$PKG already exists — a reinstall is idempotent)"
  fi
  echo "  du -sb $(printf '%q' "$DEST_ABS")"
  echo "[dry-run] nothing was written."
  exit 0
fi

# --- install --------------------------------------------------------------
mkdir -p "$DEST_ABS" "$CACHE_DIR"

echo
echo "==> mkdir -p $DEST_ABS $CACHE_DIR"
echo "==> npm install --prefix $DEST_ABS --cache $CACHE_DIR $PKG_SPEC"
npm install --prefix "$DEST_ABS" --cache "$CACHE_DIR" --no-audit --no-fund "$PKG_SPEC"

# --- measured result (the E8/E4 number) -----------------------------------
echo
echo "==> installed size (du -sb):"
du -sb "$DEST_ABS"

echo
echo "done. Next:"
echo "  - model weights are cached lazily in \${CORE_BRAIN_MODELS:-\$HOME/.config/core-brain/models} on first embed"
echo "  - optional: bash \"$DIR/prune-runtime.sh\"   # reclaim ~255 MB (linux-x64 only, on a copy)"
echo "  - rollback: rm -rf \"$DEST_ABS\""
