#!/usr/bin/env bash
# Team A — "Compound & Correct" worldmap prototype.
#   ./run.sh          build the web app and serve everything on http://127.0.0.1:8848
#   ./run.sh dev      backend on :8848 + Vite dev server on :5273 (HMR, /api proxied)
set -euo pipefail
cd "$(dirname "$0")"

PORT="${PORT:-8848}"
MODE="${1:-serve}"

if [ ! -d web/node_modules ]; then
  echo "[run] npm install"
  npm --prefix web install --no-audit --no-fund
fi

cleanup() { [ -n "${SRV_PID:-}" ] && kill "$SRV_PID" 2>/dev/null || true; }
trap cleanup EXIT

if [ "$MODE" = "dev" ]; then
  python3 server/app.py --port "$PORT" &
  SRV_PID=$!
  echo "[run] api on http://127.0.0.1:$PORT  ·  ui on http://127.0.0.1:5273"
  npm --prefix web run dev
else
  echo "[run] building web/dist"
  npm --prefix web run build
  echo "[run] http://127.0.0.1:$PORT"
  exec python3 server/app.py --port "$PORT"
fi
