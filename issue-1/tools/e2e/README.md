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

Run everything (~1 minute of walking plus the fixture build):

```
./run-all.sh                       # builds the fixture, then all suites
./run-all.sh --offline             # no network: synthesise instead of cloning
./run-all.sh --reuse               # keep an existing fixture, skip the rebuild
```

Or the pieces:

```
./setup-fixture.sh /tmp/e2efix
node e2e.mjs --fixture /tmp/e2efix
node e2e.mjs --worldmap ../../scenarios --scenario s2-babs-ria
```

Flags: `--port N` forces a port (default `auto`: a free one is probed, so
suites can run concurrently and never collide with a dev server or a zombie);
`--keep` retains crawl output and screenshots on success (failures always
retain them); `--no-build` skips the staleness check below.
`CHROME_PATH` overrides the browser binary.

Requirements: `python3`, `git`, node with `playwright` resolvable here
(`npm install` — see package.json), and the viewer's own deps
(`npm install` in `prototypes/team-d/web`) so the suite can rebuild it. In
the Claude sandbox do **not** run `playwright install`; Chromium is already
at `/opt/pw-browsers/` and is found automatically. CI runs all of this on
every push touching the prototype — `.github/workflows/worldmap-e2e.yml`.

## Reliability posture

Each of these guards against a failure mode that actually happened:

* **The server is polled, never slept on**, its output is captured, and the
  served scenario list must name the requested scenario — *and* the loaded
  page must agree (`the page loaded the requested scenario` is check 0).
  A fixed port once collided with a zombie server, which does not fail
  loudly: it serves **stale data**, and three runs silently tested the wrong
  map. Free ports by default plus the double scenario guard make that a
  named failure forever.
* **The viewer is rebuilt when `web/src` is newer than `web/dist`.** The
  server serves the Vite *build*; a suite walking a stale build passes
  against code nobody is shipping. This let a sabotaged `collapseAll` run
  green, and let one committed fix be "verified" by a build that predated
  it.
* **Waits are quiescence, not guesses** — after a floor, poll until two
  consecutive samples of every node position and the edge count are
  identical, with a 10 s ceiling. Replaced ~25 s of fixed sleeps per run;
  the walk is ~10 s and does not get flakier on a loaded machine.
* **The walk runs under try/finally.** An unexpected throw is a named FAIL
  with the summary, the browser and server are always closed, temp dirs are
  removed on success and kept on failure.
* **Repositories are discovered, not listed.** A fixture that grows is
  crawled in full rather than silently subsetted; `run-all.sh` likewise
  discovers every `scenarios/*/worldmap.json`, so a new scenario gains
  coverage by existing.
* **The fixture sets git identity via environment variables**, because
  clones commit too and a clean CI runner has no global identity.

One caveat: concurrent runs are safe *except* for the shared `web/dist` —
two stale-build rebuilds can race. `run-all.sh` is serial; for parallel
invocations, build once, then pass `--no-build`.

## Proving the harness can fail

A suite that has never been seen red proves nothing. The drill, re-run
whenever the harness itself changes:

1. Sabotage the app — e.g. make `collapseAll` a no-op in
   `web/src/main.js`.
2. Run one conformance scenario. Expect: the named checks go FAIL, exit
   code 1, a `failed:` summary, artifacts kept.
3. Restore, run again. Expect: the rebuild triggers, everything green.

The first execution of this drill found the stale-build gap above: the
sabotage ran green because the build predated it.

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

*Viewer behaviour* (every run) — the page loaded the scenario that was
asked for; the map opens on the seeds and their containers and nothing else; `reveal all` is a superset of that; no node is
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
