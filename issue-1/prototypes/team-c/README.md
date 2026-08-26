# Team C — "Scale & Filter"

A worldmap of git and git-annex clones built on **sigma.js 3 + graphology**
(WebGL), where the headline feature is not nesting but **perspectives**: named,
instantly-switchable bundles of *which node types and relations are visible and
how they are styled*, over one stable, incrementally-grown graph.

The research doc rules sigma.js out of the primary recommendation on one fact:
*"sigma.js has no compound-node model at all."* This prototype exists to test
whether that is fatal. **Short answer: it is not fatal, but it is not free —
you end up writing the compound-node layout yourself.** See
[UX-FINDINGS.md](./UX-FINDINGS.md) for the measured version of that claim and
[SELF-ASSESSMENT.md](./SELF-ASSESSMENT.md) for the short one.

---

## Run it

```bash
./run.sh          # builds web/ and serves everything on http://127.0.0.1:8853
./run.sh dev      # python API on :8853 + Vite dev server on :5173 (HMR)
```

Requirements: Python 3.9+ (stdlib only — FastAPI is not installed in this
environment, so the service is `http.server`), Node 22, `npm install` in `web/`
(done automatically by `run.sh`).

Port is `8853` (`WORLDMAP_PORT` overrides). Another team's service occupies 8848.

### Re-run the UX pass and regenerate every screenshot

```bash
cd web
PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node tools/drive.mjs
```

It drives the real app in Chromium, writes `screenshots/*.png`, and prints the
measurements quoted in `UX-FINDINGS.md`. The supporting probes:

| script | what it establishes |
|---|---|
| `tools/drive.mjs` | the full UX session + every deliverable screenshot |
| `tools/perf2.mjs` | DPR-1 vs DPR-2 frame cost, i.e. that this container is fill-rate bound on software WebGL |
| `tools/perf4.mjs` | whether collapsing groups actually helps (it depends on density) and which GPU is really in use |
| `tools/raf.mjs` | the browser's own rAF ceiling on an empty page, so the fps numbers have a reference |
| `tools/shot10k.mjs` | the 10 000-node screenshot |

---

## What's here

```
server/serve.py   stdlib HTTP service: seed / expand / synthetic / static
web/src/
  main.js         app wiring, expansion flow, semantic zoom, automation hooks
  layout.js       NESTED CONTAINMENT LAYOUT  <- the compound-node substitute
  overlay.js      hull canvas (behind sigma) + badge canvas (in front)
  render.js       sigma setup, node/edge reducers, collapse/meta-nodes, camera
  perspectives.js the five perspectives, as data
  state.js        graph + filters + derived attributes
  ui.js           panels, inspector, remote-name tables, findings
  palette.js      colour tokens for both themes
web/tools/        Playwright drivers (drive.mjs is the deliverable one)
```

### API

| endpoint | what |
|---|---|
| `GET /api/scenarios` | the three fixtures with titles and stats |
| `GET /api/seed/<id>` | **only** the `is_seed` node plus its containment ancestors, all `findings`, and a `census` so the UI can say "12 of 51 discovered" |
| `POST /api/expand` | `{scenario, node_id, relation, known[]}` → only nodes/edges the client does not already have, after an artificial **300–900 ms** probe delay |
| `GET /api/synthetic?n=2000` | procedurally enlarged worldmap, same schema, clearly flagged `"synthetic": true` |
| `GET /api/full/<id>` | whole fixture in one request — used only by the benchmark |

The bare paths from the brief (`POST /expand`, `GET /synthetic?n=2000`,
`/scenarios`, `/seed/<id>`) are accepted as aliases of the `/api/*` routes.
`/expand` works without `known[]` too — it then diffs against the seed only.

Two things the expand endpoint does that are not obvious:

* **It returns the containment ancestors of every newly discovered node.** You
  cannot draw a clone without knowing which host contains it.
* **It synthesises a `contains` relation from the `parent` field.** The fixtures
  express host→clone and RIA→repo containment *only* through `parent`, with no
  matching edge, so without this you could never walk *into* a host. `contains`
  is marked `derived: true` and is a first-class expansion target in the UI —
  that is how you reach s3's template-trap subgraph, which hangs off
  `github.com` and is otherwise unreachable from the seed.

---

## The architectural argument

### 1. A perspective is a pure reducer, never a re-layout

The whole design turns on one rule: **positions are computed by expansion, and
by nothing else.** Perspective switching, filtering, search and severity
highlighting are implemented entirely as sigma `nodeReducer` / `edgeReducer`
functions plus `refresh({skipIndexation: true})`. No node moves. No layout runs.
No sigma re-indexation happens.

That is why switching perspectives measures **2.5–15 ms on every fixture** and
still only ~30 ms at 2 000 synthetic nodes (it degrades to ~240 ms at 10 000;
numbers in UX-FINDINGS), and why context survives the switch: you are looking at
the same picture with different ink, from the same camera.

Five perspectives ship:

| id | shows | colour | size | edge labels |
|---|---|---|---|---|
| `remotes` | `remote` + the duplicate-UUID conflict | host | commits ahead | remote name |
| `storage` | containment, `part`, `remote`; everything that is not storage is dimmed | RIA / S3-exporttree / bare / annex / dead | children | none |
| `lineage` | `fork_of`, `shares_history_with`, `candidate_same_as`, `worktree_of`, `subdataset` | upstream / fork / template / inactive | commits ahead | confidence + verdict |
| `topology` | containment only, host nodes made visible | host kind | children | none |
| `health` | everything greys out except nodes named in a finding and their neighbours | severity | severity | remote name |

Keys `1`–`5` switch them.

### 2. Containment without compound nodes: four mechanisms, layered

sigma has no `parent` on nodes and no cluster layout. We replace it with four
things that together cover what a compound node does:

**(a) A nested containment layout we compute ourselves** (`layout.js`). This is
the load-bearing piece. Recursively, bottom-up: every child gets a radius (a
leaf gets its node radius, a container gets the radius it packed itself into),
children are packed into an *annulus* around the container's own node by a small
force pass that honours only the edges *internal to that container*, then hard
non-overlap separation runs to convergence, and the container reports the radius
that encloses everything. The root level is the same routine with a virtual
container. It nests arbitrarily deep, which is what s2 needs
(`host → RIA store → 40 subject repos`, and `host → superdataset → subdatasets`).

Two consequences worth stating plainly:
* This *is* re-implementing what `cytoscape-fcose` gives you for free. It is
  276 lines, and with the hull/badge canvases and the manual camera fit it comes
  to roughly 600 of the client's 1 862 lines.
* Because sizes are expressed in graph-position units
  (`itemSizesReference: "positions"`, `autoRescale: false`), a radius in the
  layout is exactly a radius on screen — hulls and nodes cannot drift apart at
  any zoom. The price is that "fit to screen" is now our job (`fitCamera`).

**(b) A hull canvas behind sigma's canvases** drawing one tinted disc per
container, dashed and more saturated as depth increases, with the container's
label and member count on a chip above it. Redrawn from sigma's own
`afterRender`, so it never lags the camera by a frame. Measured cost: **< 1 ms
per frame** — it is not what makes big graphs slow.

**(c) Collapse-to-meta-node.** Any container collapses into a single node
labelled `ria-store /data/ria (ORA)  x40`. The collapsed set is recomputed
wholesale on every change (O(V+E)): descendants get a `_collapsedInto` attribute
that the reducer hides, and every edge crossing a boundary is re-keyed to the
*visible representative* of each endpoint and aggregated into a meta-edge
carrying a count and the distinct remote names it stands for. Doing it
wholesale rather than incrementally is what makes nested collapse (a store
inside an already-collapsed host) correct. This is s2's answer to 40
near-identical children: **8.6 ms, 48 drawn nodes to 8, one added meta-edge**.
Crucially, **collapse does not re-run the layout** — positions are kept exactly,
so expanding again restores the picture you had; only the drawn hull radius
adapts to what is still visible inside it.

The honest caveat, measured: this only pays when a group is *internally dense*.
For a sparse cross-group mesh every (kind, groupA, groupB) pair becomes its own
meta-edge, so collapsing 31 synthetic hosts cut drawn nodes 468 to 32 but pushed
edges 773 to 1 205 and made the frame *slower*. A budget caps aggregated bundles
at 800 and reports how many were dropped.

**(d) Semantic zoom.** Camera ratio above a threshold auto-collapses every
top-level container; below it, they re-open. Hosts at low zoom, clones as you
zoom in — the "balloons that expand when you zoom in" idea from issue #5,
applied to hosts.

Plus a fifth, redundant channel: **colour by host**, so a clone's home is
readable even when the hull is off-screen.

### 3. Per-edge remote names, and how they degrade

s1's whole point is that the same peer is `origin` here and `rolando-exchange`
there. Three mechanisms, in increasing order of how much they survive scale:

1. **Edge labels on the canvas.** sigma renders an edge label only when *both*
   endpoints' node labels are being drawn, which makes it automatically
   LOD-gated by label density. Legible at s1's 24 nodes; gone by ~150.
2. **Selection focus.** Every edge incident on the selected node gets
   `forceLabel`, so its remote names appear regardless of density. This works at
   any graph size and is the mechanism we actually rely on.
3. **The "Called by others" table in the inspector** — the real answer. It lists
   every inbound remote and the name each peer uses for *this* repo, and when a
   repo is called more than one thing it says so explicitly:
   *"2 different names for this same repo"*. A node carrying more than one
   inbound name also gets a `2 names` badge on the canvas.

Honest verdict: **canvas edge labels do not scale, and we do not pretend
otherwise.** The alias badge plus the inspector table carry the meaning at every
size; the labels are a nicety for small maps.

### 4. Errors, aheadness, inactivity

* **Duplicate annex UUID (s1)** — the `same_annex_uuid` edge is drawn thick red
  and always kept visible, in *every* perspective, regardless of which relation
  kinds that perspective declares (`keepErrors`). Both endpoint nodes get a
  pulsing red dashed ring, are force-labelled, and the findings panel entry
  flies the camera to them.
* **Aheadness** — node radius grows with max commits ahead, and a `▲N` balloon
  is drawn on the badge canvas, capped at 70 visible balloons with an explicit
  *"+N more ahead-badges hidden (LOD cap)"* note rather than a silent lie.
* **s3's 52 inactive forks** — greyed to 55 % grey, shrunk, and their labels
  suppressed. `show inactive forks` hides them entirely.
* Findings appear in the right panel from the first frame with a
  `n/m discovered` marker, so you know an error exists *before* you have
  explored far enough to see it.

### 5. Filtering

Host/store chips, relation-kind chips, an aheadness threshold slider, a
git-annex / plain-git segmented control, and a search box that matches labels,
node ids, annex UUIDs, dataset ids **and remote names in both directions** —
typing `rolando-exchange` finds every clone that calls something by that name.
All of it runs through the same reducer path, so it is as fast as a perspective
switch.

---

## What I would do differently

1. **I would not choose sigma for this graph size.** Every fixture here is
   24–68 nodes and the synthetic tests show the fixtures are three orders of
   magnitude below where WebGL starts to matter. The nested layout, the hull
   canvas, the badge canvas, the meta-node machinery and the manual camera fit
   are all code that Cytoscape.js + fcose would have supplied. That is roughly
   600 lines written to replace a library feature.
2. **I would choose it if the map were the *fleet*, not one dataset** — every
   clone of every dataset across an institution. There the perspective model and
   the filtering are the product, and compound nodes are the wrong abstraction
   anyway because at that size you never render an individual clone until you
   have filtered down to it.
3. **The nested layout should be a worker.** At 10 000 nodes it blocks the main
   thread for over a second. Everything it needs is plain numbers; it should
   post positions back.
4. **Expansion should be optimistic.** The 300–900 ms probe delay is dead time
   in which the UI does nothing but spin. A ghost node placed immediately and
   confirmed on arrival would make the map feel twice as responsive.
5. **Persistence is missing.** The split `worldmap.json` / `worldmap.view.json`
   model from the research doc is right and I did not build it. Positions,
   collapse set, active perspective and filters all live in memory and die on
   reload. Perspectives in particular *want* to be saved and shared — that is
   what makes them worth having.
6. **Edge label placement needs real work** — sigma draws them at the edge
   midpoint with no collision avoidance, which is why s1's centre is a thicket.
   A greedy label-placement pass on the badge canvas would fix it, and I would
   spend that time before adding any more perspectives.

## Screenshots worth looking at first

| file | why |
|---|---|
| `s1-04-duplicate-uuid-error.png` | the duplicate annex UUID, loud, with the full UUID in the inspector |
| `s1-05-remote-name-disagreement.png` | "2 different names for this same repo" and the inbound-remote table |
| `s1-08-search-remote-name.png` | searching a *remote name* and having the graph answer |
| `s2-03-ria-40-children-expanded.png` | three levels of containment, no compound nodes |
| `s2-04-ria-collapsed-meta-node.png` | the same store as one `x40` node and one `origin x40` meta-edge |
| `s3-03-inactive-forks-greyed.png` | 52 of 60 forks greyed, 8 that matter readable |
| `s3-05-lineage-template-trap.png` | `containment 0.19` and a *drawn, rejected* candidate same-as |
| `synthetic-10000.png` | where this falls apart, and why it is edges rather than nesting |
| `s1-07-light-theme.png`, `s2-05-light-theme.png`, `s3-07-light-theme.png` | both themes |

## Licences

sigma.js MIT · graphology MIT · graphology-layout-forceatlas2 MIT ·
`@sigma/edge-curve` MIT · Vite MIT. No GPL, no CC-BY-NC, no Cosmograph.
`@sigma/edge-curve` was added beyond the pre-verified list; it is from the sigma
monorepo and carries the same MIT licence.
