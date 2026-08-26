# Team A — "Compound & Correct"

An interactive **worldmap of git and git-annex** built on **Cytoscape.js + fCoSE**, on the thesis that
*compound (nested) nodes are the decisive capability* and that *stable incremental layout* is what makes
click-to-expand usable.

The graph is **not** loaded whole. You start at one clone and the map grows as you probe.

```
                       browser (Vite bundle, no CDN, no framework)
  worldmap.json  ──►  server/app.py  ──►  Cytoscape.js 3.34  (compound nodes, per-edge labels)
  (three fixtures,     stdlib http     +  cytoscape-fcose 2.2      (randomize:false + fixedNodeConstraint)
   kept server-side,   POST /expand    +  cytoscape-layout-utilities 1.1.1  (seed NEW node positions)
   revealed by probe)  300–900 ms      +  cytoscape-node-html-label 1.2.2   (badges: +N hidden, ▲ahead, errors)
                                       +  a hand-rolled expand/collapse and a rigid container separator
```

---

## Run it

```bash
cd issue-1/prototypes/team-a
./run.sh                 # npm install (first time) + vite build + serve on http://127.0.0.1:8848
```

Then open <http://127.0.0.1:8848/>. `?scenario=s2-babs-ria` deep-links a scenario.

```bash
./run.sh dev             # backend on :8848, Vite dev server with HMR on :5273 (/api proxied)
PORT=9000 ./run.sh       # different port
```

Screenshots and measurements (app must already be running):

```bash
node scripts/capture.mjs            # writes screenshots/*.png and scripts/last-metrics.json
node scripts/capture.mjs --metrics  # measurement runs only, no screenshots
```

`scripts/capture.mjs` uses the chromium already present in `PLAYWRIGHT_BROWSERS_PATH`.
**Do not run `playwright install`.** It writes the 16 PNGs in `screenshots/` and the raw measurements in
`scripts/last-metrics.json` — every number in `UX-FINDINGS.md` comes from that file.

Requirements: Python 3 (stdlib only — FastAPI is not installed in this environment, so the service is
`http.server`-based), Node 22, npm.

---

## How to drive the UI

| Action | What happens |
| --- | --- |
| click a node | inspector on the right: every field from the fixture, plus one **probe** button per *relation* |
| **probe** | `POST /expand` with a 300–900 ms artificial delay; only the newly discovered nodes/edges come back |
| double-click a node | probes **every** relation that still has hidden edges on it, in sequence |
| double-click a container | collapse / expand it (a RIA store with 40 repos becomes one box + bundled meta-edges) |
| `+N` badge | that node still has N unprobed edges — the OpenCTI-style "there is more behind me" cue |
| findings panel | click a finding to focus its nodes; errors and warnings also raise a banner once *all* their nodes are discovered |
| **pin layout** | on = every already-placed node is pinned via fCoSE `fixedNodeConstraint`; off = the map re-shuffles on every expansion (deliberately kept as a comparison) |
| **keep containers apart** | rigid-body separation of host boxes after layout (see below) |
| **re-layout** | full unpinned fCoSE, for comparison |
| theme button | light / dark; the whole Cytoscape stylesheet is rebuilt from the CSS custom properties |

---

## Architectural argument

### 1. Containment is the data model, so containment must be the rendering model

`parent` in the fixtures is not decoration. In s2 it is three deep:
`ria.datalad.org` (host) → `ria-store /data/ria (ORA)` (a distribution that *contains* distributions) →
`sub-001 … sub-040`. Cytoscape's `parent` field nests arbitrarily and every layout, hit-test and bounding-box
call understands it. Nothing else in the MIT tier does — sigma/graphology would need hulls, and hulls do not
nest. This is the single reason the stack was chosen and it paid off: s2 renders correctly with *no*
containment code of our own beyond sorting new nodes ancestors-first.

A direct consequence: **containment edges are redundant ink.** The 40 `part` edges from the RIA store to its
repos say exactly what the nesting already says, and drawn as a starburst they destroy the picture. They are
parsed, kept, and hidden behind a toggle.

### 2. Expansion latency is the UX problem, so the layout must not also be a problem

The server sleeps 300–900 ms per probe on purpose. On top of that the client spends ~450 ms animating a
layout. If that layout *also* rearranges the map, the user pays the latency **and** loses their place. So:

* new nodes are seeded near their anchor (`cytoscape-layout-utilities.placeNewNodes()`, with a deterministic
  ring fallback that always runs first so nothing is ever left at 0,0);
* fCoSE runs with `randomize:false`, `quality:'proof'` and `fixedNodeConstraint` listing **every** already
  placed leaf node at its current position;
* the viewport is *not* re-fit unless the new nodes actually landed off-screen ("fit to new, not fit to all");
* displacement is measured on every expansion and shown in the HUD, so the claim is falsifiable in the UI
  rather than asserted in a README.

### 3. Two-tier layout: a force layout is the wrong tool for 40 identical siblings

When a container receives ≥12 new children at once, they get a **grid** inside that container, and are then
un-marked as new so the fCoSE pass pins them. The RIA store's 40 per-subject repos become a compact,
deterministic block instead of a 40-body force problem. This is the "layout a subset only / two-tier"
technique from the tech review, and it is also what keeps the 51-node scenario at interactive frame rates.

### 4. fCoSE cannot pin a compound — so move compounds as rigid bodies

`fixedNodeConstraint` does not apply to compound nodes. A host box that just grew therefore *will* overlap its
neighbour, and the fix (moving things) is exactly what pinning forbids. Rather than give up and re-layout, we
run a small rectangle-separation pass over the **top-level containers** and translate each one's entire
subtree by the same delta. Geometry *inside* a host is preserved bit-for-bit; only the host boxes slide.
Measured effect: zero overlapping container pairs at the end of every scripted run in all three scenarios.

### 5. The server is stateless; the client owns the frontier

`POST /expand` carries `known_nodes` / `known_edges`. The server diffs against the full fixture and returns
only what is new, plus a recomputed **frontier** (`{node: {relation: hidden_count}}`) which is what drives the
`+N` badges and the inspector's probe buttons. Two tabs can explore the same scenario independently, and the
whole thing survives a server restart.

One relation is synthetic: **`host_scan`** — "list the repositories on this host/store that I have not seen".
It exists because s3's identity trap (`con/project-alpha` vs `con/project-beta` vs `con/python-template`) is a
*disconnected component*: no chain of remotes or forks from the seed `~/proj/duct` ever reaches it. A real
walker finds it the way a real walker would — by scanning a host it already knows about. Without this the
scenario's headline finding is unreachable by exploration, which is itself a finding about the data model.

### 6. Two themes from one token set

Every colour is a CSS custom property; `buildStyle()` reads the computed values and returns a Cytoscape
stylesheet, so a theme switch is one call. (See "cytoscape bug" in `UX-FINDINGS.md` — the obvious way to
re-apply a stylesheet silently breaks every edge.)

---

## Layout of the code

```
server/app.py                 stdlib HTTP: /api/scenarios, /api/scenario/<id>/seed|full, POST /api/expand
web/src/api.js                fetch wrappers
web/src/model.js              fixture record -> cytoscape element; label/edge-label formatting
web/src/cy-style.js           the whole Cytoscape stylesheet, generated from CSS custom properties
web/src/graph.js              expansion engine, fCoSE pinning, grid tiling, rigid separation,
                              collapse/expand, filters, all measurement
web/src/ui.js                 sidebar, findings, banners, legend, probe log, HUD, inspector
web/src/main.js               wiring + window.__teamA test hooks
scripts/capture.mjs           Playwright: screenshots + measurement harness
```

`window.__teamA` exposes `expand`, `expandAll`, `pick`, `revealAll`, `relayout`, `setPin`, `setSeparate`,
`setTheme`, `setHideInactive`, `select`, `focus`, `metrics`, `frontier`, `positions` — the whole UX report was
produced through it.

---

## What I would do differently with more time

1. **Edge labels are the weakest part.** Per-edge remote names are the point of s1, and at fit-to-screen zoom
   they are 6 px tall and overlapping. I would replace free-floating labels with a *bundled* rendering:
   collapse all parallel edges between the same pair into one edge whose label is `origin, rolando-exchange`,
   and only fan them out on hover/selection. Cytoscape supports parallel-edge bundling geometrically but not
   semantically; the semantic part is ours to write.
2. **An aggregate-first tier.** SemSpect's model — show `github.com: 60 repos` as *one* node, drill down on
   demand — would suit s3 far better than 60 real nodes. The compound already exists; it just needs a
   "collapsed by default above N children" rule and the meta-edge bundling that collapse already implements.
3. **Persist the view.** The tech review's split `worldmap.json` / `worldmap.view.json` is not implemented:
   positions, the expanded set and filters live only in memory. A reload starts over. This is a half-day of
   work and it is the difference between a demo and a tool.
4. **Real incremental layout inside one container.** Today the fCoSE pass runs over the whole graph even
   though everything but the new nodes is pinned. Running `parent.descendants().layout(...)` scoped to the
   affected container would cut the 450 ms layout to well under 100 ms on the 68-node scenario.
5. **Web Worker for layout.** The longest frame during the 60-fork expansion is ~300–400 ms of blocked main
   thread. fCoSE has no worker mode; ELK does. A worker-based layout would remove the only real jank.
6. **`cytoscape-node-html-label` is dormant (last release 2021).** It works, but it re-parses an HTML string
   per node per data change, and it owns a DOM node per graph node. At a few thousand nodes I would vendor it
   and replace the badge rendering with canvas-drawn glyphs gated behind a zoom threshold.
7. **Undo.** "Add as remote" mutates the graph with no way back, and there is no history of the exploration
   beyond the probe log.
