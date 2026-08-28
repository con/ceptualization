#!/usr/bin/env bash
# Build a real git/git-annex-shaped fixture for the end-to-end test.
#
#   fixture/
#     origin-super/     clone of datalad/testrepo_gh — carries a REAL github remote
#     sub-origin/       stands in for the first-level subdataset
#     super/            clone of origin-super, with sub-origin as a real submodule
#       sub/            the submodule checkout
#     clone-a, clone-b/ clones of super — local remotes DO tie these together
#     wt-x, wt-y/       linked worktrees of super, on their own branches
#     independent-sub/  clone of sub-origin with origin REMOVED
#
# `independent-sub` is the point of the exercise: the same dataset exists twice,
# once inside super as a submodule and once standing alone, with **no local
# remote joining them**. Only shared history and the DataLad dataset id say they
# are related — which is exactly the identity problem the model has to express.
#
# Usage:  setup-fixture.sh [DIR] [--offline]
set -euo pipefail

DIR="${1:-/tmp/worldmap-e2e-fixture}"
OFFLINE=0
for a in "$@"; do [ "$a" = "--offline" ] && OFFLINE=1; done
UPSTREAM="https://github.com/datalad/testrepo_gh"

say() { printf '  %s\n' "$*"; }
gitq() { git -c advice.detachedHead=false -c init.defaultBranch=main "$@"; }
mk() { gitq init -q "$1"; git -C "$1" config user.email e2e@example.org;
       git -C "$1" config user.name "worldmap e2e"; }

rm -rf "$DIR"; mkdir -p "$DIR"; cd "$DIR"

# --- a real GitHub-backed superdataset -------------------------------------
if [ "$OFFLINE" = 0 ] && gitq clone -q "$UPSTREAM" origin-super 2>/dev/null; then
  say "origin-super: cloned $UPSTREAM (real github remote)"
else
  say "origin-super: offline — synthesising, then pointing origin at github"
  mk origin-super
  echo "testrepo" > origin-super/README
  mkdir -p origin-super/.datalad
  printf '[datalad "dataset"]\n\tid = 9e788bee-cdcf-4296-b263-d7b619765cca\n' \
    > origin-super/.datalad/config
  git -C origin-super add -A && git -C origin-super commit -qm "seed"
  git -C origin-super remote add origin "$UPSTREAM"
fi

# --- the first-level subdataset, as its own repository ----------------------
mk sub-origin
mkdir -p sub-origin/.datalad
printf '[datalad "dataset"]\n\tid = 3f882691-cfd9-483f-bc4a-702952086258\n' \
  > sub-origin/.datalad/config
echo "level one" > sub-origin/data.txt
git -C sub-origin add -A && git -C sub-origin commit -qm "subdataset: initial"
echo "more" >> sub-origin/data.txt
git -C sub-origin commit -qam "subdataset: second"
say "sub-origin: 2 commits, dataset id 3f882691…"

# --- super = clone of origin-super + the subdataset as a real submodule ------
gitq clone -q origin-super super
git -C super -c protocol.file.allow=always submodule -q add ../sub-origin sub
git -C super commit -qm "add sub as submodule"
say "super: clone of origin-super, submodule 'sub' added"

# --- clones that ARE tied by local remotes ----------------------------------
for c in clone-a clone-b; do
  gitq clone -q super "$c"
  say "$c: clone of super (origin -> super)"
done
# give clone-b a second, untracked remote so the tracking split has something
git -C clone-b remote add upstream "$UPSTREAM"
git -C clone-b remote add attic ../origin-super
say "clone-b: extra remotes 'upstream' and 'attic', tracked by no branch"

# --- linked worktrees on their own branches ---------------------------------
git -C super worktree add -q ../wt-x -b feature/x
git -C super worktree add -q ../wt-y -b feature/y
say "wt-x, wt-y: linked worktrees on feature/x and feature/y"

# --- the same subdataset again, deliberately untied -------------------------
gitq clone -q sub-origin independent-sub
git -C independent-sub remote remove origin
say "independent-sub: clone of sub-origin with origin REMOVED (no local tie)"

# --- a divergence, so ahead/behind is not all zero --------------------------
echo "local work" >> clone-a/README 2>/dev/null || echo "local work" > clone-a/README
git -C clone-a add -A && git -C clone-a commit -qm "clone-a: local work"
echo "more work" >> clone-a/README && git -C clone-a commit -qam "clone-a: more"
say "clone-a: 2 commits ahead of super"

cat <<SUM

fixture ready: $DIR
  repositories : $(find "$DIR" -maxdepth 2 -name .git | wc -l)
  worktrees    : 2 (feature/x, feature/y)
  submodule    : super/sub  (also standing alone as independent-sub)
  github remote: $UPSTREAM
SUM
