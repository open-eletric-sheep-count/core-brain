#!/usr/bin/env bash
#
# prune-runtime.sh — shrink the core-brain engine runtime to linux-x64 only.
#
# core-brain Slice 1, plan §7 file 3.6 (D8, from the B3 measurement).
#
# onnxruntime-node ships prebuilt binaries for three operating systems and five
# architectures. On a linux-x64 host only bin/napi-v6/linux/x64 is ever loaded,
# so every other OS/arch directory is dead weight. The B3 measurement, on a copy:
#
#   574,221,664 B -> 319,431,792 B   (saved 254,789,872 B)
#
# Safety: the prune runs on a COPY. The source runtime is never modified. The
# copy defaults to "<src>-pruned" (a sibling), so after verifying it the USER can
# swap it in.
#
# Usage:
#   bash prune-runtime.sh                        # dry-run (default): print only
#   bash prune-runtime.sh --apply                # copy + prune
#   bash prune-runtime.sh --src DIR --dest DIR [--apply]
#   bash prune-runtime.sh --help
#
# Environment:
#   CORE_BRAIN_RUNTIME_DIR  default source (default: ~/.core-brain/runtime)
#
# Rollback: rm -rf "$DEST" (the source was never touched).

set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$DIR/../../../.." && pwd)"

APPLY=0
SRC=""
DEST=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --apply) APPLY=1 ;;
    --dry-run) APPLY=0 ;;
    --src) SRC="${2:-}"; shift ;;
    --dest) DEST="${2:-}"; shift ;;
    -h|--help)
      echo "Usage: bash prune-runtime.sh [--src DIR] [--dest DIR] [--apply]"
      echo "  Default is --dry-run (prints what would happen)."
      echo "  --apply copies the runtime and prunes the copy (source untouched)."
      exit 0
      ;;
    *)
      echo "prune-runtime.sh: unknown argument: $1" >&2
      exit 2
      ;;
  esac
  shift
done

expand_tilde() {
  case "$1" in
    "~")   printf '%s' "$HOME" ;;
    "~/"*) printf '%s' "$HOME/${1#\~/}" ;;
    *)     printf '%s' "$1" ;;
  esac
}

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

SRC="$(expand_tilde "${SRC:-${CORE_BRAIN_RUNTIME_DIR:-$HOME/.core-brain/runtime}}")"
DEST="$(expand_tilde "${DEST:-${SRC}-pruned}")"

SRC_ABS="$(canon "$SRC")"
DEST_ABS="$(canon "$DEST")"
REPO_ABS="$(canon "$REPO_ROOT")"
CONFIG_DIR="$(canon "${XDG_CONFIG_HOME:-$HOME/.config}/opencode")"
HOME_ABS="$(canon "$HOME")"

ONNX_REL="node_modules/onnxruntime-node/bin/napi-v6"

refuse() {
  printf 'prune-runtime.sh: REFUSED: %s\n' "$1" >&2
  exit 2
}

case "$DEST_ABS" in
  "$CONFIG_DIR"|"$CONFIG_DIR"/*)
    refuse "destination is inside the generated OpenCode mirror ($CONFIG_DIR)" ;;
  "$REPO_ABS"|"$REPO_ABS"/*)
    refuse "destination is inside this repository ($REPO_ABS)" ;;
esac
[ "$DEST_ABS" = "/" ] && refuse "destination is the filesystem root"
[ "$DEST_ABS" = "$HOME_ABS" ] && refuse "destination is your home directory"
[ "$SRC_ABS" = "$DEST_ABS" ] && refuse "source and destination are the same; the prune must run on a copy"

# Dirs to remove inside <prune-root>: every <os>/<arch> except linux/x64.
list_prune_targets() {
  local root="$1" osdir archdir os arch
  [ -d "$root" ] || return 0
  for osdir in "$root"/*/; do
    [ -d "$osdir" ] || continue
    os="$(basename "${osdir%/}")"
    for archdir in "$osdir"*/; do
      [ -d "$archdir" ] || continue
      arch="$(basename "${archdir%/}")"
      if [ "$os" = "linux" ] && [ "$arch" = "x64" ]; then continue; fi
      printf '%s\n' "${archdir%/}"
    done
  done
}

size_of() { du -sb "$1" | awk '{print $1}'; }

# --- dry-run (the default) -------------------------------------------------
if [ "$APPLY" -eq 0 ]; then
  echo "prune-runtime.sh — DRY-RUN (nothing will be written; pass --apply to run)"
  echo "  source runtime : $SRC_ABS"
  echo "  pruned copy to : $DEST_ABS"
  echo
  if [ ! -d "$SRC_ABS" ]; then
    echo "  source does not exist yet — run install-runtime.sh first."
    exit 0
  fi
  echo "  source size (du -sb):"
  du -sb "$SRC_ABS" | sed 's/^/    /'
  echo "  would remove, inside the copy:"
  targets_found=0
  while IFS= read -r t; do
    [ -n "$t" ] || continue
    echo "    ${t#"$SRC_ABS"/}"
    targets_found=1
  done < <(list_prune_targets "$SRC_ABS/$ONNX_REL")
  if [ "$targets_found" -eq 0 ]; then
    echo "    (nothing to prune under $ONNX_REL)"
  fi
  echo
  echo "[dry-run] nothing was written."
  exit 0
fi

# --- apply -----------------------------------------------------------------
if [ ! -d "$SRC_ABS" ]; then
  echo "prune-runtime.sh: source not found: $SRC_ABS (run install-runtime.sh first)" >&2
  exit 1
fi
if [ -e "$DEST_ABS" ]; then
  echo "prune-runtime.sh: destination already exists: $DEST_ABS" >&2
  echo "  remove it first (rm -rf \"$DEST_ABS\") or pass --dest with another path." >&2
  exit 2
fi

echo "==> copying $SRC_ABS -> $DEST_ABS"
mkdir -p "$(dirname "$DEST_ABS")"
cp -a --reflink=auto -- "$SRC_ABS" "$DEST_ABS"

BEFORE_SIZE="$(size_of "$DEST_ABS")"
echo
echo "before:"
du -sb "$DEST_ABS"

echo
echo "==> pruning (keeping only linux/x64)"
removed=0
while IFS= read -r t; do
  [ -n "$t" ] || continue
  echo "    rm -rf ${t#"$DEST_ABS"/}"
  rm -rf -- "$t"
  removed=$((removed + 1))
done < <(list_prune_targets "$DEST_ABS/$ONNX_REL")
if [ "$removed" -eq 0 ]; then
  echo "    (nothing to prune under $ONNX_REL)"
fi

AFTER_SIZE="$(size_of "$DEST_ABS")"
echo
echo "after:"
du -sb "$DEST_ABS"

SAVED=$((BEFORE_SIZE - AFTER_SIZE))
echo
echo "saved: $SAVED B  (expected on this closure: 254789872 B, plan D8/B3)"

echo
echo "The source was NOT modified: $SRC_ABS"
echo "To adopt the pruned copy (only after verifying it):"
echo "  mv \"$SRC_ABS\" \"$SRC_ABS.full\""
echo "  mv \"$DEST_ABS\" \"$SRC_ABS\""
echo "Rollback (discard the copy): rm -rf \"$DEST_ABS\""
