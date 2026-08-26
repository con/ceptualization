# Self-assessment — team B, graphviz-first

1. **Win:** first paint is genuinely Graphviz-quality — 7 ms (s1) to 27 ms (s3) for a real `dot`
   run in the browser, offline, with clusters, and s1 comes out looking like the hand-drawn map in
   issue #1 with no tuning.
2. **Win:** layout-as-data works end to end — save, expand further, reload, and the picture comes
   back with **0 px drift across 14 nodes** and no layout run at all.
3. **Win:** the self-contained export (460–491 kB) opens over `file://` with every network request
   blocked, and is still pannable, clickable and theme-switchable, because it ships coordinates
   instead of an engine.
4. **Win:** per-edge remote names and the duplicate-annex-UUID error read at a glance; gating
   findings on "all its nodes are on screen" makes s1's error a discovery rather than a banner.
5. **Loss:** re-running `dot` per expansion moved **62 of 62** placed nodes by a **median 1588 px**
   in s3 for a single new edge. This is the central flaw and it is my own design choice.
6. **Loss:** the diff-friendly view file still diffs badly — **90 changed lines of 155** for one
   expansion. Good formatting cannot rescue an unstable generator.
7. **Loss:** Graphviz spline routing replayed as cytoscape segments only survives for small
   graphs — 23 routed edges in s1, **0 in s2 and s3**, because compound and grid-snapped nodes
   invalidate the waypoints.
8. **s1 exposed the wins:** clustering, per-edge remote names, the loud error — all essentially free.
9. **s2 exposed the nesting limit:** 40 children need `rank=same` gridding or `dot` emits a
   3504 pt column; 40 parallel `origin` edges need bundling or the picture is unreadable.
10. **s3 broke it twice:** a 60-way fan is the worst case for both `dot` *and* `elk.layered`
    (4551 px single layer) and needed three bespoke heuristics; and s3 is **two disconnected
    components**, so its identity-ambiguous finding is unreachable by expansion from the seed at
    all — I had to add an explicit "roots" endpoint. Right engine for a DAG of clusters, wrong
    engine for a hub with sixty spokes, and a seed is not a substitute for a root set.
