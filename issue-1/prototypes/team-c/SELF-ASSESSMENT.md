# Team C self-assessment

1. **Win** — perspectives are the right idea and they are genuinely free: switching stays at 3–5 ms on the fixtures and never moves a node, because it is a pure sigma reducer pass with `skipIndexation`.
2. **Win** — containment survived without compound nodes. A hand-written nested annulus-packing layout plus a hull canvas nests three levels deep (`host → RIA store → 40 subject repos`) and reads correctly in both themes.
3. **Win** — collapse-to-meta-node is the right answer to s2: 51 nodes / 135 edges become 8 drawn nodes and one `origin x40` meta-edge in 7 ms, with no re-layout, so the map does not jump.
4. **Win** — the expansion story is honest: the seed really is one node, `/api/expand` really sleeps 300–900 ms, and the derived `contains` relation is what makes s3's template-trap subgraph reachable at all.
5. **Loss** — I re-implemented `cytoscape-fcose`. Roughly 600 lines of layout, hull, meta-node and camera-fit code exist only because sigma has no `parent`. At these graph sizes that is a bad trade and I would not repeat it.
6. **Loss** — canvas edge labels do not scale. s1's 24-node map already has an unreadable knot of `origin` labels in the middle; the inspector's "Called by others" table is what actually carries the point, not the canvas.
7. **Loss** — collapsing many *sparse* groups makes things worse, not better: at synthetic-500 it cut 468 drawn nodes to 32 but pushed edges from 773 to 1205 and frame time up 50 %, because every cross-group pair becomes its own meta-edge.
8. **Loss** — no persistence. Positions, collapse set, active perspective and filters die on reload, which is exactly the thing the research doc says matters most.
9. **s2 exposed the layout**: 40 near-identical children is where nesting either works or does not, and it is the only scenario that justified the collapse machinery.
10. **s3 exposed the perspectives**: 52 greyed forks plus a rejected `candidate_same_as` is unreadable in one view and obvious once `lineage` and `health` are separate — that scenario alone sells the approach.
