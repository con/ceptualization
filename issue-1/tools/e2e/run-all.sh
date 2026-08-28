#!/usr/bin/env bash
# The whole test suite, in the order a reviewer should read it.
#
#   1. real repositories -> crawler -> viewer -> scripted walk  (the e2e proper)
#   2. the same walk replayed against every pre-generated scenario found under
#      scenarios/ -- a new scenario dropped there gains coverage automatically,
#      and a viewer regression that only shows on a bigger/odder map fails here
#      without needing those repositories on disk
#
# Ports are picked automatically (free-port probe in e2e.mjs), so suites never
# collide with each other, with a dev server, or with a zombie from an
# earlier run.
#
# Usage:  run-all.sh [--fixture DIR] [--offline] [--reuse] [--keep]
#   --offline   synthesise the upstream instead of cloning from github
#   --reuse     keep an existing fixture instead of rebuilding it
#   --keep      keep crawl output and screenshots even on success
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SCENARIOS_DIR="$HERE/../../scenarios"
FIXTURE=/tmp/worldmap-e2e-fixture
OFFLINE=""; REUSE=0; KEEP=""
while [ $# -gt 0 ]; do
  case "$1" in
    --fixture) FIXTURE="$2"; shift 2;;
    --offline) OFFLINE="--offline"; shift;;
    --reuse)   REUSE=1; shift;;
    --keep)    KEEP="--keep"; shift;;
    *) echo "unknown argument: $1"; exit 2;;
  esac
done

fail=0; failed_suites=""
note() { fail=1; failed_suites="$failed_suites $1"; }

if [ "$REUSE" = 1 ] && [ -d "$FIXTURE" ]; then
  echo "=== reusing fixture at $FIXTURE"
else
  echo "=== building the fixture in $FIXTURE"
  bash "$HERE/setup-fixture.sh" "$FIXTURE" $OFFLINE || exit 2
fi

echo
echo "=== e2e: crawl the fixture and walk the viewer"
node "$HERE/e2e.mjs" --fixture "$FIXTURE" $KEEP || note fixture

for wm in "$SCENARIOS_DIR"/*/worldmap.json; do
  [ -e "$wm" ] || continue
  sc="$(basename "$(dirname "$wm")")"
  echo
  echo "=== conformance: $sc"
  node "$HERE/e2e.mjs" --worldmap "$SCENARIOS_DIR" --scenario "$sc" $KEEP || note "$sc"
done

echo
if [ "$fail" = 0 ]; then echo "ALL SUITES PASSED"
else echo "SUITE FAILURES:$failed_suites"; fi
exit "$fail"
