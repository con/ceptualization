# End-to-end test

Every interaction defect found so far in this prototype was found by a human
clicking, not by a test: *"expand all seems to do nothing"*, *"hiding a
container leaves the individual nodes on screen"*, *"collapse all still leaves
individual repos"*, *"pointless flood of green arrows"*. Each was a one-line
bug behind a control whose label promised something else. This suite exists so
that class of defect fails a command instead of a person.

## What it does

```
setup-fixture.sh   real git repositories on disk
      |
worldmap-crawl.py  crawl -> worldmap.json
      |
   app.py          served as a scenario
      |
   e2e.mjs         Playwright walks the viewer and asserts invariants
```

Run everything:

```
./run-all.sh                       # builds the fixture, then all suites
./run-all.sh --offline             # no network: synthesise instead of cloning
```

Or the pieces:

```
./setup-fixture.sh /tmp/e2efix
node e2e.mjs --fixture /tmp/e2efix --port 8899
node e2e.mjs --worldmap ../../scenarios --scenario s2-babs-ria --port 8901
```

`--keep` leaves the crawl output and the final screenshot behind.
`CHROME_PATH` overrides the browser binary.

Requirements: `python3`, `git`, and a resolvable `playwright` (`npm i -D
playwright`, or symlink a `node_modules` here — it is gitignored). Do **not**
run `playwright install` in the sandbox; Chromium is already at
`/opt/pw-browsers/`.

## The fixture

`setup-fixture.sh` builds eight real repositories, chosen so that every
relation the map draws is present at least once and the awkward ones are
present twice:

| repository        | why it is there                                             |
|-------------------|-------------------------------------------------------------|
| `origin-super`    | clone of `datalad/testrepo_gh` — a **real** github remote     |
| `sub-origin`      | stands in for the first-level subdataset, own dataset id      |
| `super`           | clone of `origin-super` with `sub-origin` as a real submodule |
| `clone-a`         | clone of `super`, two commits ahead — aheadness has a subject |
| `clone-b`         | clone of `super` plus `upstream` and `attic` remotes **no branch tracks** |
| `wt-x`, `wt-y`    | linked worktrees of `super` on their own branches             |
| `independent-sub` | clone of `sub-origin` with `origin` **removed**               |

`independent-sub` is the point of the exercise. The same dataset exists twice —
once as a submodule of `super`, once standing alone — and **no local remote
joins them**. Only shared history and the DataLad dataset id say they are
related, which is exactly the identity problem from
`distribution-modeling-and-repo-identity.md`. `clone-b`'s untracked remotes are
what the `current` / `tracked` / `all` remote scopes are for; the worktrees are
what the one-arrow-per-worktree fix was for.

The upstream clone is the only network access, and `--offline` synthesises a
stand-in that still carries a `github.com` origin URL.

## The invariants

Assertions are **relations, not golden numbers**, so the fixture can grow
without rewriting the test. Two groups:

*Crawl shape* (fixture run only) — worktrees produce one `worktree_of` edge
each rather than N², the submodule survives as an edge, the github remote is on
the map, remotes split into tracked and untracked, and both copies of the
subdataset appear with distinct dataset ids.

*Viewer behaviour* (every run) — the map opens on the seeds and their
containers and nothing else; `reveal all` is a superset of that; no node is
ever drawn whose parent is collapsed, hidden, or absent; `collapse all` leaves
**only containers** drawn and `uncollapse all` restores both the count and every
position to sub-pixel; hide removes exactly one node, orphans nothing, and
flips its own button to *show*; undo and redo are inverses; bundling moves
nothing and unbundling conserves the edge count; a dragged repository stays
inside its container and undo puts it back exactly; and the console stays clean
for the whole walk.

## Conformance mode

`--worldmap DIR --scenario NAME` skips the crawl and replays the viewer half
against a map that already exists. The three generated scenarios are 24, 51 and
68 nodes with quite different shapes, and the same walk has to hold on all of
them — a viewer invariant that only breaks on a wide map is caught here rather
than by the next person to click.
