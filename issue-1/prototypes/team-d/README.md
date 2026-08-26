# Team D — the two-tier worldmap explorer

Built after the three-team bake-off, to the specification in
[`../BAKE-OFF-RESULTS.md`](../BAKE-OFF-RESULTS.md). The bake-off's judgement
was: take Cytoscape as the base, stop laying containers out incrementally,
adopt team B's persistence and export, treat collapse as edge aggregation, move
layout off the main thread, and replace the seed with a root set. That is what
this is.

```
./run.sh              build web/dist and serve on http://127.0.0.1:8861
./run.sh dev          python API on :8861 + vite dev server on :5273
./run.sh measure      re-run the measurement harness -> tools/last-metrics.json
./run.sh screenshots  re-drive every PNG in screenshots/
./run.sh exports      regenerate exports/ and verify them over file://
./run.sh check        blank-screenshot detector
./run.sh all          all four, against an already-running server
```

Numbers: [`COMPARISON.md`](COMPARISON.md). Criticism:
[`UX-FINDINGS.md`](UX-FINDINGS.md). Raw measurements:
`tools/last-metrics.json`, `tools/last-drive.json`,
`tools/last-export-check.json`, `tools/last-screenshot-check.json`.

---

## The architecture in one page

### Tier 1 — containers, from a whole-graph pass over the container graph

A *container* is any node that holds other nodes: a host, a RIA store, a
superdataset. Tier 1 gives every container its world geometry by running
Graphviz `dot` (`@hpcc-js/wasm` 2.35.0, output format **`json`** — xdot — not
`dot_json`, which carries no coordinates) over a graph that contains **only the
containers**, sized boxes joined by aggregated edges. There are no clusters in
that DOT and no fans, so none of team B's three `dot` hacks (`rank=same`
gridding, server-emitted `gridpos`, client-side grid snapping) are needed:
`server/dot.py`'s job shrank to `web/src/dot.js`, 56 lines.

Tier 1 runs **only when the set of containers changes**, and even then in
*sticky* mode: every container already on screen keeps its exact position, and
only the new ones take a position from Graphviz, dropped into the nearest free
spot (`geometry.js:findFreeSpot`).

When a container's contents grow, it is **not** relaid out and it does **not**
move. Its box grows, anchored at its **top-left corner**, extending right and
down; only neighbours that no longer fit are translated rigidly
(`geometry.js:separate`). Shrinking (a collapse) is anchored identically, which
is what makes a collapse→expand round trip cost 0.000 px.

### Tier 2 — leaves, in container-local coordinates

Every child's position is stored as the offset of its **top-left corner from
its container's top-left corner**. That single choice is what makes the whole
thing work:

* a container that grows from a fixed corner leaves every offset valid, so
  nothing inside moves and nothing escapes the box;
* a leaf's world position depends only on its own container's corner, so an
  expansion inside one container provably cannot move anything outside it;
* a saved view stores offsets, so moving or growing a container rewrites one
  line of the file instead of one line per child.

Placement inside a box is fcose 2.2.0 with `fixedNodeConstraint` pinning every
already-placed sibling, seeded from the slot grid, clamped to the box, and then
separated. If the result cannot be made overlap-free inside the fixed
rectangle, the container falls back to its slot grid. See UX-FINDINGS #1 for
how often that happens — it is the biggest negative result here.

### No cytoscape compound nodes

Containers are ordinary cytoscape nodes with an explicit `width`/`height` and
an explicit position, drawn behind their children with a manual `z-index`.
Cytoscape derives a compound's geometry from its children, and no layout can
pin it — that is exactly team A's 980 px jump. Taking the geometry away from
cytoscape is the precondition for tier 1.

### Both tiers in a Web Worker

`web/src/layout-worker.js` runs Graphviz *and* cytoscape-headless + fcose.
Neither needed adaptation: cytoscape runs `headless: true, styleEnabled: true`
without touching the DOM, and `@hpcc-js/wasm` inlines its wasm as base64 so
there is nothing to fetch. The main thread only applies preset positions.

### Collapse aggregates edges

`web/src/collapse.js` maps both endpoints of every edge onto their outermost
collapsed ancestor. Edges whose ends land on the same box are folded away and
counted; the rest are merged by `(source-box, target-box, relation)` into one
edge carrying a count and the set of distinct remote names.
`collapse.js:verify()` asserts that both the node count and the edge count
fall, and `tools/measure.mjs` checks that assertion for every container in
every scenario.

### `contains` is a relation, not a rendering hint

The server derives a `contains` edge from every `parent` and puts it in the
edge list, so it appears in `rel_counts`, can be expanded along like any other
relation, and counts in reachability. `GET /api/roots` returns every component
root; `POST /api/reach` answers "what can this visible set still reach" and
drives the always-on **"N nodes not reachable from here"** counter.

### Label-on-demand

`web/src/labels.js`. Almost no edge is labelled; the ones that are are drawn at
`13 / zoom` model px so they render at a constant **13 CSS px** at any zoom.
Nodes whose remote name is disputed get an orange border, a `⇄ 2 names` badge,
and one labelled edge per distinct name — which puts issue #1's sentence in the
default picture instead of in an inspector.

---

## What we borrowed, and from whom

| From | What | Where it landed |
| --- | --- | --- |
| **Team B** | `server/app.py` structure: stdlib `http.server`, the probe-latency model, `/api/seed`, `/api/expand`, `/api/materialize`, findings-fire-when-complete | `server/app.py` — forked, then extended with `contains`, `/api/roots`, `/api/reach`, directional relations |
| **Team B** | the canonical view file (sorted keys, integer coordinates, one field per line) | `server/app.py:canonical_view`, format `worldmap-view/2-twotier` |
| **Team B** | the whole self-contained export: `EXPORT_TEMPLATE`, the second Vite `lib` build producing one IIFE with cytoscape inlined, `tools/export-check.mjs` | `server/app.py:build_export`, `web/vite.viewer.config.js`, `web/src/viewer.js` |
| **Team B** | `parseGraphvizJson` and the Graphviz→cytoscape y-flip | `web/src/dot.js` (simplified: tier 1 has no clusters and no splines) |
| **Team B** | `palette.js`, both themes | `web/src/palette.js` + two colours |
| **Team B** | most of the cytoscape stylesheet (`nodeClasses`, `chipsFor`, `edgeLabel`, `wrapLabel`, the per-relation edge styles) | `web/src/graph.js` |
| **Team A** | fcose with `fixedNodeConstraint` at `quality: 'proof'`, which they proved pins leaves at 0.00 px | `web/src/layout-worker.js:tier2` — applied per container instead of per graph |
| **Team A** | the displacement metric itself: report leaves and containers separately, never aggregate them | `web/src/layout.js` metrics, extended with corner/anchor/inside/outside buckets |
| **Team A** | four stack bugs, all avoided: `cy.style(arr)` on a populated graph (we empty it first), `rgba()` custom properties (we pass hex), `node-html-label` (not used), animated `cy.fit` races (no animated fits at all) | throughout |
| **Team C** | collapse as a first-class tier, and their finding that node-hiding alone makes things worse | `web/src/collapse.js` — rebuilt as edge aggregation |
| **Team C** | the "grey out inactive" treatment and the perspective idea (reduced here to a label-policy switch) | `web/src/graph.js`, HUD |
| **All three** | the blank-screenshot audit method | `tools/check-screenshots.mjs` |

Not borrowed: team B's spline replay (tier 1 emits `splines=false`; there are
no long routed edges left to replay), team B's `rank=same` gridding (tier 2
owns fans now), team A's compound nodes, team A's rigid container separator
(replaced by top-left-anchored growth), team C's sigma renderer.

---

## Layout of the code

```
server/app.py            650 lines, stdlib only. Fork of team B's, plus
                         contains / roots / reach / directional relations.
web/src/
  geometry.js     208    pure geometry: slot tiers, box sizing, top-left slot
                         frames, overlap separation, free-spot search
  dot.js           56    the container-tier DOT, and the xdot json parser
  layout-worker.js 215   THE WORKER: graphviz tier 1, fcose tier 2
  layout.js        359   the orchestrator, the sticky rule, the metrics
  collapse.js       93   edge aggregation + the verify() assertion
  labels.js         90   label policy and constant-screen-size compensation
  graph.js         351   cytoscape elements + stylesheet (mostly team B's)
  viewpos.js        39   saved view -> world positions (shared with the export)
  main.js          593   the app shell
  viewer.js        175   the offline export's entry point
tools/
  measure.mjs      351   every number in COMPARISON.md
  drive.mjs        189   every PNG in screenshots/
  export-check.mjs  68   exports/ + the file:// verification
  check-screenshots.mjs  the blank detector
```

---

## What I would do differently

1. **I would not have started from fcose.** The mandate said leaves should be
   placed by fcose inside fixed container bounds, and I built exactly that —
   and then measured that fcose's output survives in **2 of the 20** tier-2
   runs the three scenarios trigger (4 of 40 counting the `full`-mode control).
   In every other case either the container's children have no edges among them
   (a fan of 40 per-subject repos: nothing for a force layout to optimise) or
   the force result cannot be made overlap-free inside a fixed rectangle and
   the slot grid replaces it. A constrained *packing* algorithm — strip
   packing with sticky assignments — is the right tool for tier 2, and fcose
   should be kept only for the small, genuinely-connected case.

2. **I would make the container tier hierarchical from the start.** Tier 1
   currently lays out only top-level boxes; nested containers get their place
   from their parent's tier-2 run. It works because the fixtures nest two deep.
   A store inside a store inside a host would want tier 1 to run recursively.

3. **I would aggregate edges while expanded, not only while collapsed.** s2
   fully expanded draws 83 edges for 46 nodes, and 40 of them are the identical
   `origin` fan from the RIA repos to the superdataset. Aggregation already
   knows how to fold those; it should be allowed to fold *parallel* edges
   between the same two boxes without requiring a collapse. See UX-FINDINGS #4.

4. **The view format should carry a schema version and a size table for every
   node**, not only for non-default ones. Half a pixel of reload drift
   (0.462 px worst) comes from reconstructing a container's centre from a
   rounded box; storing top-left corners instead of centres would make the
   round trip exact and would also make the file easier to read.

5. **`contains` should have been in the model from the beginning.** Adding it
   server-side took 20 lines and closed the failure that broke all three
   previous teams. It belongs in `repo-embedded-things-and-collections.md`, not
   in three separate client-side workarounds.
