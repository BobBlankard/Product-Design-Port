#!/usr/bin/env bash
# Rebuild the fork in your Downloads copy (start-inspect-canvas.sh uses this repo).
set -e
REPO="${INSPECT_CANVAS_DIR:-$HOME/Downloads/inspect-canvas-main}"
cd "$REPO"
npm install
npm run build
if grep -q panelMinBtn dist/cli.js; then
  echo "✓ Built OK: $REPO/dist/cli.js"
else
  echo "✗ dist/cli.js looks stale — wrong folder?"
  exit 1
fi
