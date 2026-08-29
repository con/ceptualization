# Three scenarios for the graph-exploration bake-off

Synthetic but structurally faithful fixtures, used to compare prototype
implementations of the visualization stack reviewed in
[tech-graph-visualization-stack.md](../tech-graph-visualization-stack.md).

Each directory holds a `worldmap.json`:

```jsonc
{ "scenario": "...", "title": "...", "exercises": [ ... ],
  "nodes":  [ {"id","type","label","on_host","parent","vcs","layout",
               "annex_mode","packaging","annex_uuid","dataset_id", ...} ],
  "edges":  [ {"id","source","target","kind","remote_name",
               "ahead","behind","resolution","observed_at","via", ...} ],
  "findings":[ {"severity","code","message","nodes"} ] }
```

`parent` gives containment (host → clone, RIA store → repo, superdataset →
subdataset) and is what compound/nested rendering keys off. `kind` on an edge
is the **relation to expand along**: `remote`, `subdataset`, `part`,
`worktree_of`, `fork_of`, `shares_history_with`, `candidate_same_as`,
`same_annex_uuid`.

| Scenario | Nodes | Edges | What it stresses |
| --- | --- | --- | --- |
| **s1-spacetop** | 24 | 25 | host clustering; per-edge remote names that disagree between clones; special remotes; a **duplicate annex UUID error**; a dead remote; bare vs worktree |
| **s2-babs-ria** | 51 | 87 | deep nesting (superdataset → subdatasets; RIA store → 40 per-subject repos); aheadness badges at scale; worktrees; collapsing 40 near-identical children |
| **s3-forks** | 68 | 66 | plain git with **no UUIDs at all**; 52 of 60 forks with nothing new (grey out); preview-before-add; identity as *confidence* not a merge; the measured template-sibling trap (containment 0.19) |

Derived from issues [#1](https://github.com/con/ceptualization/issues/1),
[#4](https://github.com/con/ceptualization/issues/4),
[#5](https://github.com/con/ceptualization/issues/5) and
[#6](https://github.com/con/ceptualization/issues/6), and from the model in
[distribution-modeling-and-repo-identity.md](../distribution-modeling-and-repo-identity.md).
Regenerate with `gen_scenarios.py` (fixed epoch, seeded RNG — output is
reproducible).
