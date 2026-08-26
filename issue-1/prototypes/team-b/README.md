# Team B — a graphviz-first worldmap of git and git-annex

An interactive map of repository clones that **grows as you probe it**, laid out by
**real Graphviz**, running as WebAssembly in the browser, offline.

The thesis in one line: *`git annex map` already emits DOT with `cluster_<host>` subgraphs,
Graphviz's cluster layout beats any force layout for this data, and if layout is computed
deterministically then layout is **data** — savable, diffable, shareable.*

```
worldmap.json ──(python, server/dot.py)──► DOT with cluster_<host> subgraphs
                                             │
                                             ▼  GET /api/dot/<scenario>?ids=…
                                   @hpcc-js/wasm 2.35.0  Graphviz  (browser, offline)
                                             │  format "json"  →  node pos=, cluster bb=,
                                             ▼                     edge spline pos=
                                   cytoscape 3.34  layout: { name: 'preset' }
                                             │
                            ┌────────────────┴─────────────────┐
                            ▼                                  ▼
                  worldmap.view.json                 self-contained export.html
                  (positions + routes + expanded set)  (coordinates, no layout engine)
```

---

## Run it

```bash
cd issue-1/prototypes/team-b
./run.sh                 # npm install + vite build + python server on 127.0.0.1:8391
```

Then open <http://127.0.0.1:8391>. Nothing else is needed — no database, no CDN, no network.

```bash
./run.sh screenshots     # re-drive the app with Playwright, refresh screenshots/
./run.sh exports         # regenerate exports/ and verify them by loading file:// in Chromium
./run.sh measure         # re-run the timing + layout-churn benchmark
./run.sh dev             # vite dev server on :5173 with HMR
```

Environment note: no FastAPI in this image, so the server is **stdlib `http.server`**
(`ThreadingHTTPServer`). It is ~430 lines and has no dependencies at all.

### API

| method | route | what |
| --- | --- | --- |
| GET | `/api/scenarios` | the three worldmaps, metadata only |
| GET | `/api/seed/{scenario}` | **only** the `is_seed: true` node plus its containment chain |
| POST | `/api/expand` | `{scenario, node_id, relation, known[]}` → *newly discovered* nodes/edges, after an artificial **300–900 ms** probe delay |
| POST | `/api/materialize` | `{scenario, ids[]}` → those nodes/edges (used to rehydrate a saved view) |
| GET | `/api/dot/{scenario}?ids=…` | **DOT for the visible subgraph**, server-side |
| GET | `/api/full/{scenario}` | the whole worldmap (debug) |
| GET | `/api/roots/{scenario}` | entry points into components **unreachable from the seed** |
| GET/PUT | `/api/view/{scenario}?name=…` | load / save a view file (canonicalised server-side) |
| GET | `/api/views/{scenario}` | list saved view names |
| GET | `/export/{scenario}?name=…` | self-contained single-file interactive HTML |

**s3-forks is not one connected component.** The template-sibling trap
(`con/project-alpha`, `con/project-beta`, `con/python-template`, `~/proj/project-alpha`) shares no
edge with the fork network around `con/duct`, so *no sequence of expansions from the seed can
ever reach it*. Rather than pretend otherwise, `/api/roots` computes the components that do not
contain a seed and the sidebar grows a **"Not reachable by expanding"** panel offering their entry
points. Click it and you are back in normal exploration mode from a second root.

Findings are **not** shown up front: `findings_for()` only emits a finding once *every* node it
mentions is on screen. s1's duplicate-annex-UUID error is therefore something you *discover*,
not a banner you were handed.

---

## The DOT round trip, concretely

`server/dot.py` turns a worldmap into DOT the way a real `git annex map --json` integration would:

* `parent` (host → clone, RIA store → repo, superdataset → subdataset) becomes
  `subgraph cluster_<id>`, recursively.
* Every node and cluster carries `id="<original id>"`, which Graphviz echoes back in its JSON
  output — so mapping coordinates back to worldmap ids is exact, not a name-mangling guess.
* A container that is *also* a distribution (a RIA store) is emitted as a `shape=point` anchor
  inside its own cluster, so edges pointing at the store still route, while the box itself is
  drawn by cytoscape as a compound node.
* Edges that merely restate `parent` are dropped — containment is drawn by nesting.
* **Gridding.** A container with ≥10 leaf children (the RIA store's 40 per-subject repos,
  github.com's 60 forks) gets its children chunked into `rank=same` groups joined by
  `style=invis` edges, and every edge touching that cluster gets `constraint=false`.
  Without this, `dot` stacks the RIA store into a single **1066 × 3504 pt** column;
  with it the same graph is **1336 × 1461 pt**.

The browser then calls `graphviz.layout(dot, 'json', 'dot')` and reads:

* `objects[].pos` — node centres (points, y-up) → cytoscape positions (y-down);
* `objects[].bb` on `cluster_*` — cluster geometry (we let cytoscape derive compound boxes from
  the children Graphviz placed, so the geometry survives);
* `edges[].pos` — the **spline waypoints**, which we re-express as cytoscape
  `curve-style: segments` (`segment-weights` / `segment-distances`). That is real Graphviz edge
  routing inside an interactive canvas, not straight lines.

> **Correction to the brief.** The brief says to use output format `dot_json`. In
> `@hpcc-js/wasm` 2.35.0, `dot_json` and `xdot_json` return the **parsed DOT AST with no
> coordinates at all** — we verified this: the node objects come back with `width`/`height`/`label`
> and no `pos`. The format that carries layout results is plain **`json`** (xdot-augmented).
> Everything here uses `'json'`.

---

## What the UI does

* **Cluster map** — Graphviz cluster layout as a cytoscape `preset`. Hosts, forges, clouds and
  RIA stores are compound nodes; per-edge labels carry the **remote name** plus `▲ahead ▼behind`.
  s1's point lands immediately: the same peer is `origin` from lena, `origin` from typhon and
  `rolando-exchange` from three other clones, and the reverse edge is
  `spacetop-rolando-exchange`.
* **Layered lineage** — `cytoscape-elk` 2.3.0 `elk.layered`. ELK alone puts all 60 forks in one
  4 500 px-tall layer, so fans (nodes whose only lineage edge lands on the same hub) of ≥12 are
  pulled out, laid out as a grid beside the hub sorted by activity, and ELK runs on the
  remaining skeleton in a **throwaway headless cytoscape instance** (removing and restoring
  elements under the live canvas renderer leaves stale edge caches and throws).
* **Badges & errors** — duplicate annex UUID gets a double red border on both nodes *and* a
  thick red `same annex UUID` edge; a dead remote is dashed and dimmed; unmerged RIA result
  branches get an amber border (12 of 40 in s2); forks with `ahead_of_upstream === 0` are
  greyed and their edges dropped to 18 % opacity.
* **Save / load / continue** — genuinely round-trips: `views/*.view.json` stores the expanded
  set, the expansion log, integer positions for both view modes, pinned nodes and edge routes.
  Loading rehydrates via `/api/materialize` and applies the saved coordinates **verbatim, with
  no layout run** — measured drift on reload: **0 px across 14 nodes**.
* **Export** — `GET /export/{scenario}` inlines a 448 kB IIFE bundle (cytoscape only), the CSS,
  and the data + coordinates into one HTML file. Because layout is data, the export needs **no
  layout engine at all**; it is still pannable, zoomable, clickable and theme-switchable.
* Light and dark themes, both driven from one palette (`web/src/palette.js` for cytoscape,
  CSS variables for the chrome).

---

## The view file, and a real diff

Canonicalised **server-side** on PUT: sorted keys, sorted id lists, 2-space indent, one field
per line, `Math.round`ed integer coordinates. Two saves of an unchanged state produce identical
bytes except `saved_at`.

Here is the actual `diff -u` between two saves of s1 — `step1` (four expansions) and `step2`
(one more, `d:rolando-x` / `remote`), both produced by `tools/drive.mjs`:

```diff
--- views/s1-spacetop.step1.view.json
+++ views/s1-spacetop.step2.view.json
@@ -9,6 +9,10 @@
       "relation": "remote"
     },
     {
+      "node": "d:rolando-x",
+      "relation": "remote"
+    },
+    {
       "node": "d:smaug",
       "relation": "remote"
     },
@@ -26,35 +30,39 @@
     "map": {
       "d:dead": {
         "x": 644,
-        "y": 716
+        "y": 381
       },
       "d:discovery": {
         "x": 385,
-        "y": 214
+        "y": 852
       },
       "d:discovery-copy": {
         "x": 644,
-        "y": 214
+        "y": 852
       },
       ...
+      "d:hjlaptop": {
+        "x": 385,
+        "y": 516
+      },
       "d:lena": {
         "x": 126,
-        "y": 519
+        "y": 896
       },
@@ ...
-  "saved_at": "2026-08-26T01:28:57Z",
+  "saved_at": "2026-08-26T01:29:10Z",
```

Full diff: `diff -u views/s1-spacetop.step1.view.json views/s1-spacetop.step2.view.json`
— **90 changed lines in a 155-line file for one expansion.**

That diff is exactly as readable as promised, and it is also the **indictment of the approach**.
The change is semantically two lines (one expansion, two new nodes) and it rewrote almost every
coordinate, because a fresh `dot` run re-ranks the whole graph. Diff-friendly *formatting* does
not give you a diff-friendly *file* if the generator is not incrementally stable. See
`UX-FINDINGS.md` for the measured churn.

---

## Layout: what is honest about it

| | s1-spacetop | s2-babs-ria | s3-forks |
| --- | --- | --- | --- |
| nodes / edges (full) | 24 / 25 | 51 / 87 | 68 / 66 |
| DOT emitted | 4.6 kB | 9.7 kB | 12.5 kB |
| Graphviz `dot` layout, warm | **7 ms** | **13 ms** | **17–24 ms** |
| full re-render (rebuild + layout + style), median of 10 | **54 ms** | **55 ms** | **65 ms** |
| Graphviz bounding box (pt) | 1547 × 1052 | 1336 × 1461 | 2066 × 2206 |

Graphviz is not the bottleneck and never gets close to being one at this scale. The bottleneck is
the 300–900 ms simulated probe — which is *correct*, because a real `git ls-remote` over ssh is
worse.

**Grid regularisation.** Graphviz honours `rank=same` for the *columns* of a gridded cluster but
then staggers rows to make room for splines: the 60 forks came back with 8 distinct x values and
**50 distinct y values**. So the server tags each gridded node with `gridpos="col,row"`, Graphviz
echoes it, and the client snaps those nodes onto a true grid and pulls everything Graphviz put
below the block up by the height that snapping recovered. Edges touching snapped nodes fall back
to beziers, since Graphviz's waypoints for them are no longer meaningful.

---

## What I would do differently

1. **Do not re-run `dot` on the whole graph after every expansion.** This is the single biggest
   mistake in the design, and it is measured: expanding `d:proj-a`/`shares_history_with` in s3
   moved **62 of 62** already-placed nodes by a **median of 1588 px**. The right architecture is
   two-tier: run `dot` once per *cluster* to get intra-host geometry, freeze those boxes, and use
   a cheap packing pass for the boxes themselves. Then an expansion inside one host cannot move
   another host. The `keep placed nodes` checkbox in the toolbar is a blunt stand-in for this: it
   pins everything already on screen and only lets new nodes take Graphviz coordinates, which
   preserves the mental map but eventually produces overlaps because Graphviz was never told
   about the pins.
2. **Emit `pos=` back into the DOT.** Graphviz accepts `pos="x,y!"` with `neato -n`, so a saved
   view could be fed *back* into Graphviz as pinned input instead of being applied only on the
   cytoscape side. That would make "hand-nudge a node, re-crawl, re-layout" coherent.
3. **Aggregate before expanding.** s3's 60-way fan and s2's 40-way fan are both handled by
   special-case gridding. The general answer is SemSpect's: expand to a *count* first
   ("60 forks, 8 with new commits") and let the user drill in. I would build that instead of the
   grid heuristics.
4. **Keep the DOT generation in the browser too.** Every expansion currently costs an HTTP round
   trip for the DOT (44–95 ms locally, and it is the *second* slowest thing after the probe).
   The generator is 120 lines of Python; porting it to JS and keeping the server one as the
   reference implementation would remove that hop and let the export re-layout too.
5. **The export should carry the walker's provenance**, not just coordinates —
   `observed_at`/`via` per node are in the data and not yet shown anywhere in the UI.

## Screenshots

All produced by `tools/drive.mjs` / `tools/export-check.mjs` against the running app.

| file | what |
| --- | --- |
| `s1-01-seed.png` | seed only — one clone on lena, nothing probed |
| `s1-02-mid-expansion.png` | after one probe of lena's remotes: six host clusters, per-edge remote names |
| `s1-03-duplicate-uuid.png` | the duplicate annex UUID error, discovered |
| `s1-04-duplicate-uuid-light.png` | same, light theme |
| `s1-05-dot-roundtrip.png` | the DOT the browser is about to lay out |
| `s1-06-after-second-save.png` | s1 fully expanded, second view saved |
| `s1-07-reloaded-step1.png` | step1 restored from file, no layout run |
| `s2-01-seed.png` / `s2-02-ria-discovered.png` | BABS superdataset, then the RIA store as a collapsed remote |
| `s2-03-ria-expanded.png` | RIA cluster expanded: 40 gridded repos, 12 UNMERGED in amber |
| `s2-04-lineage.png` | layered lineage of s2 |
| `s3-01-seed.png` / `s3-02-upstream.png` | plain-git clone with no UUID; upstream found via `origin` |
| `s3-03-forks-map.png` | 60 forks gridded inside the github.com cluster |
| `s3-04-lineage-greyed.png` | layered lineage: 8 active forks by hub, 52 inactive greyed |
| `s3-05-lineage-light.png` | same, light theme |
| `s3-07-other-component.png` | the second connected component, revealed explicitly |
| `s3-08-template-trap.png` | `candidate_same_as` rejected at containment 0.19 |
| `s3-09-template-trap-zoom.png` | zoomed onto the identity-ambiguous finding |
| `export-*-file-url*.png` | the exports, loaded over `file://` with the network blocked |

## Layout of this directory

```
server/app.py      stdlib HTTP server: seed, expand, materialize, dot, view, export
server/dot.py      worldmap.json → Graphviz DOT (clusters, gridding, ids)
web/src/graph.js   shared: DOT-json parsing, spline→segments, element model, cytoscape style
web/src/main.js    the explorer app (expansion, layouts, save/load, timings HUD)
web/src/viewer.js  the export bundle's entry point (no fetch, no layout engine)
web/src/palette.js light/dark colours for cytoscape
tools/drive.mjs    Playwright: every screenshot + the saved views
tools/export-check.mjs  builds exports/, then loads them over file:// with the network blocked
tools/measure.mjs  timing + layout-churn benchmark
views/             saved view files (checked in — they are the point)
exports/           self-contained single-file HTML, ~460–490 kB each
screenshots/       real Playwright PNGs
```

Licences: cytoscape MIT, `@hpcc-js/wasm` Apache-2.0 (Graphviz itself EPL, shipped as a WASM
blob), `cytoscape-elk` MIT over elkjs (EPL-2.0 OR GPL-3.0 — pick EPL; it is only needed for the
lineage view and the export does not contain it).
