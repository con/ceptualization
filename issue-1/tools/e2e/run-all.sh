#!/usr/bin/env bash
# The whole test suite, in the order a reviewer should read it.
#
#   1. real repositories -> crawler -> viewer -> scripted walk  (the e2e proper)
#   2. the same walk replayed against every pre-generated scenario, which is
#      how a viewer regression that only shows up on a bigger/odder map gets
#      caught without needing those repositories on disk
#
# Usage:  run-all.sh [--fixture DIR] [--offline]
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
FIXTURE=/tmp/worldmap-e2e-fixture
OFFLINE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --fixture) FIXTURE="$2"; shift 2;;
    --offline) OFFLINE="--offline"; shift;;
    *) echo "unknown argument: $1"; exit 2;;
  esac
done

fail=0
echo "=== building the fixture in $FIXTURE"
bash "$HERE/setup-fixture.sh" "$FIXTURE" $OFFLINE || exit 2

echo
echo "=== e2e: crawl the fixture and walk the viewer"
node "$HERE/e2e.mjs" --fixture "$FIXTURE" --port 8899 || fail=1

port=8901
for sc in s1-spacetop s2-babs-ria s3-forks; do
  echo
  echo "=== conformance: $sc"
  node "$HERE/e2e.mjs" --worldmap "$HERE/../../scenarios" --scenario "$sc" --port "$port" || fail=1
  port=$((port + 1))
done

echo
[ "$fail" = 0 ] && echo "ALL SUITES PASSED" || echo "SUITE FAILURES — see above"
exit "$fail"
