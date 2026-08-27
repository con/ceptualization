# Research for the "git walker/drawer" issues

Covers issues
[#1](https://github.com/con/ceptualization/issues/1) (draw relationships between clones of git/git-annex repos),
[#4](https://github.com/con/ceptualization/issues/4) (subdatasets),
[#5](https://github.com/con/ceptualization/issues/5) (alerts about updates in remotes and worktrees) and
[#6](https://github.com/con/ceptualization/issues/6) (discover, pre-view and add clones as remotes).

Goal, as stated in the request that triggered this research: an interactive
"worldmap of git and git-annex" -- a graph of knowledge about clones that you
**expand as you navigate it**, **store**, and **come back to** later to keep
expanding. Explicitly unlike `git annex map`'s one-shot dump.

Five independent research tracks were run in parallel. Each document below is
self-contained; this README is the synthesis and the editorial judgement over
them.

**Start with [DESIGN.md](./DESIGN.md)** — the running design document and
feature ledger: what was decided, what is built, what is verified, what is
next. The documents below are the research behind those decisions.

| Document | Track |
| --- | --- |
| [tools-git-native-visualizers.md](./tools-git-native-visualizers.md) | Existing OSS tools that draw/navigate git repo, branch and remote graphs |
| [tech-graph-visualization-stack.md](./tech-graph-visualization-stack.md) | Browser graph rendering/layout libraries, exploration apps, view-state formats |
| [semantic-layer-quay-ontosphere-ontologies.md](./semantic-layer-quay-ontosphere-ontologies.md) | Evaluation of quay & ontosphere; vocabularies; RDF vs plain JSON |
| [ecosystem-and-walker-data-sources.md](./ecosystem-and-walker-data-sources.md) | git-annex/DataLad prior art, forge & discovery APIs, cheap remote-state acquisition |
| [architecture-persistence-and-prior-art.md](./architecture-persistence-and-prior-art.md) | Expandable-knowledge-map prior art, app architecture, persistence & merge design |
| [generic-graph-explorer-and-datalad-concepts.md](./generic-graph-explorer-and-datalad-concepts.md) | **Follow-up**: reframing as a generic graph explorer; review of concepts.datalad.org and the orinoco explore view |
| [pluggable-kg-exploration-and-brainkb.md](./pluggable-kg-exploration-and-brainkb.md) | **Follow-up**: dump-things-service as the store; BrainKB alignment; pluggable-expansion prior art (Translator/TRAPI); evidence modelling; model-driven UI platforms |
| [repo-embedded-things-and-collections.md](./repo-embedded-things-and-collections.md) | **Follow-up**: query-things traversal; storing things in `.git/` vs an `orinoco` branch (tested); repo-as-seed browsing; many collections over common nodes |
| [vocabulary-for-clones-and-remotes.md](./vocabulary-for-clones-and-remotes.md) | **Follow-up**: what vocabulary exists for clones/remotes/submodules (verified against schema.org 18.0, ForgeFed, SEON, SWHID/purl); extend-and-map recommendation; the W3C question |
| [distribution-modeling-and-repo-identity.md](./distribution-modeling-and-repo-identity.md) | **Follow-up**: Distribution as the class with form as instance data; why no content-based repo id can exist (measured); identity as claims over objective relations |
| [exploration-history-and-undo.md](./exploration-history-and-undo.md) | **Spec**: undo/redo over the exploration view — why history must never roll back the store, and why a step must snapshot geometry |
| [node-badges-and-relation-details.md](./node-badges-and-relation-details.md) | **Spec (TODO)**: at-a-glance badges on repository rectangles, annex storage sizes derived from key names, `annex-ignore` aggregates, and a details panel for the remote itself rather than the repo |

## Provenance and caveats

Research was done in a sandbox whose egress policy **blocked several primary
sources**: `git-annex.branchable.com`, `concepts.datalad.org`,
`registry.datalad.org`, `docs.datalad.org`, `codeberg.org`,
`archive.softwareheritage.org`, `api.ecosyste.ms`, `api.deps.dev`, `linkml.io`,
`forgefed.org`, `app.radicle.xyz`, `api.github.com`.

Anonymous `git clone` of public GitHub repos *did* work, so the strongest
findings below come from reading upstream source directly rather than from
search snippets. Claims are tagged in the documents; anything unverifiable is
marked `[UNVERIFIED]`. **Treat `[UNVERIFIED]` items as leads, not facts.**

## The five findings that actually matter

### 1. The niche is empty -- but the hard part is already solved and shipped

Across ~55 verified projects, the number of open source tools whose **nodes are
clones and whose edges are git remotes** is **one**: `git annex map`. Every
other "git visualization" tool draws the commit DAG *inside a single repo*.
There is no tool to adopt wholesale.

However, `git annex map` is further along than issue #1 assumed. Verified
directly from upstream source (`Command/Map.hs`, `CHANGELOG`):

* **`git annex map --json` exists.** It landed in **git-annex 10.20250605**
  (`* map: Support --json option.`). The
  [todo referenced from issue #1](https://git-annex.branchable.com/todo/map__58___add_--json/)
  is done. Issue #1 should be updated to reflect this.
* The emitted schema is exactly:

  ```json
  {"nodes": [{"description": "...", "uuid": "...|null", "url": "...",
              "remotes": [{"remote": "...|null", "uuid": "...|null", "url": "..."}]}]}
  ```

* **Three gaps in that JSON that matter for us**, read off the source:
  * **no host/cluster information** -- the `cluster_<host>` subgraphs that make
    the drawing in issue #1 readable exist *only* in the DOT output; from JSON
    the host must be re-derived from `description`/`url`;
  * **no trust level** in the output, and
  * `filterdead` **silently drops dead remotes** -- precisely the *warning*
    issue #1 asks to render.

**Correction to the research:** both the visualizer and ecosystem tracks
described `git annex map` as GPL-3. `Command/Map.hs` is **AGPL-3-or-later**.
This flips the recommendation: do **not** fork or port that code into a
permissively licensed tool. **Consume `--json` as a data source** (running a
program and parsing its output creates no derivative work) and implement host
grouping, trust and dead-remote reporting ourselves.

### 2. Most of the worldmap needs no ssh at all -- this should reshape the design

The single most consequential finding. The `git-annex` branch of any annexed
repo already contains most of the map, and can be fetched anonymously:

```
git fetch --depth 1 --filter=blob:none <url> refs/heads/git-annex   # 1.58 s / 8.1 MB
git show git-annex:uuid.log                                          # 0.48 s
```

Measured on `OpenNeuroDatasets/ds005256` (the dataset from issue #1), that
yields **14 repositories across 6 hosts** with `user@host:/path` descriptions,
plus `remote.log` (special-remote configs, incl. S3 exporttree/publicurl) and
`trust.log` (dead markers). `proxy.log`/`cluster.log` supply further edges;
location logs are the source for the shared/unique-content-size metric
issue #1 wants on edges.

I regard this as the finding that should reframe the project. Issue #1 frames
the walker as an **ssh spider**, and that framing carries the entire security,
auth and reachability burden of the design. In practice ssh is the *fallback*
for facts the annex branch cannot supply (bare-vs-worktree, working-tree state,
local worktrees, non-annex repos, aheadness of a non-public clone), not the
primary mechanism. An annex-branch-first walker is dramatically cheaper,
safer, parallelisable and runnable by someone with no credentials at all.

There is a sharp corollary the research is right to flag: that `uuid.log` dump
**leaks institutional hostnames, HPC login names and absolute paths out of a
public repo**. A worldmap that is easy to publish is also easy to over-share.
Redaction needs to be a first-class feature, not an afterthought.

### 3. quay is not the language for this; ontosphere is a free viewer, not the product

Answering the question directly, from the cloned source rather than the README:

**quay** is a DCAT profile for *how you fetch bytes* -- protocol, auth,
operation, delivery mode, encryption, SLA. `grep -c 'Repository'` on the
ontology returns **0**; `grep -ci 'annex'` returns **0**. Its git-annex
"patterns" model each special-remote **type** as a single `dcat:Distribution`:
one node, no edge, no UUID, no remote name. It describes *species*; the
worldmap is ~90% *individuals*, identity and topology -- quay's blind spot. It
is also four days old (first commit 2026-08-17, one author, v0.0.1) and its own
design doc puts provenance tracking out of scope. **Verdict: don't build the
language on it.** Cite its class IRIs as `exact_mappings` on our
protocol/encryption enums if we want the alignment; don't `owl:imports` it and
don't model clones as `dcat:Distribution`.

**ontosphere** is substantially more mature (Apache-2.0, ~961 commits, 65k LOC,
Reactodia canvas, N3.js, Comunica, SHACL, OWL reasoning in WASM, live demo,
DOI), but it is a *generic RDF/OWL editor*: no graph persistence, fixed
named-graph partitions, generic node cards, and it cannot ssh anywhere. It
cannot be the product. It **can** be a genuinely free win: emit `worldmap.ttl`
and open it via ontosphere's `?rdfUrl=<raw url>` for pan/zoom/SPARQL/SHACL at
zero implementation cost. Worth doing as a throwaway spike; note the LGPL
components bundled into an Apache-2.0 app if anything is ever vendored.

The vocabulary that *does* fit the fork half of issue #6 is **ForgeFed**
(`Repository`, `Branch`, `Commit`, `cloneUri`, `forkedFrom`, `mirroredFrom`) --
though it has zero git-annex coverage. `git2PROV` is dead (last commit 2021,
domain does not resolve). `concepts.datalad.org` is LinkML and contains no
git/annex/clone/remote terms, confirming issue #1's own reading: we align to it
and author the git layer ourselves.

**On RDF generally:** the recommendation is to model in **LinkML** (same
tooling as DANDI and datalad-concepts) and *generate* JSON Schema, Pydantic, TS,
JSON-LD context, OWL and SHACL from one source -- buying the RDF option without
paying for an RDF runtime. One argument against RDF as the store holds up: RDF is
monotonic, so an OWL reasoner would `sameAs`-merge two clones sharing an annex
UUID -- whereas issue #1 wants exactly that rendered as a **loud error**.

**Superseded:** the second argument -- that our edges carry data (`name`,
`ahead.commits`, `ping`, `shared_bytes`) and so this "must" be a property graph
-- does not survive contact with the actual model. `dlthings:Statement` plus
`characterized_by` (reification) gives data-carrying edges inside an
RDF-compatible model. See
[generic-graph-explorer-and-datalad-concepts.md](./generic-graph-explorer-and-datalad-concepts.md)
section 1.

### 4. Store observations, not a graph

The persistence proposal I find most convincing: the artifact is not a graph,
it is a set of **timestamped observations** from which a graph is derived.
Append-only JSONL, one file per crawl run
(`<ISO8601>--<agent>--<run-ulid>.jsonl`), with every fact carrying `t_observed`,
`by` (which probe), `via` (**vantage point**) and `status` -- failed probes
recorded too.

Two properties fall out of this for free:

* **Merging without CRDTs.** Immutable observations under union form a
  join-semilattice, and union of added files is what git already does. Two
  people crawling different parts of the world merge with zero conflicts,
  reviewably. Automerge/Yjs/Loro solve concurrent mutation of a shared
  document, which this data does not have.
* **`via` is load-bearing**, because reachability genuinely differs per host:
  "smaug is unreachable" is not a fact about smaug, it is a fact about
  smaug-as-seen-from-lena. A plain graph store cannot express that; this can.

Keep *data* (crawled facts) and *view* (positions, expansion set, filters)
in separate files. Both should be written with sorted keys, stable ordering and
rounded coordinates, or every re-crawl produces a meaningless thousand-line
diff.

### 5. Cytoscape.js, on one decisive constraint

Three tracks converged independently on **Cytoscape.js** (MIT), which I take as
a real signal rather than a coincidence. The decisive constraint is
**compound (nested) nodes**: the drawing in issue #1 is built entirely from
`cluster_<host>` subgraphs, and issue #4 needs arbitrarily deep subdataset
nesting. **sigma.js, force-graph, cosmos.gl and NetV.js have no compound-node
model at all**, which eliminates the entire "fast WebGL" tier here. Cytoscape
also gives multi-edges, self-edges and per-edge labels (issue #1 needs all
three), plus headless rendering for static export.

Supporting picks: `cytoscape-fcose` (compound-aware; `randomize:false` +
`fixedNodeConstraint` pins everything already placed, which is what makes
click-to-expand not rearrange the world), `cytoscape-layout-utilities` (exists
specifically to place newly added nodes), `cytoscape-elk` (layered DAG view for
#6), `cytoscape-node-html-label`/`popper` (the "balloon" badges of #5).

**Cheapest possible start:** `git annex map` already emits DOT with
`cluster_<host>` subgraphs. Run it through `@hpcc-js/wasm` with output format
`dot_json` to get real Graphviz positions in-browser and offline, feed those to
Cytoscape as a `preset` layout. A prototype reproducing the picture in issue #1
needs no graph library at all.

Licensing landmines found and worth recording: `mhutchie/vscode-git-graph` is
**not** really MIT (its licence forbids distributing derivative works) and is
the first thing anyone would reach for; `@cosmograph/*` is CC-BY-NC-4.0;
tldraw needs a production key; Neo4j NVL and Memgraph Lab are not FOSS;
`cytoscape.js-expand-collapse` is author-declared unmaintained. Kùzu was
archived 2025-10-10 and Aleph's maintenance ended Dec 2025 -- don't build on
either.

## Prior art worth stealing from (nobody does the whole job)

* **Maltego** -- the closest conceptual model that exists: Entities +
  Transforms + Machines + a saved `.mtgx` map maps almost 1:1 onto clones +
  probes + crawl policies + a saved worldmap. Make probes typed plugins so the
  UI can offer "what can I do with this node?", and split cheap/local (run
  automatically) from expensive/remote (explicit click).
* **AWS graph-explorer** (Apache-2.0, React + Cytoscape.js) -- exactly the
  expand-neighbours interaction, with session persistence that restores the
  graph *and re-fetches* it. Crib the interaction, don't use as a base: its
  data layer is wired to Gremlin/SPARQL/openCypher, where expansion is a
  database query, not a 40-second fallible ssh probe.
* **OpenCTI** -- per-node badge showing the count of *linked-but-not-displayed*
  neighbours. This is the fix for the worst ambiguity in an incrementally
  expanded map: "this clone has no remotes" versus "I haven't looked yet".
  Extend to `?` unprobed / `+N` hidden / stale-clock / `!` failed.
* **Litmaps' Monitor** (saved map + scheduled re-run + alerts) is essentially
  issue #5 in another domain.
* **Juggl** (Obsidian, cytoscape.js) ships literally the requested feature:
  "save your graph and continue working on it later."
* **Argo Lite** (MIT) -- incremental exploration plus shareable immutable
  snapshot URLs that viewers can keep exploring from.
* **useful-forks** (MIT) -- per-fork ahead/behind with grey-out-of-empty-forks,
  which is close to a literal implementation of issue #6's preview.

## Data sources for the walker, ranked

1. **The `git-annex` branch** (`uuid.log`, `remote.log`, `trust.log`,
   `proxy.log`, `cluster.log`, location logs) -- anonymous, ~1.5 s, no
   credentials, yields most of the map. See finding 2.
2. **`git annex map --json`** -- ready-made local+ssh discovery, AGPL, consume
   as a subprocess.
3. **datalad-registry** -- `GET /api/v2/dataset-urls?ds_id=<UUID>` returns
   records already carrying `head`, `annex_uuid` and
   `branches: {name: {hexsha, last_commit_dt}}`. This is the "pre-view without
   cloning" backend issue #6 asks for. Caveat: it does **no** URL
   normalisation, so query several spellings. `datalad-repos.json` (7.24 MB,
   public, no auth) enumerates ~12.5k GitHub + 4,628 hub.datalad.org + 974 GIN
   repos.
4. **Cheap aheadness, measured**: `ls-remote --heads` = 0.44 s (cost is the
   ~0.45 s TLS floor, not ref count); `--filter=tree:0` fetch of a 17,784-commit
   branch = 1.08 s / 6.8 MB, second branch 0.72 s and **zero** extra bytes;
   then `git rev-list --left-right --count A...B` locally.
   `--filter=blob:none` costs double for the same job.
   `git fetch --negotiate-only` returns common ancestors with no packfile.
5. **Forges**: GitLab forks API works unauthenticated at 500 req/min
   (incl. `forked_from_project`); Gitea/Forgejo `ListForks` + `/compare/*`
   confirmed in router source, so **one plugin covers Codeberg and
   hub.datalad.org**, since forgejo-aneksajo is a Forgejo soft fork.
   **GitHub's Network graph has no API** -- it is documented purely as a UI
   showing at most 100 recently-pushed branches, so issue #6's "Insights ->
   Network" source must be reconstructed from `/forks` + `/compare`.
   Software Heritage's backward "which origins contain this commit" traversal
   is gated behind `API_GRAPH_PERM` -- worth requesting, not worth depending on.

RIA store layout was verified from `create_sibling_ria.py`: a RIA is directly
walkable with `ls` + `ls-remote`, no DataLad needed, so the BABS per-subject
branch accumulation case in issue #5 falls straight out.

## My judgement on scope

Issue #1 proposes **walker / collectors / renderer** as three components. That
decomposition is nearly right but, taken literally, forbids the core UX:
click-to-expand requires the viewer to call back into the walker. The amendment
I'd adopt is a **hub, not a pipeline** -- the store is the only shared thing,
and walker, daemon, viewer, exporters and any notebook widget are all peers
around it. Exporters stay pure functions of the store; the interactive viewer
is a client of a thin local daemon that schedules probes into the store.

One project, not three, at least initially: **the schema is the product** and
it will churn. Enforce package boundaries internally (`model` must not import
`walker`) so splitting later is cheap if datalad-registry becomes a second
consumer.

Architecture: Python + FastAPI on `127.0.0.1`, SSE for crawl progress, Vite +
Cytoscape.js frontend. Ship remote probes as a single POSIX `sh` script piped
over ssh (`ssh host 'sh -s' < probe.sh`) so **no Python is required on
remotes** -- that is what makes multi-hop HPC crawling actually work. Refuse to
be an ssh library: inherit `ssh-agent`, `~/.ssh/config`, `ControlMaster`,
`ProxyJump`. Tauri and Electron were considered and rejected (a Rust backend
would shell out to Python anyway and arrive back at the localhost-daemon design
with extra steps).

**A self-contained interactive HTML export is more valuable than it looks.**
Issue #1 exists because someone hand-drew a mermaid diagram *to paste into an
issue*. An export that produces one shareable file preserves that workflow and
is the feature most likely to get the tool adopted.

**On auto-ssh spidering:** mechanically it is automated credentialed lateral
movement across institutional infrastructure, and it should be built that way
from day one -- default-deny host allowlist, `ProxyJump` over `ForwardAgent`,
a read-only command set, host identity by **ssh host-key fingerprint** rather
than hostname string (which also solves the "is this the same machine?" dedup
problem), recorded provenance, and a redaction mode.

## Suggested MVP

"`git annex map`, but incremental, persistent and clickable", with the
annex-branch-first reframing from finding 2:

* Crawl local repos + the `git-annex` branch of every reachable remote; ssh
  only where explicitly allowed.
* Entities: clone / host / forge-repo / special-remote. Edges carry the
  **per-clone remote name** -- the actual pain point in issue #1.
* URL canonicalisation (`giturlparse`) so the same repo reached via
  https/ssh/git with or without `.git` is one node.
* Findings: duplicate `annex.uuid`, dead remotes, unreachable hosts.
* Resumable append-only store; `ls` / `show` / `doctor`.
* `export --mermaid` and `export --html` (self-contained Cytoscape.js).
* `serve` with pan/zoom, group-by-host, and a saved default view.

Out of MVP: live click-to-probe, fork discovery, aheadness, subdatasets, write
actions.

**Done when** the spacetop map from issue #1 can be reproduced, saved, returned
to a week later, re-crawled, diffed, and pasted into an issue as mermaid.

Then: v0.2 interactive expansion + badges + named views (#1) -> v1.0
subdatasets as compound nodes (#4) -> v1.1 ahead/behind as timestamped edge
attributes + worktree nodes + `--watch` (#5) -> v2.0 forge/registry discovery,
grey-out-if-not-ahead preview, "Add as remote" (#6).

Name suggestions in the `con/` style: **`con/verge`**, `con/stellation`,
`con/spectus`; CLI `git-worldmap` (usable as `git worldmap`).

## Open questions for the maintainers

1. Is the annex-branch-first reframing acceptable, or is ssh-spidering a
   requirement in its own right (e.g. for non-annex repos and worktrees)?
2. Should the worldmap itself be a DataLad dataset? It is on-brand and gives
   sharing/versioning for free, but adds a dependency to a tool that otherwise
   needs only git.
3. Is LinkML the right modelling language given DANDI and datalad-concepts
   already use it, or is that more ceremony than a first release needs?
4. How much does the redaction problem in finding 2 constrain the default
   behaviour -- should published exports be redacted by default?
