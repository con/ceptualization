# Design: the git/git-annex worldmap

**The running design document.** Every feature requested in this project, what
was decided, whether it is built, and how that was verified. Update this file
whenever a feature is requested, specified, implemented or measured — it is the
one place that should never be stale.

Covers issues [#1](https://github.com/con/ceptualization/issues/1),
[#4](https://github.com/con/ceptualization/issues/4),
[#5](https://github.com/con/ceptualization/issues/5),
[#6](https://github.com/con/ceptualization/issues/6).
Detailed research lives in the documents indexed by [README.md](./README.md);
this file is the decision and status ledger, not a summary of them.

Legend: **✅ built & verified** · **🟡 built, unverified** · **📋 specified** ·
**💭 decided, unwritten** · **❌ rejected**

---

## 1. What we are building

An interactive **worldmap of git and git-annex clones**: a graph of knowledge
you expand as you navigate, persist, and return to. Nodes are distributions
(clones, bare repos, RIA stores, special remotes); edges are relations
(remotes with their per-clone names, subdatasets, worktrees, forks).

Three things distinguish it from every tool surveyed: expansion is
**incremental and typed**, the map is **persistent knowledge** rather than a
render, and the same graph is viewed through **different perspectives**.

## 2. Settled architecture

| Decision | Status | Where argued |
| --- | --- | --- |
| Local program + browser UI; not static, not Tauri | ✅ | [generic-graph-explorer §5a](./generic-graph-explorer-and-datalad-concepts.md) |
| Shell out to system `ssh`/`git`; never reimplement them | 💭 | same |
| Store = observations, append-only, with `t_observed`/`by`/`via` | 📋 | [architecture](./architecture-persistence-and-prior-art.md) |
| `.git/orinoco/` is local-only; an `orinoco` **branch** travels (tested) | 📋 | [repo-embedded things §2](./repo-embedded-things-and-collections.md) |
| dump-things-service as the record store; query-things for traversal | 📋 | [pluggable KG §1](./pluggable-kg-exploration-and-brainkb.md) |
| Model in **LinkML**, extend datalad-concepts, map outward, import nothing | 📋 | [vocabulary](./vocabulary-for-clones-and-remotes.md) |
| `Distribution` is the class; vcs/layout/annex_mode are instance slots | 📋 | [distribution modeling](./distribution-modeling-and-repo-identity.md) |
| Identity is a **claim**, never a silent merge | 📋 | same |
| Renderer: Cytoscape, containers owning their own geometry | ✅ | [bake-off](./prototypes/BAKE-OFF-RESULTS.md) |

**The load-bearing result:** container geometry must be taken *away* from the
layout engine, with leaf positions stored container-local against a corner
that never moves. That converts 980 px and 1588 px of churn into **0 px**, and
it is a data-model property, portable to any renderer — not a library choice.

## 3. Feature ledger

### Exploration

| Feature | Status | Notes |
| --- | --- | --- |
| Expand along a typed relation, one probe at a time | ✅ | 300–900 ms simulated probe; only new nodes returned |
| Expansion never moves already-placed nodes | ✅ | 0 px on 16/17 expansions; control arm at 10/17 up to 607 px |
| `reveal all` — show an entire crawled map at once | ✅ | crawls are already on disk; probing them one relation at a time is theatre |
| **Undo / redo** of exploration steps | ✅ | full history to 100 steps, jump-to-point, `Ctrl+Z` / `Ctrl+Shift+Z`; [spec](./exploration-history-and-undo.md) |
| **Hide node / hide container** | ✅ | leaves the view, stays in the store, returns when another route reaches it; undoable |
| Root set + "N nodes not reachable from here" | ✅ | all three round-1 teams silently lost a component without it |
| `contains` as a first-class walkable relation | ✅ | derived from `parent`; without it a quarter of s3 is unreachable |
| Collapse containers, aggregating edges not just hiding nodes | ✅ | 86→7 and 66→3 edges; node-hiding alone made frames *slower* |
| Perspectives (named view profiles over one graph) | 💭 | prototyped by Team C; not in the chosen line |
| Live click-to-probe against real ssh | ❌ not built | crawler is offline; ssh design specified, unimplemented |

### Rendering

| Feature | Status | Notes |
| --- | --- | --- |
| Host / RIA / superdataset containment as nested boxes | ✅ | containers are ordinary nodes with explicit geometry — no compound nodes |
| Per-edge remote names legible without an inspector | ✅ | 13 px at fit zoom, vs 4.3–5.1 px in round 1 |
| Duplicate annex UUID rendered as a loud error | ✅ | all four prototypes |
| Ahead/behind indicators | ✅ | from local refs; **only as fresh as the last fetch** |
| Grey out forks with nothing new | ✅ | 52 of 60 in the s3 fixture |
| **Node badges** (health / annex policy / storage / topology / form) | ✅ | glyph-first, priority-ordered, capped at 4 + `+N`, per-group toggles persisted; [spec](./node-badges-and-relation-details.md) |
| Layout off the main thread | ✅ | both tiers in a Web Worker; longest frame 416→100–117 ms |
| **Relation details panel** (click an edge, see the remote) | 📋 **TODO** | currently clicking an edge still shows the repository |
| Node text legible at fit zoom | ❌ open | 6.8 px; only *edge* labels were fixed |
| Semantic zoom / "balloons" from issue #5 | 💭 | Team C prototyped; not in the chosen line |

### Data

| Feature | Status | Notes |
| --- | --- | --- |
| Crawl real repos into a worldmap | ✅ | [`tools/worldmap-crawl.py`](./tools/) — plain git only |
| Clones discovered from the `git-annex` branch | ✅ | 1.27 s fetch → 23 clones on `dandi-bib`, no ssh, no credentials |
| Remotes with per-clone names, worktrees, submodules, dataset id | ✅ | |
| Ahead/behind without network | ✅ | from local remote-tracking refs |
| Host parsed from annex `user@host:/path` descriptions | ✅ | otherwise everything piles onto one "unknown" host |
| `annex-ignore` + pushurl per remote | ✅ | edge property, since clones disagree |
| Annex-incapable forge defaults | ✅ | marked **assumption**, never on a host node, never on a special remote |
| **Annex sizes via `git annex info`** | 📋 TODO | `--json --bytes --show=`; fast since 10.20240831. Do **not** hand-sum `-s<bytes>` |
| **Content diff via `git annex find --in=X --not --in=Y`** | 📋 TODO | two figures, never one signed number |
| Fork discovery (GitHub/GitLab/Forgejo) | ❌ not built | issue #6 |
| Identity resolution (`same_as`, containment scoring) | ❌ not built | specified in detail |
| Persistence into `.git/orinoco/` + `orinoco` branch | ❌ not built | specified and tested at the git level |

### Provenance & sharing

| Feature | Status | Notes |
| --- | --- | --- |
| Save / load / continue a view | ✅ | 0.462 px reload drift; 16 of 199 diff lines per expansion |
| Self-contained single-file HTML export | ✅ | 469–511 kB, zero external refs, verified over `file://` |
| **Version stamping** | ✅ | `git describe --always --dirty` in the footer; crawler stamps `tool_version`, `git_version`, `git_annex_version`, `crawled_at` |
| Mermaid export for pasting into an issue | ❌ not built | how issue #1 began; still the cheapest sharing path |

## 4. Rules that constrain future work

Derived from measurement or from the model; break them deliberately, not by
accident.

1. **Knowledge is append-only.** Undo, hide and collapse change the *view*.
   Nothing in the UI deletes a crawled fact. (Violating this broke redo.)
2. **Never merge two nodes silently.** Co-reference is an assertion with
   provenance — including the DataLad dataset id, which settles ~99% of cases
   but is still evidence.
3. **Assumptions must not look like measurements.** The annex-incapable forge
   list is rendered distinctly from an observed `annex-ignore`.
4. **Ask the tool, don't reimplement it.** `git annex info` for sizes,
   `git annex find` for set membership, system `ssh` for transport.
5. **annex-capability is a property of the route, not the host.** A `git-lfs`
   special remote carries content to a host whose git remote cannot.
6. **Anything hardcoded that describes the data will be wrong.** Scenario
   lists, walkable relations and forge lists all had to become derived.
7. **A seed is not a root set.** Always report what is unreachable from here.

## 5. Known gaps and untested claims

* **Nothing has been tested above 68 real nodes.** Every scale claim across
  all four prototypes is extrapolation from synthetic data.
* Rendering was measured on **software WebGL** (SwiftShader), ±40 % run to
  run; treat frame times as ordering, not magnitude.
* **git-annex is not installed in the development sandbox**, so the storage
  badge group and every `git annex` invocation in the spec are unverified
  against real output.
* Ahead/behind reflects the **last fetch**, not live state; `--ls-remote`
  checks reachability only.
* The prototypes are a bake-off, not a product: no ssh, no forge APIs, no
  identity resolution, no writes.

## 6. Next, in order

1. **Relation details panel** — the one requested feature still unbuilt, and
   the biggest gap between what is crawled and what is legible.
2. **Wire `git annex info` / `git annex find`** into the crawler so storage
   badges and content comparison carry real numbers.
3. **Persistence into the repo** — `.git/orinoco/` plus the `orinoco` branch,
   which turns a crawl into something shareable.
4. **The two-collections test** — the CON research-group graph and the git
   worldmap in one store, one UI, two perspectives. This is the cheapest
   proof of the pluggability claim, on data that already exists.
5. Fork discovery and identity resolution (issues #6 and the identity work).
