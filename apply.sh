#!/usr/bin/env bash
# dsh-session-unarchive — apply the unarchive plugin patch to a local dsh install.
# Usage:
#   ./apply.sh          apply all patches (safe: skips already-patched files)
#   ./apply.sh check    dry-run: report per-file status without writing
set -euo pipefail
cd "$(dirname "$0")"
HERE="$(pwd)"

md5of() {
  if command -v md5sum >/dev/null 2>&1; then md5sum "$1" | cut -d' ' -f1
  elif command -v md5 >/dev/null 2>&1; then md5 -q "$1"
  else echo "no-md5-tool"; fi
}

# Locate the dsh global npm install (@deepseek-ai/dsh).
# DSH_UNARCHIVE_DEST overrides the target (also used by tests).
DEST_BASE="${DSH_UNARCHIVE_DEST:-}"
if [ -z "$DEST_BASE" ]; then
  for root in $(npm root -g 2>/dev/null) /usr/local/lib/node_modules "$HOME/.nvm/current/lib/node_modules" "$HOME/.local/lib/node_modules"; do
    [ -z "$root" ] && continue
    if [ -d "$root/@deepseek-ai/dsh/node_modules/@deepseek-ai" ]; then
      DEST_BASE="$root/@deepseek-ai/dsh/node_modules/@deepseek-ai"
      break
    fi
  done
fi
if [ -z "$DEST_BASE" ]; then
  echo "error: cannot locate @deepseek-ai/dsh global install" >&2
  exit 1
fi
echo "dsh install: $DEST_BASE"

MODE="${1:-apply}"
FAIL=0

for patch in patches/*.patch; do
  pkg="$(basename "$patch" .patch)"
  ok=1
  patched=0
  while IFS= read -r -d '' rel; do
    src="originals/$pkg/$rel"
    target="$DEST_BASE/$pkg/$rel"
    if [ ! -f "$target" ]; then
      echo "  [$pkg/$rel] missing target file"
      ok=0
      continue
    fi
    if [ "$(md5of "$src")" = "$(md5of "$target")" ]; then
      : # pristine original: patch applies cleanly
    elif grep -q "unarchiveSession" "$target" 2>/dev/null; then
      patched=1
    else
      echo "  [$pkg/$rel] locally modified (not pristine, not patched) — manual review required"
      ok=0
    fi
  done < <(cd "originals/$pkg" 2>/dev/null && find lib -type f -print0)

  if [ "$patched" = "1" ]; then
    echo "already patched — skip: $pkg"
  elif [ "$ok" = "1" ] && [ "$MODE" = "apply" ]; then
    if (cd "$DEST_BASE" && patch -p1 --silent < "$HERE/$patch"); then
      echo "applied: $pkg"
    else
      echo "patch failed: $pkg"
      FAIL=1
    fi
  elif [ "$ok" = "1" ]; then
    echo "clean: $pkg"
  else
    echo "SKIPPED: $pkg (review files above first)"
    FAIL=1
  fi
done

echo
if [ "$FAIL" = "1" ]; then
  echo "done with issues — see SKIPPED entries above."
  exit 1
fi
if [ "$MODE" = "check" ]; then
  echo "dry-run finished. Run ./apply.sh to write changes."
else
  echo "done. Restart dsh (host side) and refresh the browser (client side):"
  echo "  kill the 'dsh --profile web' process, relaunch it, then reload http://127.0.0.1:3080"
fi
