# UX findings — team B (graphviz-first)

Written after driving the built app in Chromium via Playwright (`tools/drive.mjs`,
`tools/measure.mjs`, `tools/export-check.mjs`) against all three fixtures. Every number below
was measured on this machine, in this build, in the browser; nothing here is estimated. Where I
did not measure something I say so.

---

## 1. Numbers first

### Cold start and first meaningful render

| | measured |
| --- | --- |
| cold page load → seed node painted (`networkidle` → first paint of the graph) | **985 ms wall** |
| of which: Graphviz WASM instantiation (`Graphviz.load()`, first call only) | **58–94 ms** (n = 6 runs; 66 ms in the run above) |
| of which: app's own "first render" timer (fetch seed → DOT → layout → painted) | **183 ms** |
| the same on a scenario switch, WASM already warm | **51–70 ms** |
| main app bundle (cytoscape + elkjs + Graphviz WASM, one chunk) | **2.72 MB** (1.23 MB gzip) |

The 2.72 MB bundle is the honest price of "Graphviz in the browser". 821 kB of it is
`@hpcc-js/wasm/graphviz` alone (the WASM is base91-embedded in the JS, so there is no second
network request — good for offline, bad for the byte count). Over localhost it is invisible;
over a slow link it is not, and I did not measure that.

### Graphviz layout cost per scenario (browser, warm)

| scenario | nodes/edges at full expansion | DOT emitted | `graphviz.layout(dot,'json','dot')` | full re-render (rebuild elements + layout + restyle), median of 10 | Graphviz bb |
| --- | --- | --- | --- | --- | --- |
| s1-spacetop | 24 / 25 | 4.6 kB | **7 ms** | **54 ms** (13–57) | 1547 × 1052 |
| s2-babs-ria | 51 / 87 | 9.7 kB | **13 ms** | **55 ms** (47–55) | 1336 × 1461 |
| s3-forks | 68 / 66 | 12.5 kB | **17–24 ms** | **65 ms** (39–86) | 2066 × 2206 |

**Graphviz is not the problem.** At worst it is 24 ms — about 6 % of one expansion's wall time.
The claim in the brief that computing real Graphviz positions in the browser is cheap is
confirmed at this scale. I did not test it above ~70 nodes, and `dot` is superlinear, so this
says nothing about 2 000 subdatasets.

### Where an expansion's time actually goes

Median over 14 measured expansions across the three scenarios:

| stage | ms |
| --- | --- |
| artificial probe (`POST /api/expand`, 300–900 ms by design) | **500–890** |
| `GET /api/dot/…` round trip (server generates DOT) | **44–76** (one outlier at 302 ms) |
| Graphviz WASM layout | **1–24** |
| everything else (element rebuild, styling, animation start) | ~20–40 |
| **total wall per expansion** | **569–1088 ms** |

So the second-largest cost after the (deliberately fake) probe is **fetching the DOT over HTTP**
— a hop that exists only because I put the DOT generator on the server to make the round trip
demonstrable. In a real tool that generator belongs in the browser.

### Save / reload round-trip fidelity

Measured by saving a view, expanding further, then loading the saved view back and comparing
every node's live position against the file:

```
{ nodes: 14, missing: 0, maxDeltaPx: 0 }
```

**Zero drift, nothing lost.** This is the one place the "layout as data" thesis pays off exactly
as advertised: reload runs no layout at all, and the picture is byte-identical to the one you
saved. View files: 2.7 kB (s1, 22 nodes) to 11 kB (s3, 67 nodes).

### Export

| file | size | contents |
| --- | --- | --- |
| `exports/worldmap-s1-spacetop.html` | **460 kB** | 24 nodes, 25 edges |
| `exports/worldmap-s2-babs-ria.html` | **488 kB** | 48 nodes, 45 edges |
| `exports/worldmap-s3-forks.html` | **491 kB** | 67 nodes, 62 edges |

Verified by loading each over `file://` in Chromium **with every non-`file://` request aborted at
the route level**. All three rendered, all three responded to a node tap with the inspector, all
three theme-toggled, zero console errors. Roughly 450 kB of each file is the cytoscape IIFE
bundle; the data and coordinates are 10–40 kB. Because the export ships coordinates rather than
a layout engine, it contains no Graphviz and no ELK — which is why it is 460 kB and not 3 MB.

---

## 2. The bad news, which is about my own approach

### 2.1 Re-running `dot` on every expansion destroys the mental map. Measured.

`layoutChurn()` records, on every relayout, how far each already-placed node moved. Worst cases
observed:

| scenario | expansion | already-placed nodes | median move | max move |
| --- | --- | --- | --- | --- |
| s3-forks | `d:proj-a` / `shares_history_with` (**adds 1 node**) | 62 | **1588 px** | 1606 px |
| s3-forks | `d:upstream` / `fork_of` | 2 | 1600 px | 1600 px |
| s1-spacetop | `d:discovery` / `same_annex_uuid` (**adds 1 node**) | 14 | 201 px | 968 px |
| s1-spacetop | `d:rolando-x` / `remote` | 13 | 233 px | 470 px |
| s2-babs-ria | `d:super` / `remote` | 3 | 261 px | 261 px |

Read the first row again: **discovering one edge to a repo you already had moved every other node
on the screen by about 1 600 px.** Graphviz has no notion of "keep what you had"; a new node can
change a rank assignment and the whole drawing re-flows. I animate the transition (420 ms,
ease-out) and I translate the result so the node you clicked stays put, which makes it *survivable*
rather than *good* — you still watch the entire map slide.

Roughly half of the expansions I measured had median churn of **0 px** (Graphviz was stable), and
half were catastrophic. That unpredictability is worse than a consistently mediocre force layout,
because you cannot learn when to brace.

The `keep placed nodes` toggle pins existing nodes and gives only new nodes Graphviz's
coordinates. It works, and after ~3 expansions new nodes start landing on top of old ones,
because Graphviz was never told the pins exist. It is a workaround, not a fix. The fix is
`neato -n` with `pos=…!` fed back in, or per-cluster layout with frozen cluster boxes — see
README §"what I would do differently".

### 2.2 A diff-friendly file format does not give you a diff-friendly file

The view file is exactly as clean as promised — sorted keys, integers, one field per line. And
the diff between two saves one expansion apart is **90 changed lines in a 155-line file**. The
formatting work was necessary but not sufficient; the generator has to be stable too. I built the
nice format and then undermined it with the layout policy. That is the most useful thing I
learned from this prototype.

### 2.3 `dot` is bad at fans, and I had to fight it in two different places

* A RIA store with 40 children lays out as a **1066 × 3504 pt** column. I chunk children into
  `rank=same` groups joined by invisible edges to get **1296 × 1361**.
* Even then, Graphviz honours the *columns* and staggers the *rows* to route splines: the 60
  s3 forks came back with **8 distinct x values and 50 distinct y values**. I had to tag nodes
  with `gridpos="col,row"` server-side and snap them back to a grid client-side.
* ELK is no better in the lineage view: `elk.layered` puts all 60 forks in one **4551 px-tall**
  layer and strands the rest of the graph at the far end of it. `elk.layered.wrapping.strategy`
  (`SINGLE_EDGE`, `MULTI_EDGE`) with `aspectRatio: 1.6` changed nothing measurable — same
  3311 × 4551 box. I ended up detecting fans myself, laying out only the skeleton with ELK
  (83–140 ms), and gridding the fan beside its hub.

Three special cases to make two off-the-shelf layout engines produce a usable picture of a fork
network is not a ringing endorsement of "just use the real layout engine". The layout engine is
excellent at the part of the problem that is a DAG of clusters and poor at the part that is
"one node with sixty identical neighbours", which is the part this data is made of.

### 2.4 Graphviz's spline routing only survives partially

Replaying Graphviz's `edges[].pos` waypoints as cytoscape `segments` genuinely works and looks
right in s1 — edges keep dot's channels instead of cutting through clusters. But it must be
switched off for:

* edges touching a compound node (cytoscape derives the compound's centre from its children, not
  from Graphviz's anchor point, so the waypoints refer to a different line);
* edges touching a grid-snapped node (the node is no longer where Graphviz put it).

Net result: **s1 saves 23 routed edges, s2 and s3 save 0.** The feature works exactly where the
graph is small enough not to need it. I did not find this until I looked at an export and saw the
duplicate-UUID edge take a 900 px detour — a bug caused by computing routes against animation
start positions rather than final positions, now fixed, but the class of bug is inherent to
replaying one engine's geometry inside another's model.

### 2.5 Expansion-only exploration cannot see a disconnected graph, and s3 proves it

I did not design for this and the fixture caught me. `s3-forks` has **two** connected components:
the fork network around `con/duct`, and the four-node template trap
(`con/project-alpha`, `con/project-beta`, `con/python-template`, `~/proj/project-alpha`). They
share no edge. So the `identity-ambiguous` finding — the one that carries the whole
"identity is confidence, not a merge" argument, with its measured containment of 0.19 — **can
never fire in a pure click-to-expand UI**, because you can never click your way to the second
component from `~/proj/duct`.

My first driver run silently reported 67 of 68 nodes and the finding never appeared. The fix is a
`/api/roots` endpoint that computes components not containing a seed and a sidebar panel that
offers their entry points explicitly. It works, and it is honest, but it means the headline
interaction ("the map grows as you navigate") is *structurally incomplete*: a worldmap crawler
will always also need a set of roots, not one seed. Any prototype that only demonstrates
expansion from a single seed has not met this scenario.

### 2.6 Smaller things that annoyed me while clicking

* **The seed is one box, and `cy.fit()` on one box zooms to 300 %.** I had to cap fit zoom at
  1.0. Every expand-from-seed tool will hit this.
* **Labels do not wrap on `/`.** cytoscape's `text-wrap: wrap` breaks on whitespace, and repo
  paths have none, so `~/datasets/1076_spacetop` broke as `…1076_spaceto` / `p`. I wrap on path
  separators in JS before handing the label over. A first-cut prototype would have shipped that.
* **Findings gated on discovery is the right call and I nearly got it wrong.** The first version
  showed all three s1 findings at the seed state, which spoils the entire point of an explorer.
  Gating each finding on "all its nodes are visible" turns the duplicate annex UUID into an
  actual discovery — you expand `d:discovery`'s `same_annex_uuid` relation and the panel lights
  up red. That is the best interaction in the prototype.
* **`expand wave` (expand everything one hop) is unusable at 300–900 ms per probe**: s3 takes
  ~40 s. Real crawls need batching and a progress model, not a button.
* **The 300–900 ms probe delay is the dominant cost and it is realistic**, which means any design
  that needs several expansions to show something useful is already too slow. s3 needs exactly
  two clicks from seed to "here are the 8 forks that matter", and that felt right; s2 needs four.

---

## 3. What each scenario exposed

**s1-spacetop** — the best fit for this approach. 24 nodes, 9 host clusters, and Graphviz's
cluster layout produces almost exactly the hand-drawn picture from issue #1 on the first paint.
Per-edge remote names land the point immediately: `d:rolando` is `origin` to four different
clones and `rolando-exchange`/`spacetop-rolando-exchange` on two more edges, all visible at once,
which no node-centric UI can show. The duplicate-UUID pair renders unambiguously (double red
border on both, thick red bidirectional edge labelled `same annex UUID`). This scenario also
produced the only non-empty edge-route set.

**s2-babs-ria** — exposed nesting and scale-inside-a-cluster. Three levels
(`h:ria` → `d:ria` → 40 repos, `h:discovery` → `d:super` → 2 subdatasets) render correctly as
nested compounds, and the 12 unmerged result branches are visible as amber borders without
reading a single label. It also exposed that 40 near-identical children **need** the grid hack,
and that 40 parallel `origin` edges into one target must be label-suppressed or the picture is
mud (I bundle them: ≥10 identically-named edges into one target lose their labels and drop to
40 % opacity).

**s3-forks** — the scenario that broke the approach, twice: once on layout and once on the
navigation model (see §2.5 — it is two disconnected components). 60 forks of one upstream is precisely the
shape `dot` handles worst, it produced the 1 588 px churn measurement, and it needed both the DOT
gridding *and* the client-side grid snapping *and* a bespoke ELK fan pre-pass. On the other hand
the lineage view of s3 is the single most useful screen in the prototype: 8 active forks in a
column next to `con/duct` sorted by commits ahead, 52 dead ones greyed in a block, and the
`candidate_same_as` verdict edge between `project-alpha` and `project-beta` drawn with a tee
arrowhead and `conf 0.19`. That took a fan-detection heuristic that has nothing to do with
Graphviz.

---

## 4. Verdict

Graphviz-first is right about **first paint** and right about **persistence**, and wrong about
**incremental exploration**, which is the actual product.

* first paint of a clustered map: **better than anything a force layout will give you**, at 7–27 ms;
* saved views: **0 px drift on reload**, human-readable, and a 460 kB self-contained export that
  really does open from a file with no server — this is the part I would keep verbatim;
* growing the map: **the wrong engine**, because `dot` is a batch layout with no memory, and the
  mitigations (anchor translation, pinning, gridding, snapping) are all fighting it.

If I were shipping this, I would keep the DOT round trip for the *initial* layout and for export,
and put an incremental constraint layout (fCoSE with `fixedNodeConstraint`, or cola) behind the
expand button, re-deriving a full Graphviz layout only when the user asks for one.
