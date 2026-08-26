# Team D vs Teams A, B and C, on the same metrics

Every team-D number below comes from `tools/last-metrics.json`, written by
`node tools/measure.mjs` driving the running app with Playwright. Teams A, B
and C numbers are quoted from `../BAKE-OFF-RESULTS.md` and, where the raw file
exists, from `../team-a/scripts/last-metrics.json`. Where a comparison is not
apples-to-apples I say so rather than quietly picking the flattering framing.

Environment for all team-D numbers: Chromium (Playwright 1.62.1), software
WebGL (SwiftShader), viewport 1600×1000, DPR stated per row. Cytoscape renders
on 2-D canvas, not WebGL, so DPR affects us less than it affected team C.

---

## 1. Layout stability — the headline

The mandate: beat team A's **980 px** compound jump and team B's **1588 px**
median whole-graph churn, measuring containers and leaves separately.

| | Team A (fCoSE, pinned) | Team B (Graphviz, whole graph) | Team C (sigma) | **Team D (two-tier, sticky)** |
| --- | --- | --- | --- | --- |
| Container displacement, worst | **980.45 px** (`d:ria` gaining 40 children) | n/a — no containers | no compounds at all | **843.77 px** centre, but see below |
| Container displacement excluding the container that grew | not reported separately | 1588 px median, 62/62 nodes | — | **0.00 px on 16 of 17 expansions; 97.0 px on the 17th** |
| Container displacement measured at the box's **least-moved corner** | — | — | — | **0.00 px on 16 of 17; 97.0 px on the 17th** |
| Leaf displacement, worst | **0.00 px** on all 19 pinned probes (2 exceptions: 56.95 px and 299.21 px from their container-separation pass) | 1588 px median | — | **0.00 px on 16 of 17 expansions; 97.0 px on the 17th** |
| Leaves *inside* the container being expanded | — | — | — | **0.00 px on 17 of 17** |
| Collapse → expand round trip, worst node | not measured | n/a | n/a | **0.000 px** over 50 (s2) and 68 (s3) nodes |
| Node/node overlaps after the full sequence | 0 (after a separation pass that slid a host 299 px) | 0 (rigid grid) | coordinate-space bug found | **0** (s1 24 nodes, s2 50, s3 68) |
| Containment violations (a child drawn outside its box) | n/a (cytoscape compounds enforce it) | n/a | hand-rolled | **0** |

**How to read the 843.77 px.** In team D a container is an ordinary node with
an explicit box, and the box *grows* when you expand into it. `h:github` going
from 2 children to 64 needs roughly 1400 × 800 px it did not have. We anchor
that growth at the box's top-left corner and extend right and down, and tier-2
coordinates are offsets from that same corner — so the box's **outline** grows,
its **centre** moves by half the growth (843.77 px), and **nothing drawn inside
or outside it moves at all**. The comparable team A event moved the compound
*and everything the user was looking at*.

The one non-zero case is honest and worth naming: in s1, expanding
`d:smaug|remote:out` grew `h:smaug` downward into `h:discovery` and
`h:hjlaptop`, which were translated **97 px** to make room. That is 1 expansion
in 17, and the translation is rigid — the two hosts keep their internal layout.

**The control.** Running the same sequences with `layoutMode: 'full'` (Graphviz
re-lays the container tier on every expansion, team B's strategy applied to the
container tier only) gives, on the same 17 expansions: container-other max
**607.01 px**, leaf max **607.01 px**, non-zero on 7 of 17. So the sticky rule
is worth roughly a 6× reduction in worst-case churn *within our own design*,
and the two-tier split is worth the rest.

---

## 2. Persistence and the view-diff churn

The direct test of whether item 1 worked.

| | Team B | **Team D** |
| --- | --- | --- |
| `diff -u` of two saves of the **same** state | not reported | **0 changed lines** |
| `diff -u` after **one** expansion | **88 changed lines of 155** | **14–16 changed lines of 190** across repeat runs (2 of them the `saved_at` timestamp) |
| Position drift on save → reload | **0 px** | 0.462 px max, 0.006 px median |
| Self-contained export | 3 files, 464–496 kB, 0 external refs | 3 files, **469.3 / 501.4 / 511.0 kB, 0 external refs** |
| Export verified over `file://` with all network blocked | yes | yes — 24 / 50 / 68 nodes, 0 blocked requests attempted, 0 console errors, inspector responds to a click |

The 14–16 line diff is not just smaller, it is *legible*: it contains the
container that grew (`h:discovery` `h` 154→256, `y` 568→619), the new
expansion, the new node's offset, and the new id in `visible`. Nothing else
moves, because leaf coordinates are stored as offsets inside their container
rather than as world coordinates.

**Where team B beats us:** reload drift. They measured 0 px; we measure
**0.462 px max**. The cause is ours: the canonical view file rounds every
coordinate to an integer, and a container's centre is reconstructed from a
rounded box, so a leaf can land half a pixel off. It is invisible and it is
still a loss.

---

## 3. Collapse as edge aggregation

Team C's finding: collapsing 31 hosts cut drawn nodes 468 → 32 but pushed drawn
edges 773 → **1205**, and made frames slower.

| Scenario / action | drawn nodes | drawn edges |
| --- | --- | --- |
| s2, nothing collapsed | 50 | 86 |
| s2, collapse `d:ria` (the 40-repo RIA store) | 50 → **10** | 86 → **7** (40 edges folded inside the box) |
| s2, collapse every container | 50 → **3** | 86 → **3** |
| s3, nothing collapsed | 68 | 66 |
| s3, collapse `h:github` | 68 → **4** | 66 → **3** (63 folded) |
| s3, collapse every container | 68 → **2** | 66 → **2** |
| s1, collapse every container | 24 → **9** | 25 → **13** |

**Edges fall in every case**, which is the claim team C's result put in doubt.
The difference is mechanical: when both ends of an edge map to the same
collapsed box the edge is folded away entirely (counted, not drawn), and when
they map to different boxes all edges sharing a
`(source-box, target-box, relation)` key become **one** edge carrying a count.
`collapse.js:verify()` asserts both counts fall and the assertion is checked in
`measure.mjs` for every container in every scenario.

Caveat, stated plainly: our fixtures top out at 68 nodes and 87 edges. Team C's
counter-example was 468 nodes and 773 edges of *synthetic* data. Aggregation
must win asymptotically — the aggregated edge count is bounded by
(boxes)² × (relations) rather than by pairs — but we have not measured it at
their scale.

---

## 4. Layout off the main thread

| | Team A | Team B | Team C | **Team D** |
| --- | --- | --- | --- | --- |
| Where layout runs | main thread | main thread | main thread | **Web Worker** |
| Longest blocked frame revealing all 68 s3 nodes at once, DPR 1 | **416.6 ms** (6.2 fps) | — | — | **100.0–116.6 ms** over repeat runs (49.7 fps over the sample) |
| Same, DPR 2 | not reported | — | 107.9 ms for a 51-node scene | **133.3–333.2 ms** over repeat runs (43.8 fps) |
| s2, 51 nodes, DPR 1 / DPR 2 | 216.6 ms / — | — | — | **116.6–133.4 ms / 149.9–200.0 ms** |
| Median frame during the reveal | — | — | — | **16.7 ms** at both DPRs, all scenarios |

Both layout tiers run in the worker: `@hpcc-js/wasm` Graphviz (tier 1) and
cytoscape 3.34 headless + fcose 2.2.0 (tier 2). **Neither library needed any
adaptation** — cytoscape runs `headless: true, styleEnabled: true` in a worker
without touching the DOM, and the Graphviz wasm is inlined as base64 in
`@hpcc-js/wasm`'s bundle so it needs no fetch. That is a useful correction to
the assumption that "a library will not run in a worker".

Run-to-run spread on these is wide — team C measured ±40 % on the same
hardware and I see the same. Treat them as ordering, not magnitude.

What is still on the main thread, and is now the wall: **cytoscape's own
`add()` + first paint of 68 nodes**. The 100–117 ms longest frame is that, not
layout — the worker reports its tier-1 Graphviz call at 1.4–5.4 ms and the
whole two-tier pass at 0.4–260 ms, off-thread.

---

## 5. A root set, not a seed

| | Team A | Team B | Team C | **Team D** |
| --- | --- | --- | --- | --- |
| s3 nodes reachable from the seed by relations | needed a synthetic `host_scan` relation | first run silently reported **67/68**, finding never fired | synthesised `contains` client-side | **62 / 68 measured and displayed** |
| `contains` a walkable relation | no (rendering hint) | no | synthesised in the client | **yes, server-side, in `rel_counts`, expandable** |
| `GET /api/roots` | no | added after the failure | no | **yes, every component root, seeded or not** |
| "N nodes not reachable from here" always on screen | no | a panel | no | **yes, the largest number in the sidebar, from the first frame** |
| Components in s3 over relations only / with `contains` | — | 2 (found late) | — | **2 / 1** |

s1: 15 of 24 reachable by relations, 9 only via `contains` (every host).
s2: 48 of 51 by relations, 3 only via `contains`.
s3: 62 of 68 by relations, 6 only via `contains`, in 2 components.

The number the UI shows is computed from the *current* visible set, so it
counts down as you explore and never goes stale — see
`screenshots/s3-04-unreachable-affordance.png`, where it reads **4** with a
`reveal` button next to `d:proj-a`, the root of the component the seed cannot
reach.

---

## 6. Label-on-demand: rendered px at fit zoom

The metric team A defined: rendered CSS px of an edge label at the app's own
fit-to-everything zoom.

| | Team A | Team C | **Team D** |
| --- | --- | --- | --- |
| Fit zoom chosen by the app | 0.570 (s1), 0.475 (s3) | — | **0.577 (s1), 0.451 (s2), 0.558 (s3)** |
| Edge label size at that zoom | **5.1 px (s1), 4.3 px (s3)** | collided at 51 nodes | **13.0 px, every labelled edge, every scenario** |
| Edge labels drawn at that zoom | all | all (colliding) | **3 of 25 (s1), 0 of 86 (s2), 2 of 66 (s3)** |
| With a node selected | — | — | **8 of 25 labelled, all at 13.0 px** |
| With `labels: all` forced | — | — | 25 / 86 / 66 labelled, still 13.0 px each |
| Remote-name disagreement visible without an inspector | no — inspector only | a dedicated perspective | **yes, in the default view** |

Two mechanisms, both in `labels.js`:

1. **Almost nothing is labelled.** An edge draws its label only when it is
   incident to the selection, when its relation *is* the finding
   (`same_annex_uuid`, `candidate_same_as`), or when it is one of the
   representative edges of a name disagreement.
2. **What is labelled is drawn at a constant screen size.** `font-size` is set
   to `13 / zoom` on every zoom change, so the label is 13 CSS px whether the
   map is fitted to 68 nodes or zoomed into one. Because rule 1 keeps the set
   to a handful of edges, restyling them on zoom is cheap.

`screenshots/s1-05-name-disagreement-fitzoom.png` is the evidence: at zoom
0.577, with no inspector open and nothing selected, the map reads
`rolando-exchange ▼12` and `spacetop-rolando-exchange ▲12` on two different
edges pointing at the same node, both at 13 px. That is issue #1's sentence,
drawn.

**Where this loses.** Plain node text is *not* zoom-compensated (compensating
it overflowed the box and collided with neighbours — an earlier build did this
visibly). At fit zoom a node label renders at **6.8–6.9 px**, worse than team
A's edge labels. Node text is legible only at the "reading zoom" button (0.8,
≈10 px) or closer. The design decision is that a *remote name is a property of
an edge*, so the edge is where it is made legible; the node keeps a coloured
border and a `⇄ 2 names` badge as a locator.

---

## 7. First paint

| | Team A | Team B | Team C | **Team D** |
| --- | --- | --- | --- | --- |
| Cold navigate → painted seed | **311 ms** | 985 ms | 526 ms | **324–354 ms** (median of 5 fresh contexts, two separate runs; samples 306–373 ms) |
| Scenario switch (warm) | — | — | — | 270–349 ms including the simulated probe |
| In-page seed render | 10 ms | — | — | 10.8–57 ms |
| Client JS | ~2500 LOC | ~2700 LOC | 1862 LOC | **2212 LOC** (473 kB app bundle + 1.38 MB worker bundle) |

**We do not clearly beat team A here.** 324–354 ms vs 311 ms. The extra buys the
worker bundle, and the Graphviz wasm inside it loads in 13.3–32.4 ms once, off
the main thread, so it does not block the seed.

---

## Summary scoreboard

| Metric | Best of A/B/C | Team D | Verdict |
| --- | --- | --- | --- |
| Container displacement (others) | 980 px (A, the container itself) | **0.00 px on 16/17** | **won** |
| Leaf displacement | 0.00 px (A, pinned leaves) | **0.00 px on 16/17, 97 px once** | tied — A's pinning is as good, on leaves |
| Leaves inside the expanded container | 0.00 px (A) | **0.00 px on 17/17** | tied |
| View diff, one expansion | 88 / 155 lines (B) | **14–16 / 190 lines** | **won** |
| View diff, identical state | unstable (B) | **0 lines** | **won** |
| Reload drift | **0 px (B)** | 0.462 px | **lost** |
| Self-contained export | 464–496 kB, 0 refs (B) | 469–511 kB, 0 refs | tied |
| Edges after collapse | 773 → 1205, i.e. worse (C) | **86 → 7, 66 → 3** | **won** |
| Longest frame, 68 nodes | 416.6 ms (A) | **100–117 ms** DPR 1 | **won** |
| Edge-label px at fit zoom | 4.3–5.1 px (A) | **13.0 px** | **won** |
| Node-label px at fit zoom | not reported | 6.8 px | not compared; weak |
| Nodes reachable from seed, s3 | 67/68 claimed, 62 real (B) | **62/68, displayed** | **won** (honesty, not capability) |
| First paint | **311 ms (A)** | 324–354 ms | **lost** (narrowly) |
| Client LOC | 1862 (C) | 2212 client JS + 650 server Python | tied |
