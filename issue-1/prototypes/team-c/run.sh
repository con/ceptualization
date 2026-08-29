#!/usr/bin/env bash
# Team C — "Scale & Filter" worldmap prototype.
#   ./run.sh          build the web app and serve everything on 127.0.0.1:8848
#   ./run.sh dev      python API on :8848 + Vite dev server on :5173
set -euo pipefail
cd "$(dirname "$0")"
PORT="${WORLDMAP_PORT:-8853}"

if [ "${1:-}" = "dev" ]; then
  ( cd web && [ -d node_modules ] || npm install )
  WORLDMAP_PORT="$PORT" python3 server/serve.py &
  API=$!
  trap 'kill $API 2>/dev/null || true' EXIT
  cd web && npm run dev
else
  ( cd web && { [ -d node_modules ] || npm install; } && npm run build )
  echo "serving http://127.0.0.1:$PORT"
  WORLDMAP_PORT="$PORT" exec python3 server/serve.py
fi
