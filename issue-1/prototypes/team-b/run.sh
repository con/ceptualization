#!/usr/bin/env bash
# Team B — graphviz-first worldmap explorer.
#
#   ./run.sh            build the web app and serve it on 127.0.0.1:8391
#   ./run.sh dev        vite dev server on :5173 (proxies /api and /export to :8391)
#   ./run.sh screenshots  drive the running app with Playwright, refresh screenshots/
#   ./run.sh exports    regenerate exports/ and verify them via file://
#   ./run.sh measure    re-run the timing/churn benchmark
#
# Requires: python3 (stdlib only), node + npm. No network at run time.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${PORT:-8391}"
export PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-/opt/pw-browsers}"

build() {
  cd "$HERE/web"
  [ -d node_modules ] || npm install
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
    cd "$HERE/web"; [ -d node_modules ] || npm install
    npm run dev
    ;;
  screenshots) cd "$HERE" && node tools/drive.mjs ;;
  exports)     cd "$HERE" && node tools/export-check.mjs ;;
  measure)     cd "$HERE" && node tools/measure.mjs ;;
  *) echo "usage: $0 [serve|dev|screenshots|exports|measure]"; exit 1 ;;
esac
