#!/usr/bin/env bash
# Team D — two-tier worldmap explorer.
#
#   ./run.sh              build web/dist and serve everything on 127.0.0.1:8861
#   ./run.sh dev          python API on :8861 + vite dev server on :5273
#   ./run.sh screenshots  drive the running app with Playwright, refresh screenshots/
#   ./run.sh exports      regenerate exports/ and verify them over file://
#   ./run.sh measure      re-run the whole measurement harness -> tools/last-metrics.json
#   ./run.sh all          measure + screenshots + exports against a running server
#
# Requires: python3 (stdlib only), node + npm. No network at run time.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${PORT:-8861}"
export PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-/opt/pw-browsers}"

build() {
  cd "$HERE/web"
  [ -d node_modules ] || npm install --no-audit --no-fund
  npm run build
}

case "${1:-serve}" in
  serve)
    build
    echo "→ http://127.0.0.1:$PORT"
    cd "$HERE" && PORT="$PORT" exec python3 server/app.py
    ;;
  dev)
    cd "$HERE" && PORT="$PORT" python3 server/app.py &
    trap 'kill %1 2>/dev/null || true' EXIT
    cd "$HERE/web"; [ -d node_modules ] || npm install --no-audit --no-fund
    npm run dev
    ;;
  screenshots) cd "$HERE" && node tools/drive.mjs ;;
  exports)     cd "$HERE" && node tools/export-check.mjs ;;
  measure)     cd "$HERE" && node tools/measure.mjs ;;
  check)       cd "$HERE" && node tools/check-screenshots.mjs ;;
  all)
    cd "$HERE"
    node tools/measure.mjs
    node tools/drive.mjs
    node tools/export-check.mjs
    node tools/check-screenshots.mjs
    ;;
  *) echo "usage: $0 [serve|dev|screenshots|exports|measure|check|all]"; exit 1 ;;
esac
