#!/usr/bin/env bash
set -euo pipefail

SRC_WEB="$(cd "$(dirname "$0")/.." && pwd)/web"
DEST_ROOT="$(cd "$(dirname "$0")/.." && pwd)/manual_test_env"
DEST_WEB="$DEST_ROOT/web"

echo "Creating stable snapshot..."
rm -rf "$DEST_WEB"
mkdir -p "$DEST_WEB"
# Copy web contents
cp -a "$SRC_WEB/". "$DEST_WEB/"

# Ensure wasm artifacts copied if present
mkdir -p "$DEST_WEB/wasm"
if [ -f "$SRC_WEB/wasm/engine.js" ]; then cp -f "$SRC_WEB/wasm/engine.js" "$DEST_WEB/wasm/"; fi
if [ -f "$SRC_WEB/wasm/engine.wasm" ]; then cp -f "$SRC_WEB/wasm/engine.wasm" "$DEST_WEB/wasm/"; fi

# README note
cat > "$DEST_ROOT/README.md" << 'EOF'
Manual Test Environment
=======================
This snapshot mirrors the 'web/' directory under manual_test_env/web so relative paths remain correct.
Open manual_test_env/web/index.html with your local server (e.g., Live Server in VS Code).
If web/wasm/engine.js and engine.wasm were present at snapshot time, they were copied; otherwise the UI runs in JS-stub mode.
Regenerate this snapshot after changes by re-running scripts/make-stable.sh.
This folder is ignored by git.
EOF

echo "Stable snapshot created at: $DEST_ROOT"