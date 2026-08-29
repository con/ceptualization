# Team A — self-assessment

1. **Wins at containment.** `parent` is native, nests arbitrarily deep, and every layout/hit-test/bbox call
   respects it. s2's host → RIA store → 40 repos renders correctly with almost no code of ours.
2. **Wins at layout stability.** fCoSE `randomize:false` + `fixedNodeConstraint` over every placed leaf gives
   a *measured* 0.00 px mean displacement on the pinned set for every expansion in all three scenarios.
3. **Wins at edge semantics.** Multi-edges, per-edge remote names, source-end ▲/▼ chips, self-edges and a
   loud red `SAME ANNEX UUID` edge are all plain stylesheet, no custom rendering.
4. **Loses at compounds under pinning.** `fixedNodeConstraint` cannot pin a compound, so a node that becomes a
   container jumps (up to 1029 px measured in s2) and grown host boxes overlap. I had to write a rigid-body
   container separator to get overlap back to zero — that is a hole in the library, not a config mistake.
5. **Loses at throughput.** The 60-fork step in s3 blocks the main thread for ~300–420 ms in one frame
   (7–13 fps during that layout). Canvas + no worker is the ceiling; ELK-in-a-worker or WebGL would not be.
6. **Loses at edge-label legibility.** At fit-to-screen zoom the remote names — the whole point of s1 — are
   ~6 px and collide. Cytoscape has no label de-collision.
7. **s2 exposed the compound weakness** (leaf→container transition, and 40 children that a force layout
   handles badly until you tile them yourself).
8. **s3 exposed two things**: alpha-stacking of 52 near-identical edges into an opaque wedge, and the fact
   that the scenario's identity trap is a *disconnected component* — unreachable by expansion alone, which
   forced a synthetic "scan this host" relation.
9. **s1 is where the approach looks best**: compound hosts, disagreeing remote names, and a duplicate annex
   UUID that is impossible to miss.
10. **Honest verdict**: right primitive, wrong performance envelope for the 20k-node future. I would ship
    Cytoscape for the worldmap and plan the aggregate/collapse tier now, not later.
