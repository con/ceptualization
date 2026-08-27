# Exploration history and undo

Specification for stepping back through an exploration, and notes from
implementing it in the [Team D prototype](./prototypes/team-d/).

Motivation: expansion is cheap to trigger and expensive to reverse. One click
on a node with 60 forks, or one `reveal all`, turns a readable map into a
hairball, and before this the only recovery was reloading and re-probing from
the seed — which also discards every probe already paid for.

## The two rules that make undo correct

### 1. Undo operates on the *view*, never on the store

A step is undone by **hiding what it revealed, not by forgetting what it
taught**. The crawled facts — nodes, edges, findings — are knowledge, and
knowledge is append-only, exactly as observations are in the store design
([architecture](./architecture-persistence-and-prior-art.md),
[repo-embedded things](./repo-embedded-things-and-collections.md)). Undo
shrinks the *visible set*; it never deletes a record.

Three things follow, and all three are load-bearing:

* **Redo needs no network.** The facts are still in memory, so redo is instant
  and an undone ssh probe is never re-run — which matters when a probe costs
  300–900 ms, or a real ssh round trip.
* **Undo can never lose data.** The worst case is a view you can restore, not
  a crawl you must repeat.
* **Saved views stay consistent.** A view is already "which nodes are shown
  plus where they sit"; undo just moves between view states.

The implementation initially got this wrong in an instructive way: it
truncated the edge array on undo. That both destroyed knowledge and made redo
impossible — the edges were gone. The fix was to touch nothing but `visible`,
`collapsed` and the layout snapshot, because **edges are already filtered by
visibility at render time**. When the rule is followed, less code is needed,
not more.

### 2. A step snapshots geometry, so undo restores rather than recomputes

Team D's entire result is that expansion moves nothing
(0 px on 16/17 expansions, against 980 px and 1588 px for the alternatives —
see [the bake-off](./prototypes/BAKE-OFF-RESULTS.md)). An undo that re-ran
layout would move everything and throw that away, which would make undo feel
*worse* than the mistake it corrects.

So a history entry carries the container geometry and the container-local leaf
offsets, and undo re-renders with layout disabled. Measured: **0.00 px drift**
across a full undo→redo cycle.

This is cheap precisely because of the container-local coordinate model: a
snapshot is two small maps — one entry per container, one per leaf offset —
not one entry per node position, and it does not grow when a container is
resized.

## Specified behaviour

| Requirement | Detail |
| --- | --- |
| Granularity | one entry per **user-initiated step**: expand along a relation, `reveal all`, collapse/expand a container, collapse/expand all |
| Depth | full history, capped at 100 entries (oldest dropped) — not a single level |
| Redo | supported; a new step after an undo discards the redo branch, as in every editor |
| No-op steps | a probe that returns nothing records **no** entry, so undo never appears to do nothing |
| Failed steps | a failed probe records no entry |
| Jump | clicking any entry returns to the state **before** that step, unwinding intermediate steps |
| Keyboard | `Ctrl/Cmd+Z` undo, `Ctrl/Cmd+Shift+Z` redo |
| Affordance | history panel listing steps newest-first with the node count at each point; undo/redo buttons disable at the ends |
| Layout | undo re-renders with layout **off**; positions come from the snapshot |
| Scenario switch | history resets — it is per-exploration, not global |

## What is deliberately not in scope

* **Not persisted.** History lives for the session; a reload starts clean. The
  saved *view* is the durable artefact, and a view is a state, not a path. If
  history should survive reloads it belongs in the view file as an explicit
  list of steps — a reasonable v2, but it makes the view file a log and that
  deserves its own decision.
* **Not collaborative.** Undo is local to one viewer. Shared-state undo is a
  different and much harder problem.
* **Does not undo writes.** No prototype yet writes anything (issue #6's
  "add as remote" is unimplemented). When it exists, **a write must not be
  undoable through this mechanism** — a view-history control silently reverting
  a `git remote add` would be a serious surprise. Writes need their own,
  explicitly confirmed reversal.

## Implementation notes

`web/src/history.js` (~120 lines) plus wiring in `main.js`. `History.begin()`
is called *before* each mutating step and captures `visible`, `collapsed`, the
expansion log and the layout maps; `abandon()` drops the entry when the step
turned out to be empty or failed.

Verified by driving the real app with Playwright on `s2-babs-ria`:

```
nodes drawn after each step: 2 -> 51 -> 11 -> 51 -> 11 -> 3
nodes drawn while undoing:   11 -> 51 -> 11 -> 51 -> 2
undo disabled at the end:    true
redo steps: 5, back to:      3
redo position drift:         0.00 px
console errors:              0
```

The undo trail is the exact mirror of the forward trail, undo disables at the
start of history, and a full undo→redo cycle returns to the same pixels.
