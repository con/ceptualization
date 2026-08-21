# Generic interactive graph visualization & exploration technology

Research for **con/ceptualization issues [#1](https://github.com/con/ceptualization/issues/1),
[#4](https://github.com/con/ceptualization/issues/4), [#5](https://github.com/con/ceptualization/issues/5),
[#6](https://github.com/con/ceptualization/issues/6)** — the "git walker/drawer" / *worldmap of git and git-annex*.

**Scope of this document:** only the *technology layer* that renders and drives the interactive map.
The walker/collector/schema side is out of scope here.

**Verification method & date.** All version numbers, dates and licenses in the tables below were read on
**2026-08-21** from the npm registry API (`registry.npmjs.org/<pkg>`), from package READMEs served by that
API, or from the project's GitHub/GitLab page. Anything I could not confirm from a primary source is marked
`[UNVERIFIED]`. Star counts are approximate (rounded, as GitHub displays them).

---

## TL;DR — recommended stack

### Primary recommendation: **Cytoscape.js + fCoSE + a thin Vite/Svelte shell, fed by a Python walker, with a split data/view JSON persistence model**

```
  walker (Python)                 renderer (static browser app)
  ─────────────────               ─────────────────────────────
  git / git-annex info  ──►  worldmap.json      ──►  Cytoscape.js 3.34 (MIT)
  ssh crawl, forge API       (facts: nodes,          + cytoscape-fcose      (compound-aware layout)
  git annex map --json        edges, badges)         + cytoscape-layout-utilities (place NEW nodes only)
                                                     + cytoscape-elk / -dagre (optional DAG view for #6)
                             worldmap.view.json ──►  + cytoscape-popper / -node-html-label (badges, balloons)
                             (positions, expanded     + cytoscape-cxtmenu (right-click "expand")
                              set, filters, pins)
```

Why this wins for *this* problem, concretely:

1. **Compound (nested) nodes are first-class.** The graphviz output in issue #1 is built entirely out of
   `cluster_typhon.dartmouth.edu`-style subgraphs. Cytoscape.js models this natively (`parent` field on a
   node), and it nests arbitrarily deep — which is exactly what issue #4 (subdatasets inside subdatasets)
   needs. sigma.js, force-graph, cosmos and NetV.js **have no compound-node model at all**; that single
   fact eliminates most of the "fast WebGL" tier.
2. **Multi-edges, self-edges and per-edge labels** are native (`curve-style: bezier` auto-bundles parallel
   edges; loops render). Issue #1 requires exactly this: two clones connected by *two* differently-named
   remotes, and `laptop-clone-name --> laptop-clone-name` self-edges.
3. **Incremental, mental-map-preserving layout exists and is documented**: `cytoscape-fcose` supports
   `randomize:false` plus `fixedNodeConstraint` (pin every already-placed node), `alignmentConstraint` and
   `relativePlacementConstraint`; `cytoscape-layout-utilities` exists *specifically* to choose good initial
   positions for newly added nodes before an incremental layout runs. That is the entire click-to-expand UX
   requirement, off the shelf.
4. **Badges/decorations**: multiple stacked `background-image`s per node, pie-chart node backgrounds,
   `min-zoomed-font-size` / `text-max-zoom` for LOD, plus `cytoscape-popper` and
   `cytoscape-node-html-label` for real HTML overlays — which is where the "aheadness balloons" of issue #5
   live, animated via `node.animate()`.
5. **Serializable state**: `cy.json()` round-trips elements, data, positions, zoom/pan and style. Combined
   with the split-file scheme below it is git-diffable.
6. **Headless mode in Node.js** — same library can pre-compute a layout server-side and emit a static
   SVG/PNG for a README, satisfying the "renderer" half of issue #1 without a browser.
7. MIT, no CLA, no license key, no telemetry, ~11k stars, released **3.34.1 on 2026-08-11** — actively
   maintained, and the single most-forked-into-scientific-tools graph library in existence.

**Bootstrap shortcut worth taking seriously:** `git annex map` already emits DOT with `cluster_<host>`
subgraphs (see issue #1). Run that DOT through **`@hpcc-js/wasm`** (Apache-2.0, Graphviz compiled to WASM,
v2.35.0 2026-07-24) with output format `json` / `dot_json`, and you get **node positions computed by real
Graphviz, in the browser, offline**. Feed those as a Cytoscape.js `preset` layout. You get graphviz-quality
cluster layout on first paint and fCoSE only for incremental growth. This is the cheapest possible path from
"what exists today" to "interactive worldmap".

### Alternative recommendation: **sigma.js v3 + graphology, i.e. fork/extend Gephi Lite**

Take this instead if the node count is expected to blow past ~5–10k (thousands of subdatasets × clones), or
if you want Gephi's filtering/appearance model for free. `sigma` 3.0.3 (MIT, 2026-04-30) is WebGL and
comfortably handles tens of thousands of nodes; `graphology` (MIT) gives you a proper graph data structure
with GEXF/GraphML serializers. **Gephi Lite** (GPL-3.0, TypeScript/React on exactly this stack, self-hostable
via its Dockerfile) is a working, polished application you could fork.
**The cost is real:** sigma has *no compound/cluster nodes*. Host grouping would have to be faked with
convex hulls, background circles or a cluster-aware layout — and nested subdatasets (issue #4) become hard.
Also, GPL-3.0 on Gephi Lite propagates to your fork.

### The one thing I would *not* do
Do not build the interactive tool on Mermaid, Graphviz-only, D2 or PlantUML. They are excellent
*renderers* and a good fallback for a static README picture, but none of them has a node identity you can
click, no incremental expansion, and no place to store positions the user nudged. Keep them as an **export
target**, not as the app.

---

## 1. Browser graph rendering libraries

Legend for verdicts: **REUSE** = adopt directly · **BASE** = viable foundation, more work ·
**IDEA** = steal the UX/format, don't adopt the code · **REJECT** = ruled out.

| Library | URL | License | Latest (date) | Compound/cluster nodes | Edge labels | Multi/self edges | Incremental stable layout | Click-to-expand | Serializable view state | Practical size | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **Cytoscape.js** | github.com/cytoscape/cytoscape.js | MIT | 3.34.1 (2026-08-11) | **Yes, native, nested** | Yes (style) | Yes (bezier bundling, loops) | Yes via fcose constraints + layout-utilities | DIY (~50 LOC) or complexity-mgmt ext | `cy.json()` incl. positions+zoom/pan | ~2–10k elements (canvas) | **REUSE (primary)** |
| **sigma.js v3** | github.com/jacomyal/sigma.js | MIT | 3.0.3 (2026-04-30) | **No** | Yes (v3, incl. on curved edges via `@sigma/edge-curve`) | Curved edges yes; parallel-edge handling manual | Via graphology-layout (ForceAtlas2) supervisor; pinning is manual | DIY | Via graphology + GEXF/GraphML | 10k–100k (WebGL) | **BASE (alternative)** |
| **graphology** | github.com/graphology/graphology | MIT | 0.26.0 (2025-01-26) | n/a (data structure) | n/a | Yes (multigraph type) | n/a | n/a | `graphology-gexf` 0.13.2, `graphology-graphml` 0.5.2 | n/a | **REUSE** (as model, even under Cytoscape) |
| **vis-network (vis.js)** | github.com/visjs/vis-network | Apache-2.0 OR MIT | 10.1.2 (2026-08-19) | Clustering (collapse-into-one), not true nesting | Yes | Yes | Physics-based; `stabilize` control | Yes, `clusterByX`/`openCluster` idiom | `getPositions()`, manual | "a few thousand" (README) | **BASE** |
| **React Flow (@xyflow/react)** | github.com/xyflow/xyflow | MIT | 12.11.3 (2026-08-12) | Yes — sub-flows via `parentId` | Yes (`EdgeLabelRenderer`) | Yes | No auto layout at all (bring ELK/dagre) | Trivial (React state) | **`toObject()` → `{nodes,edges,viewport}`, documented Save&Restore example** | ~1–3k nodes (DOM) | **BASE (strong for hand-adjustable)** |
| **Svelte Flow (@xyflow/svelte)** | github.com/xyflow/xyflow | MIT | 1.6.3 (2026-08-12) | Same as React Flow | Yes | Yes | No | Trivial | Same | ~1–3k | **BASE** |
| **AntV G6 v5** | github.com/antvis/G6 | MIT | 5.1.1 (2026-05-08) | **Yes — "Combos", nestable, expand/collapse built in** | Yes | Yes | Layout per-element supported | **Combo expand/collapse is a built-in interaction** | JSON data model | ~5–10k | **BASE (closest competitor to Cytoscape)** |
| **force-graph / 3d-force-graph** | github.com/vasturiano/force-graph | MIT | 1.51.4 / 1.80.0 (2026-04) | No | Yes | Yes | d3-force, reheat on change | Yes (common demo) | DIY | 5k–50k (canvas/WebGL) | IDEA |
| **@memgraph/orb** | github.com/memgraph/orb | Apache-2.0 | 1.0.2 (2026-08-12) | No | Yes | Yes | force/GPU/hierarchical | DIY | DIY | 10k+ | IDEA |
| **reagraph** | github.com/reaviz/reagraph | Apache-2.0 | 4.32.0 (2026-06-25) | Clusters (visual grouping) | Yes | Yes | three.js/WebGL | Yes | DIY | 10k+ | IDEA |
| **cosmos.gl (`@cosmos.gl/graph`)** | github.com/cosmograph-org/cosmos | **MIT** | 3.4.1 (2026-08-13) | Point clustering force only | No | n/a | GPU simulation | DIY | DIY | 100k–1M+ | REJECT (no labels/compounds) |
| **`@cosmograph/cosmos`, `@cosmograph/react`** | cosmograph.app | **CC-BY-NC-4.0 — non-commercial only** | 3.4.1 / 2.5.1 (2026-07/08) | — | — | — | — | — | — | — | **REJECT (license)** |
| **NetV.js** | github.com/ZJUVAI/NetV.js | MIT | — (~110★, academic) | No | No | n/a | No | No | No | 50k nodes / 1M edges (paper) | REJECT |
| **ngraph.* / VivaGraphJS** | github.com/anvaka | BSD-3 | ngraph.graph 20.1.2 (2026-02-14); vivagraphjs 0.12.0 (2019) | No | Weak | Yes | Yes (streaming layout) | DIY | DIY | very large | IDEA |
| **D3-force (raw)** | d3js.org | ISC | d3-force 3.0.0 (2021-06-05) | No | DIY | DIY | Yes (`alphaTarget`, `fx/fy` pinning) | DIY | DIY | ~2k SVG | IDEA (pinning technique) |
| **WebCoLa** | github.com/tgdwyer/WebCola | MIT | 3.4.0 (2019-05-10) | **Yes — group/hull constraints** | DIY | DIY | Yes (constraint-based, very stable) | DIY | DIY | ~1k | IDEA / via `cytoscape-cola` |
| **deck.gl / PixiJS as graph renderers** | deck.gl 9.3.10, pixi.js 8.20.0 | MIT | 2026-08 | No (you build it) | You build it | You build it | You build it | You build it | You build it | 1M+ | REJECT (too much work) |
| **GoJS** | gojs.net | **Proprietary** (`SEE LICENSE IN license.html`), 4.0.3 (2026-07-17) | — | Yes | Yes | Yes | Yes | Yes | Yes | large | **REJECT (commercial)** |
| **yFiles for HTML** | yworks.com | **Commercial, per-developer** | — | Yes | Yes | Yes | Yes ("incremental layout" is a flagship feature) | Yes | Yes | large | **REJECT (commercial)** — but the best reference implementation of incremental layout |
| **Ogma (Linkurious)** | linkurious.com/ogma | **Commercial** | — | Yes | Yes | Yes | Yes | Yes | Yes | 100k+ | **REJECT (commercial)** |
| **KeyLines / ReGraph (Cambridge Intelligence)** | cambridge-intelligence.com | **Commercial** | — | Yes (combos) | Yes | Yes | Yes | Yes | Yes | large | **REJECT (commercial)** |
| **Neo4j NVL (`@neo4j-nvl/*`)** | neo4j.com/docs/nvl | `SEE LICENSE IN LICENSE.txt` — **not OSI open source** | — | No | Yes | Yes | Yes | Yes (powers Browser/Bloom) | Yes | large | **REJECT (license)** |

> **npm name-squat warning.** The npm packages `ogma`, `keylines`, `regraph`, `yfiles` and `d2` are
> unrelated abandoned packages, **not** the commercial products of the same name. Do not `npm i ogma` and
> think you have Linkurious Ogma.

### Cytoscape.js extension inventory (all MIT, all verified on npm 2026-08-21)

| Extension | Version (date) | Role in the worldmap | Health |
|---|---|---|---|
| `cytoscape-fcose` | 2.2.0 (2023-01-17) | Main layout. Compound-aware spring embedder. `randomize:false` (needs `quality:'proof'`), `fixedNodeConstraint`, `alignmentConstraint`, `relativePlacementConstraint`. | Stable, low churn |
| `cytoscape-layout-utilities` | 1.1.1 (2021-06-25) | **The click-to-expand enabler.** Places newly added nodes sensibly (quadrant/crowding heuristic around their placed neighbour) *before* an incremental layout runs. | Stable, low churn |
| `cytoscape-elk` | 2.3.0 (2024-11-26) | Sugiyama/layered layout for the "DAG of advances" view (issue #6) and for hierarchical subdataset trees (#4). ELK handles nested compound graphs. | Active |
| `cytoscape-dagre` | 4.0.0 (2026-06-04) | Lighter layered layout alternative. | Active |
| `cytoscape-cola` | 2.5.1 (2022-02-23) | Constraint layout with group/hull support; good for "keep hosts apart". | Dormant but works |
| `cytoscape-cise` | 2.0.1 (2025-07-08) | **Circular Spring Embedder — lays each *cluster* out as a circle.** Visually excellent for "one ring per host". | Active |
| `cytoscape-cose-bilkent` | 4.1.0 (2019-09-09) | Predecessor of fcose; the expand-collapse docs recommend it with `randomize:false` for mental-map preservation. | Superseded by fcose |
| `cytoscape-euler` | 1.2.4 (2026-05-05) | Fast force layout. | Active |
| `cytoscape-node-html-label` | 1.2.2 (2021-01-27) | HTML overlays pinned to nodes → **rich badges, UUID chips, aheadness balloons (#5)**. | Dormant; small and forkable |
| `cytoscape-popper` | 4.0.1 (2024-08-20) | Popper/Floating-UI tooltips & badge anchors on nodes/edges. | Active |
| `cytoscape-cxtmenu` | 3.5.0 (2023-02-07) | Radial context menu — natural home for "Expand remotes / Fetch / Add as remote (#6)". | Stable |
| `cytoscape-context-menus` | 4.2.1 (2024-08-28) | Classic right-click menu alternative. | Stable |
| `cytoscape-expand-collapse` | 4.1.1 (2024-08-28) | Collapse/expand compound nodes and edge bundles. **README states: "We are in the process of developing a new unified framework… this repository is no longer being maintained."** Still functional. | **Deprecated by author** |
| `cytoscape.js-complexity-management` | unreleased | Announced successor (collapse/expand nodes *and* edges, filter, hide, auto-layout to preserve mental map). MIT. **Not on npm yet; ~13★, 174 commits.** | **Not production-ready** |

**Implication:** do not architect around `expand-collapse`. Implement expand/collapse yourself over
Cytoscape's `parent` model (it is a small amount of code: hide children, add a meta-edge, re-run fcose with
everything else pinned) — or vendor the extension and accept ownership.

---

## 2. Layout engines for clustered, directed, incrementally-growing graphs

| Engine | License | Latest (date) | Nested/compound | Directed/layered | Incremental & stable | Notes for this project |
|---|---|---|---|---|---|---|
| **fCoSE** (`cytoscape-fcose`) | MIT | 2.2.0 (2023-01-17) | **Yes** | Force (undirected feel) | **Yes** — `randomize:false` + `fixedNodeConstraint` | The workhorse. Pin everything already on screen, let new nodes settle. |
| **ELK / elkjs** | **EPL-2.0 OR GPL-3.0-or-later** | elkjs 0.12.0 (2026-07-17) | **Yes** (hierarchical graphs, ports) | **Yes — `elk.layered`, Sugiyama-based** | Deterministic, not incremental; runs in a Web Worker | Best-quality directed layout. **Check the dual license against your project's license before shipping.** |
| **dagre / @dagrejs/dagre** | MIT | 0.8.5 (2019) / **3.1.1 (2026-08-08)** | Compound via `setParent` | Yes (layered) | Deterministic, not incremental | Use `@dagrejs/dagre`; the old `dagre` package is frozen at 2019. |
| **Graphviz via `@hpcc-js/wasm`** | Apache-2.0 (wrapper); Graphviz itself **EPL** | 2.35.0 (2026-07-24) | **Yes — `cluster_*` subgraphs, exactly issue #1's format** | Yes (`dot`) | No | Output formats include `json`, `dot_json`, `xdot_json` → **extract x/y and feed Cytoscape `preset`**. Engines: dot, neato, fdp, sfdp, circo, twopi, osage, patchwork. |
| **`@viz-js/viz`** | MIT | 3.29.0 (2026-08-05) | Same as Graphviz | Yes | No | The modern successor to `viz.js` (frozen at 2.1.2, 2018). Alternative WASM Graphviz. |
| **`d3-graphviz`** | BSD-3-Clause | 5.6.0 (2024-08-18) | Same as Graphviz | Yes | **Has animated transitions between two DOT renderings** | Interesting for "re-layout after expansion" animation, but the graph stays a DOT string — no per-node app state. |
| **cola.js / WebCoLa** | MIT | 3.4.0 (2019-05-10) | **Group constraints, non-overlap, hulls** | Constraint-based | **Yes — the classic "stable layout under change" engine** | Reachable from Cytoscape via `cytoscape-cola`. |
| **CiSE** (`cytoscape-cise`) | MIT | 2.0.1 (2025-07-08) | Cluster-aware | — | Partial | One circle per cluster — a genuinely nice "hosts as rings" aesthetic. |
| **d3-dag** | MIT | 1.2.2 (2026-07-05) | No | **Yes — Sugiyama for DAGs** | No | Perfect for the *commit/fork DAG* sub-view of issue #6, not for the whole map. |
| **KLay (`cytoscape-klay`, `klayjs`)** | MIT / EPL-1.0 | 3.1.4 (2020) / 0.4.1 (2016) | Yes | Yes | No | **Superseded by ELK.** Do not start here. |
| **ForceAtlas2** (`graphology-layout-forceatlas2`) | MIT | 0.10.1 (2022-10-17) | No | No | Supervisor mode = continuous | The sigma/Gephi-side default. |

### Incremental / stable-layout techniques (independent of library)
1. **Pin everything already placed.** fCoSE `fixedNodeConstraint: [{nodeId, position}]`, d3-force `fx/fy`,
   cola `fixed`. Run the layout with only the new nodes free. This is the single highest-value trick.
2. **Seed new nodes near their anchor** before running anything — `cytoscape-layout-utilities`
   `placeNewNodes()` does this with a quadrant-crowding heuristic; otherwise place them on a small circle
   around the node that was clicked.
3. **Layout a subset only.** Cytoscape can run a layout on a collection (`eles.layout({...}).run()`),
   so "layout only the newly expanded neighbourhood inside its host cluster" is one call.
4. **Animate the transition** (`animate: true, animationDuration: 400`) so the user's mental map survives.
5. **Fit-to-new** rather than fit-to-all after an expansion, so the viewport doesn't jump.
6. **Two-tier layout:** compute cluster (host) boxes once with a coarse layout, freeze them, and lay out
   only *within* a host on expansion. Prevents the whole map from breathing when one repo is expanded.

---

## 3. Click-to-expand + persistent workspace: who already does this

**This is the decisive question, so it gets the most detail.** The pattern
"start from one node → click → the graph grows → save the grown graph and come back to it" is rarer in
open source than the marketing suggests.

| Tool | License | Click-to-expand | Persist the expanded workspace? | Offline / self-host | Verdict |
|---|---|---|---|---|---|
| **AWS graph-explorer** | **Apache-2.0**, ~478★, React+TS, Docker | **Yes — core UX: select node → "expand neighbors", filter by type, custom queries** | Explored graph state lives in the browser session; **the README documents no workspace save/load or export/import** — treat cross-session persistence as **absent/[UNVERIFIED]** | Yes (container), but **requires a Gremlin / SPARQL / openCypher endpoint** | **IDEA — study the UX, don't adopt.** Requiring a graph DB is a heavy dependency for a git tool. |
| **Neo4j Bloom** | **Commercial** (Enterprise features need a licence + server plugin) | Yes | Yes — "Perspectives" store what to show and how; scenes can be saved | No (Neo4j-bound) | **REJECT (license)** — but Perspectives are the best *design* reference for saved views. |
| **Neo4j Browser** | Bundled with Neo4j; rendering now via **NVL (not OSI-licensed)** | Yes (expand relationships) | Saved Cypher queries, **not** saved layouts | Neo4j-bound | IDEA |
| **Gephi Lite** | **GPL-3.0**, TypeScript/React/sigma.js/graphology, ~343★, Docker+nginx provided | **No** — it is a whole-graph editor/explorer (filter, appearance, layout), not an incremental crawler | Yes — opens/saves graph files; **layout positions are part of the graph model** | **Yes, fully client-side, self-hostable** | **BASE / IDEA** — closest OSS app to "a saveable web worldmap". Adding expand-on-click is a real feature, not a config. |
| **Gephi (desktop)** | **Dual CDDL-1.0 + GPL-3.0** | No | Yes (`.gephi` project files, GEXF) | Yes | IDEA |
| **Retina** (OuestWare, on **GitLab** not GitHub) | Open source, gitlab.com/ouestware/retina | No (viewer: filter + search) | **State encoded in the URL; loads a GEXF from a URL; no server required** | Yes (static) | **IDEA — the "share a view as a URL" trick is directly stealable.** |
| **Graphia** | github.com/graphia-app/graphia, ~271★, C++/Qt6 desktop | Interactive 2D/3D exploration; not remote-crawl expansion | Project files; "easy export and sharing of analysis results" | Yes, desktop | IDEA — claims millions of elements. |
| **Cytoscape Desktop** | **LGPL**, Java | Via apps/plugins | Yes — `.cys` sessions (positions, styles, filters) | Yes | IDEA — `.cys` is the reference "session" concept; and it round-trips `.cyjs` with Cytoscape.js. |
| **Tulip** | **LGPL**, C++ | Partially | Yes (`.tlp`) | Yes | IDEA |
| **Kùzu Explorer** | MIT, browser UI for the Kùzu embedded graph DB | Yes | Query-driven, not workspace-driven | Yes (Docker, incl. WASM/in-memory mode) | **CAUTION** — reported archived in Oct 2025 after Apple acquired the company; community forks only. Verify before depending on it. |
| **Memgraph Lab** | **BSL-1.1 + Memgraph Enterprise License — not FOSS** | Yes | Yes | Self-host, but licence-encumbered | **REJECT (license)** |
| **Linkurious Enterprise** | **Commercial**, on-prem | Yes | Yes (saved visualizations) | On-prem | REJECT (commercial) — best-in-class reference for "investigation workspace". |
| **SemSpect** | Free tier + commercial/academic | Yes — exploration-*tree* model (aggregate-first, then drill down) | [UNVERIFIED] | Partly | **IDEA — the aggregate-then-expand model scales far better than node-by-node expansion and is a good answer to "thousands of subdatasets".** |
| **Kineviz GraphXR** (was GraphXR) | **Commercial SaaS** | Yes | Yes, "save views" | No | REJECT |
| **Kumu.io** | **Commercial SaaS** (free = public projects only) | Partial | Yes | No | REJECT |
| **Obsidian graph view** | **Proprietary** | Local-graph depth stepping | Per-vault settings, not positions | Desktop | IDEA (the "local graph, depth N" control is a nice UX for #4) |
| **Logseq graph view** | **AGPL-3.0** | Limited | No position persistence | Desktop | IDEA |
| **ontobricks** (databrickslabs) | OSS, Databricks Labs | **Yes — right-click "Expand neighbours" with an N-hop depth slider** | [UNVERIFIED] | Yes | IDEA — the depth-slider expansion control is worth copying. |
| **GUESS** | Academic, long dormant | Yes (scripted) | — | — | REJECT (abandoned) |

### The honest conclusion of this section
**No open-source tool does the whole job.** The closest are:
- **AWS graph-explorer** for the *expansion interaction* (Apache-2.0, forkable, React) — but it is welded to
  a graph-database backend and shows no evidence of a saved workspace.
- **Gephi Lite** for the *self-hosted, offline, save-and-reopen web app* (GPL-3.0) — but has no expansion.

So: **build the ~2 000-line app yourself on Cytoscape.js**, and lift the two UX patterns (graph-explorer's
expand-neighbours + Gephi Lite's filter/appearance panels + Retina's URL-encoded view) rather than forking
either codebase. Forking graph-explorer would mean inheriting a Gremlin/SPARQL data layer you don't want;
forking Gephi Lite means GPL-3.0 and still writing the expansion engine.

---

## 4. Diagram-as-data / editable-canvas tools — can a human nudge the layout and have it stick?

Requirement: a persisted layer where a human tweaks positions/labels and the tool re-syncs facts.

| Tool | License | Latest (date) | Programmatic API | Human-editable canvas | Re-syncable with regenerated data? | Verdict |
|---|---|---|---|---|---|---|
| **Excalidraw** | **MIT** | `@excalidraw/excalidraw` 0.18.1 (2026-04-20) | **Yes — `ExcalidrawElementSkeleton` + `convertToExcalidrawElements()`, plus `initialData`/`updateScene`** | Excellent, hand-drawn aesthetic | Hard: elements carry random ids/seeds; you'd need a stable `customData` id on each element to re-match | **IDEA** — great for a *frozen, prettified* export of a worldmap; poor as the live model. |
| **tldraw** | **Proprietary SDK licence** — production use needs a licence key (trial / commercial / hobby-with-watermark). npm 5.3.2 (2026-08-18) says `SEE LICENSE IN LICENSE.md` | 5.3.2 | Yes (shapes API, snapshots) | Excellent | Same id-matching problem | **REJECT (license)** for a self-hosted OSS tool. |
| **JointJS (`@joint/core`)** | **MPL-2.0** (open core; **Rappid/JointJS+ is commercial**) | 4.3.2 (2026-08-21) | Yes, strong | Yes (that's its purpose) | Yes — JSON graph is the model | **BASE** — the most credible "editable diagram *and* data model" OSS option after React Flow. Note `jointjs` (3.7.7, 2023) is the old package name; use `@joint/core`. |
| **draw.io / diagrams.net** | **Apache-2.0** (app); **mxGraph archived/unmaintained since ~2021** | — | Embed mode via iframe + `postMessage` | Excellent | Possible but painful (`.drawio` XML) | **IDEA** — good as an *export* format so users can hand-polish a snapshot. |
| **Mermaid** | **MIT** | 11.17.0 (2026-08-19) | Text in, SVG out | No | n/a (regenerate wholesale) | **REUSE as an export target** (the user already hand-writes mermaid; keep parity). Subgraph nesting readable to ~2–3 levels; no interactivity. |
| **Graphviz / DOT** | **EPL** (moved from CPL-1.0 to EPL; graphviz.org states current versions are EPL-licensed) | — | Text in, SVG/JSON out | No | n/a | **REUSE as import *and* export** — `git annex map` already speaks it; `dot_json` gives you positions. |
| **D2** | **MPL-2.0** (language + CLI). Layout engines: dagre-port and elk-port bundled free; **TALA is a paid engine** | — | Text in, SVG out | No | n/a | IDEA — nicer clusters than mermaid; still static. |
| **Structurizr** | **Apache-2.0** for DSL/CLI; prebuilt binaries/enterprise features need a licence | — | DSL | Interactive viewers | Yes (model/view separation) | **IDEA — its model-vs-view split is exactly the persistence architecture recommended below.** |
| **PlantUML** | **GPL** (an LGPL build without embedded Graphviz exists) | — | Text in | No | n/a | REJECT (GPL + static) |

**Verdict on the "hand-adjustable persisted layer":** don't outsource it. Store user-adjusted positions in
your **own** view-state file keyed by stable node ids (annex UUID / canonical URL), and let the user drag
nodes in the Cytoscape canvas. Excalidraw/draw.io/mermaid remain *export* formats for pasting into an issue.

---

## 5. View-state persistence formats and their git-diffability

**Architectural rule: split facts from view.** Two files, both committed:

```
worldmap.json        # FACTS from the walker. nodes[], edges[], badges, annex UUIDs, errors/warnings.
                     # Regenerated by the crawler. Never hand-edited.
worldmap.view.json   # VIEW. {x,y} per node id, pinned:true, expanded set, collapsed hosts,
                     # active filters, zoom/pan, per-node colour overrides. Hand-edited freely.
```

Both must be written with **sorted keys, stable ordering (sort nodes by id), 2-space indent, one field per
line, and rounded coordinates (`Math.round`)** — otherwise every re-crawl produces a meaningless 3 000-line
diff. This is the single most important engineering decision for git storage.

| Format | Structure | Positions | Diff-friendly in git? | Notes |
|---|---|---|---|---|
| **Custom split JSON (recommended)** | You control it | Separate file | **Excellent** if sorted + rounded + one-key-per-line | Merge conflicts localise to the node that moved. |
| **Cytoscape.js `cy.json()` / `.cyjs`** | Single JSON: elements + data + positions + style + zoom/pan | Yes | **Poor–medium** — one giant array, key order is the library's, floats are full precision; re-serialization churns | Fine as an *export/interchange* format (round-trips with Cytoscape Desktop), bad as the committed source of truth. |
| **GEXF** (`graphology-gexf` 0.13.2) | XML, node/edge attributes, `viz:position` | Yes | Medium — line-oriented XML diffs OK; attribute ordering can churn | The Gephi/Gephi Lite/Retina lingua franca. Best interchange format if you ever want to open the map in Gephi. |
| **GraphML** (`graphology-graphml` 0.5.2) | XML, typed keys | Via `<data>` keys | Medium | Widely supported (Graphia, yEd, Cytoscape, igraph). |
| **DOT / Graphviz** | Text | Only if you write `pos=` | **Good** — genuinely line-oriented and human-readable | Already the output of `git annex map`. Excellent as the *interchange* between walker and renderer. |
| **React Flow `toObject()`** | `{nodes, edges, viewport}` JSON | Yes | Medium (same float/order caveats; small enough to normalise) | Documented Save & Restore example; trivially normalisable. |
| **`.drawio` XML** | mxGraph XML | Yes | Medium; often base64+deflate-compressed → **opaque blob** unless you disable compression | Only if you want hand-polished snapshots. |
| **Excalidraw `.excalidraw` JSON** | Element array with `seed`, random ids, `version`/`versionNonce` counters | Yes | **Poor** — version nonces and seeds churn on every edit | Snapshot/export only. |
| **tldraw snapshot** | Store records | Yes | Poor | Plus licence problem. |
| **Cytoscape Desktop `.cys`** | ZIP archive | Yes | **Bad** (binary archive) | Desktop sessions only. |
| **Gephi `.gephi`** | Binary project | Yes | **Bad** | — |
| **URL-encoded view (Retina-style)** | Query/hash params | Filters/selection, not full positions | n/a — nothing committed | **Steal this anyway** for shareable deep links: `?focus=<annex-uuid>&depth=2`. |

**Also worth doing:** register a `.gitattributes` diff driver, and ship a `worldmap-normalize` command so a
pre-commit hook can canonicalise both files. And since this is a DataLad shop — the view file is small text,
so keep it in git, not annex.

---

## 6. Semantic zoom, badges, and the "aheadness balloons" (issue #5)

| Capability | Cytoscape.js | sigma.js v3 | React Flow | G6 v5 |
|---|---|---|---|---|
| Hide labels when zoomed out | **`min-zoomed-font-size`** (built-in) | zoom-based label rendering (built-in label grid) | CSS/manual | built-in |
| Stop scaling labels past a zoom | **`text-max-zoom`** | manual | CSS | manual |
| Zoom-reactive styling generally | `cy.on('zoom')` → toggle classes; `cy.zoom()` in style functions | render params in custom programs | React re-render on `useViewport()` | manual |
| Icon/emblem badges | Multiple stacked `background-image`s per node; pie-chart backgrounds; border colour/style/width | `@sigma/node-image`, `@sigma/node-border` (concentric discs) | Arbitrary React/HTML — the easiest of the four | **Built-in `badge` element, top-right by default** |
| Real HTML overlays on nodes | `cytoscape-node-html-label`, `cytoscape-popper` | manual DOM sync | native | manual |
| Numeric counters that grow/animate | `node.animate({style:{width,height}})` + a `data(commitsAhead)` mapper; or an HTML badge with a CSS keyframe | manual | CSS transitions, trivial | built-in animations |

**Concrete design for the balloons (#5):** map `commitsAhead` to node/badge diameter with a mapper
(`mapData(commitsAhead, 0, 100, 12, 48)`), gate visibility on `min-zoomed-font-size` so balloons only
materialise past a zoom threshold, and use `node.animate()` with a short ease for the pop. A CSS
`@keyframes` pulse on a `node-html-label` overlay is the cheapest way to get "breathing" balloons.
**LOD strategy for scale:** below zoom threshold render collapsed *host* compound nodes only, with an
aggregate badge ("14 clones, 3 ahead"); above it, expand into individual clones. This is the same
aggregate-then-drill-down idea SemSpect uses, and it is what makes low-thousands of nodes comfortable.

---

## 7. Best stack for a self-hosted, offline-capable browser app — the direct answer

> *A few thousand annotated, clustered, directed nodes; expand-on-click; savable state; no cloud.*

```
Data:      Python walker  →  worldmap.json  (+ optional DOT passthrough from `git annex map --json`)
Model:     plain JSON in the browser; optionally graphology for algorithms (paths, components, Louvain)
Render:    Cytoscape.js 3.34 (MIT), canvas renderer
Layout:    cytoscape-fcose (compound, incremental, constraint-pinned)
           + cytoscape-layout-utilities (seed new nodes)
           + cytoscape-elk (opt-in layered/DAG view for #6)
           + @hpcc-js/wasm Graphviz (opt-in: reuse `git annex map` DOT for a first-paint cluster layout)
Badges:    Cytoscape style (stacked background-images, pie backgrounds, borders)
           + cytoscape-node-html-label / cytoscape-popper for balloons & tooltips
Menus:     cytoscape-cxtmenu (radial "expand / fetch / add remote")
Shell:     Vite + Svelte (or plain TS) — small, no framework lock-in, `vite build` → static files
Persist:   worldmap.view.json written via File System Access API / download, plus localStorage autosave
Export:    SVG/PNG (Cytoscape built-in), mermaid + DOT text emitters for pasting into GitHub issues
Serving:   any static file server, or `python -m http.server`; also works from file:// with a bundled build
Backend:   optional tiny local FastAPI/Flask endpoint that runs the walker on demand for live expansion;
           without it, expansion is limited to data already present in worldmap.json
```

Everything above is MIT/Apache/BSD except ELK (EPL-2.0 OR GPL-3.0-or-later — dual-licensed, pick EPL) and
Graphviz itself (EPL, invoked as a WASM blob, not linked into your source). No licence keys, no telemetry,
no CDN required, no graph database.

**If you want the fastest possible prototype instead:** `git annex map` DOT → `@hpcc-js/wasm` → SVG, wrapped
in `svg-pan-zoom`, with clickable node ids. Zero graph library, ~200 lines, and it already reproduces the
picture in issue #1. Use it to validate the *data* model before investing in the interactive app.

**If the graph turns out to be 20k+ nodes:** switch the renderer to sigma.js v3 + graphology and represent
host grouping with convex hulls instead of compound nodes; keep the same two-file persistence model, which
is renderer-agnostic by design.

---

## 8. Rejected and why

| Candidate | Why rejected |
|---|---|
| **GoJS, yFiles, Ogma, KeyLines/ReGraph, Neo4j NVL** | Commercial or non-OSI licences. Unacceptable for an open, self-hostable community tool — regardless of technical merit (yFiles' incremental layout and Ogma's scale are genuinely best-in-class). |
| **`@cosmograph/cosmos`, `@cosmograph/react`, Cosmograph app** | **CC-BY-NC-4.0 / proprietary for commercial use.** Use `@cosmos.gl/graph` (MIT) if you want the GPU engine — but it has no edge labels and no compound nodes anyway. |
| **tldraw** | Production use requires a licence key; hobby tier forces a watermark. |
| **Memgraph Lab** | BSL-1.1 + Enterprise licence; not FOSS. |
| **Mermaid / PlantUML / D2 / Structurizr / draw.io as the *app*** | Static renderers. No node identity to click, no incremental expansion, nowhere to store nudged positions. Kept as **export targets** (mermaid especially, for parity with what the user already hand-writes). PlantUML additionally is GPL. |
| **Excalidraw as the live model** | Element ids/seeds/version-nonces churn; re-matching regenerated facts to hand-moved shapes is fragile and the JSON diffs terribly. Fine as a one-way "prettify this snapshot" export. |
| **mxGraph** | Archived/unmaintained since ~2021. (draw.io the application is still maintained and Apache-2.0.) |
| **NetV.js** | ~110★, academic, no compound nodes, no edge labels, no expansion. Its scale advantage is irrelevant at a few thousand nodes. |
| **`dagre` (0.8.5, 2019), `klayjs` (2016), `viz.js` (2018), `webcola` (2019), `cytoscape-cose-bilkent` (2019)** | Frozen. Use `@dagrejs/dagre` 3.1.1, ELK, `@viz-js/viz`/`@hpcc-js/wasm`, and `cytoscape-fcose` respectively. |
| **`cytoscape.js-expand-collapse`** | Author-declared unmaintained; successor (`cytoscape.js-complexity-management`) is unreleased with ~13★. Implement expand/collapse in-app instead. |
| **deck.gl / PixiJS bespoke renderer** | Enormous effort to reach feature parity (labels, compounds, hit-testing, badges) for a graph size that canvas handles fine. |
| **Forking AWS graph-explorer** | Apache-2.0 and the right *interaction*, but it is architected around Gremlin/SPARQL/openCypher endpoints. You would be adding a graph database to a git tool. Copy the UX, not the code. |
| **Forking Gephi Lite** | GPL-3.0 (propagates), sigma.js underneath means no compound nodes, and it has no expansion engine — you would write the hard part anyway. |
| **Kùzu Explorer** | Reportedly archived Oct 2025 after the acquisition of the company; community forks only. Do not build a dependency on it without re-verifying. |
| **Obsidian / TheBrain / Kumu / InfraNodus / GraphXR** | Proprietary and/or SaaS; no self-hosted offline story. |
| **Neo4j / Memgraph as the storage layer** | The worldmap is thousands of nodes with a hand-written crawler. SQLite or a plain JSON file is sufficient; a graph database adds an operational dependency for no gain at this scale. |

---

## 9. Open questions / things to verify before committing

- **ELK's dual licence (EPL-2.0 OR GPL-3.0-or-later)** — confirm the EPL branch is compatible with the
  licence con/ceptualization ships under before making `cytoscape-elk` a hard dependency (it is opt-in in
  the recommended stack, so this is deferrable).
- **AWS graph-explorer cross-session persistence** — I found no evidence of workspace save/load in the
  README. Worth a hands-on check (`docker run` it) before dismissing it; if it *does* persist, it becomes a
  much stronger fork candidate. `[UNVERIFIED]`
- **`cytoscape.js-complexity-management` timeline** — if it ships to npm, it replaces hand-rolled
  expand/collapse. Watch it. `[UNVERIFIED]`
- **Kùzu Explorer archive status** — reported by a third-party source; verify on the repo directly. `[UNVERIFIED]`
- **Practical ceiling of the Cytoscape canvas renderer with HTML badges** — `cytoscape-node-html-label`
  creates real DOM nodes, so budget it: gate balloons behind a zoom threshold and a max-visible-count.
  Benchmark with ~2 000 nodes early.
- **`git annex map --json`** — still an open todo upstream (linked from issue #1). Until it lands, parse the
  DOT output; `@hpcc-js/wasm` can do that parse *and* the layout in one pass.
