#!/usr/bin/env bash
# Inspect Canvas MUST run from its repo so Node can load express, open, and @babel/* from node_modules.
# Default port 3102 (change with IC_PORT=3100 ./start-inspect-canvas.sh).

set -e
REPO="${INSPECT_CANVAS_DIR:-$HOME/Downloads/inspect-canvas-main}"
SITE_DIR="$(cd "$(dirname "$0")" && pwd)"
CLI="$REPO/dist/cli.js"
IC_PORT="${IC_PORT:-3102}"

if [[ ! -f "$CLI" ]]; then
  echo "Missing: $CLI"
  echo "Clone/build inspect-canvas or set INSPECT_CANVAS_DIR to your repo."
  exit 1
fi

if ! grep -q "panelMinBtn" "$CLI" 2>/dev/null; then
  echo "Your inspect-canvas build looks OLD (rebuild after UI updates)."
  echo "Rebuild: cd \"$REPO\" && npm install && npm run build"
  exit 1
fi

echo "Inspect Canvas repo: $REPO"
echo "Serving site:        $SITE_DIR"
echo "Open:                http://localhost:${IC_PORT}"
echo ""
if lsof -iTCP:"${IC_PORT}" -sTCP:LISTEN -n -P 2>/dev/null | grep -q .; then
  echo "⚠ Port ${IC_PORT} is in use. Stop the other process or use another port, e.g.:"
  echo "  IC_PORT=3103 ./start-inspect-canvas.sh"
  echo ""
fi

cd "$REPO"
exec node dist/cli.js "$SITE_DIR" -p "${IC_PORT}"
