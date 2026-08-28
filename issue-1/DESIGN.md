# Design: the git/git-annex worldmap

**The running design document.** Every feature requested in this project, what
was decided, whether it is built, and how that was verified.

> **Working rule: every code change updates this file in the same commit.**
> A feature is not done when it runs; it is done when this ledger says so and
> names the measurement.

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

It keeps paying. Drag-to-reposition was two lines of write-back *because* of
this model: a container owns a world centre, so moving it carries its children
for free; a repository owns an offset from its parent's top-left, so its
placement is already in the saved view. A layout-owned geometry would have
needed pinning, constraint solving and a separate persistence path for all
three.

The correction to that paragraph is instructive. It also claimed the offset
model meant a drag "cannot take a repository out of the box" — it does not.
The model makes the offset *cheap and durable*; it says nothing about its
range, and without a clamp a drag put a repository 552 px outside its box. A
good data model removes work; it does not remove the need to bound an input.
The clamp is now there, and §4a states the bound as a test.

## 3. Feature ledger

### Exploration

| Feature | Status | Notes |
| --- | --- | --- |
| Expand along a typed relation, one probe at a time | ✅ | 300–900 ms simulated probe; only new nodes returned |
| Expansion never moves already-placed nodes | ✅ | 0 px on 16/17 expansions; control arm at 10/17 up to 607 px |
| `reveal all` — show an entire crawled map at once | ✅ | crawls are already on disk; probing them one relation at a time is theatre |
| **Undo / redo** of exploration steps | ✅ | full history to 100 steps, jump-to-point, `Ctrl+Z` / `Ctrl+Shift+Z`; [spec](./exploration-history-and-undo.md) |
| **Hide node / hide container** | ✅ built, **one wrong intermediate state** | leaves the view, stays in the store, returns when another route reaches it; undoable. But `hide node` on a *container* leaves its children drawn and re-parents them into the root set: measured 769.41 px of movement and two repositories floating outside any box. Reversible, still wrong |
| Root set + "N nodes not reachable from here" | ✅ | all three round-1 teams silently lost a component without it |
| `contains` as a first-class walkable relation | ✅ | derived from `parent`; without it a quarter of s3 is unreachable |
| Collapse containers, aggregating edges not just hiding nodes | ✅ **after a fix** | 86→7 and 66→3 edges; node-hiding alone made frames *slower*. `collapse all` folded only containers with no **visible** parent, so a container drawn without its own parent on screen was skipped and its repositories stayed — reported twice as "collapse all still leaves individual repos". Now every container with visible children is folded; an inner fold is harmless when the outer one hides it. First asserted against a **stale build** (rule 37) — genuinely verified only after the harness learnt to rebuild. Asserted on four maps as *after collapse all, every drawn box is a container* (§5b rule 27) |
| **Bundle cross-container edges** into one arrow per container pair | ✅ built, **scenario-dependent** | roll-up is sound and conserves every edge (§4a rule 18); reduction measured at **47.1 %** on s2 (45 cross-container edges → 4 arrows) but **1.5 %** on s3 (66 → 65), where 60 of 68 nodes share one container and only 3 edges cross a boundary at all. Edges *inside* a container are left alone by design — which is exactly s3's problem |
| Perspectives (named view profiles over one graph) | 💭 → 📋 | prototyped by Team C; now given concrete form as `(lens, visible-set, layout, focus)` in [lenses-and-joined-graphs](./lenses-and-joined-graphs.md) |
| **Lenses: declarative per-modality rendering** (edge classes structural/route/affinity, containment choice, type filters, primary action) | 📋 specified, not built | the deployment viewer and the psychoinformatics `/explore/` portfolio graph are two lenses over graphs of the same kind; the descriptor must be data the one viewer consumes. [spec](./lenses-and-joined-graphs.md) |
| **Joined graphs: bridge records + portal badges** | 📋 specified, not built | cross-collection identity (dataset id, canonical URL, host, DOI, person) as explicit confident `same_as` records — never merges; navigation by portal pivot, not cross-lens arrows. [spec](./lenses-and-joined-graphs.md) |
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
| **Drag to reposition** a container, or a repository inside one | ✅ built, **seven defects found and fixed after the first ✅** | container drag moves its children and nothing else (0.00 px), and undo/redo of a move is 0.00 px — both held. The rest of the first ✅ was premature: a leaf did **not** stay inside its box (552 px outside), `S.moved` was never read so rule 9 was unimplemented (a collapse next door moved a hand-placed box 513 px), a drag during a probe was un-undoable (297 px), and hide→show lost a placement (236 px). All fixed and re-measured at 0.00 px; requirements in §4a, evidence in [UX-DRAG-BUNDLE](./prototypes/team-d/UX-DRAG-BUNDLE.md) |
| **Relation details panel** (click an edge, see the remote) | ✅ | a relation is selectable in its own right; shows remote name, URL/pushurl, resolution, `annex-ignore`, the forge assumption marked as such, recorded annex UUID, trust, ahead/behind with its staleness, and every name the peer is called by. Bundled arrows list their members and drill down. The two costly rows (`ls-remote` branch table, content diff) are present as disabled actions |
| **Flow perspective** (edge weight + world-time scrubber) | 💭 | the first feature that genuinely needs *perspectives*: the same graph answering a different question. Must **not** reuse the undo history — exploration time and world time are two timelines. [spec](./data-movement-and-annex-policy.md) |
| Node text legible at fit zoom | ❌ open | 6.8 px; only *edge* labels were fixed |
| Semantic zoom / "balloons" from issue #5 | 💭 | Team C prototyped; not in the chosen line |

### Data

| Feature | Status | Notes |
| --- | --- | --- |
| Crawl real repos into a worldmap | ✅ | [`tools/worldmap-crawl.py`](./tools/) — plain git only |
| **End-to-end suite over real repositories** | ✅ hardened & drilled | [`tools/e2e/`](./tools/e2e/) — eight real repositories (github remote, submodule, two clones, two worktrees, an untied second copy of the subdataset) → crawl → server → a scripted Playwright walk. 30 invariants on the fixture, 21 replayed per scenario (93 total today); the fixture is stamped with its script's hash so `--reuse` rebuilds when setup changes; auto ports + server health-check, staleness-driven rebuild of the viewer, quiescence waits (walk ~10 s, was ~50 s), try/finally cleanup, offline mode, CI on every push. Proven able to fail by mutation drill. §5 |
| Clones discovered from the `git-annex` branch | ✅ mechanism, **misleading result** | 1.27 s fetch → 23 clones on `dandi-bib`, no ssh, no credentials. Re-read since: of the 25 UUIDs, **24 are ephemeral CI runners and exactly 1 holds any content**. The fetch is right and the picture is wrong — see §6 |
| Remotes with per-clone names, worktrees, submodules, dataset id | ✅ | |
| **Subdatasets modelled as checkouts, labelled by path** | ✅ | a subdataset node is the checkout at `<super>/<path>` — contained in *its own* super, so a worktree's initialized submodule sits inside the worktree box; the edge label is the path (never the URL). Declared-but-uninitialized subdatasets point at their git-resolved URL target (relative URLs resolve against the superproject's **origin**, git's own rule), carry `state: not-initialized`, get **no** containment, and are emitted once per repository, not per worktree. Fixed alongside: submodule names with spaces (`sub _1`) parse via `git config -z`; a submodule's absorbed git dir (`.git/modules/…`) is never a node. Five e2e invariants pin all of this |
| Ahead/behind without network | ✅ | from local remote-tracking refs |
| Host parsed from annex `user@host:/path` descriptions | ✅ | otherwise everything piles onto one "unknown" host |
| `annex-ignore` + pushurl per remote | ✅ | edge property, since clones disagree |
| **Remote counts and expansion split by tracking** | ✅ | `rel_counts` now carries `remote@current:out` / `remote@tracked:out` / `remote@untracked:out` beside the total, `expand` accepts them as relations, and the details panel offers them as separate, labelled entries — so an untracked remote need never be expanded. A `⇄N` badge names the remotes the checked-out branch tracks. Verified per node in one map: a checkout on `claude/…` shows `remote@current:out 1`, a worktree on `master` with two untracked remotes shows `remote@untracked:out 2` |
| **Remotes classified by tracking** | ✅ | each remote edge carries `tracked_by` (the branches that track it) and `tracking` = current / branch / none. Verified against `git config` ground truth. Viewer filters `current` / `tracked` / `all` — on a mixed map 8 edges → 6, dropping exactly the untracked pair — and styles current thicker, untracked dotted |
| **Worktrees produce one arrow each, not N²** | ✅ | `git worktree list` reports every worktree whichever one you run it in, so N worktrees naively emitted N² `worktree_of` edges. Anchored on the **main** worktree and globally deduped: 5 worktrees → **4** arrows, not 25 |
| **Remotes emitted once per repository, not per worktree** | ✅ | linked worktrees share `.git/config`, so 20 worktrees × 59 remotes drew 1180 identical arrows and implied something untrue. 5 worktrees × 2 remotes → **2** edges, not 10 |
| Annex-incapable forge defaults | ✅ | marked **assumption**, never on a host node, never on a special remote |
| **Annex sizes via `git annex info`** | 🟡 built, **unverified against real output** | `--json --bytes --fast --show='annex sizes of repositories'`; parser unit-tested against real-shaped output and against git-annex being absent, but **git-annex is not installed here** so no end-to-end run exists |
| **Content diff via `git annex find --in=X --not --in=Y`** | 🟡 built, **unverified** | live behind the relation panel's second button, reported as two figures with a "believed from location tracking" note; same git-annex caveat |
| Branch correspondence table via `git ls-remote` | ✅ | live behind the relation panel's first button; each result names the command that produced it |
| **Annex policy: groups, wanted, numcopies** | 📋 specified, not built | `group.log`, `preferred_content.log`, `group_preferred_content.log`, `required_content.log`, `numcopies.log` — plain `git cat-file`, the same mechanism as `trust.log`, so **no git-annex binary needed**. Committed to the branch, therefore *every clone agrees* — unlike `annex-ignore`. `source`→`transfer`→`backup`/`archive` is a declared flow shape, free of any history replay. [spec](./data-movement-and-annex-policy.md) |
| **Automated routes** (`git annex sync`, cron, CI, hooks, `autoenable`) | 📋 specified, not built | no field says "automated"; it is inferred, so the record carries **evidence and strength**, never a boolean — as with `annex_incapable_assumed`. Strongest free signal is the `git-annex` branch *author*. [spec](./data-movement-and-annex-policy.md) |
| **Data movement (flow) from the location log** | 📋 specified, not built | verified format `<unixtime>s <1\|0> <uuid>`; size is in the key name (`MD5E-s359--…`), so flow is **byte-weighted for free**. But direction is never recorded and an entry is a *claim*, not an observation. O(keys), so opt-in. [spec](./data-movement-and-annex-policy.md) |
| **Actor: is this clone a person or a bot?** | 📋 specified, not built | free and global — `uuid.log` descriptions plus `git log git-annex`. On `dandi-bib` this alone separates **1 real repository from 24 ephemeral CI runners**; see §6. Cheapest item in the whole ledger |
| Fork discovery (GitHub/GitLab/Forgejo) | ❌ not built | issue #6 |
| Identity resolution (`same_as`, containment scoring) | ❌ not built | specified in detail |
| Persistence into `.git/orinoco/` + `orinoco` branch | ❌ not built | specified and tested at the git level |

### Provenance & sharing

| Feature | Status | Notes |
| --- | --- | --- |
| Save / load / continue a view | ✅ | 0.462 px reload drift; 16 of 199 diff lines per expansion |
| Hand-arranged positions survive save / reload | ✅ **after a fix** | 0.01 px on a *top-level* node was the only case tested. Nested container sizes were saved and never read back: a RIA store reloaded as a 210×76 leaf, 735.68 px out, its 40 children drawn outside it — and re-saving wrote the loss to disk. Now 0.48 px worst over 51 nodes, and save→load→save is a fixpoint |
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
10. **A control must do what its label says.** "expand all" only unfolded
    collapsed boxes and never probed; it was read as broken twice. Renamed
    *uncollapse all*, with "reveal all" as the one that shows everything
    crawled. A control that silently does less than its name is a bug report
    generator.
8. **New roll-ups reuse `effectiveId`, they do not add a mechanism.** Collapse
   and cross-container bundling are the same operation with a different notion
   of "who represents me"; a second aggregation path would drift out of sync.
9. **User placement outranks the layout engine.** A dragged node is pinned and
   later layout runs work around it. This rule was stated here for a release
   in which the pinned set was recorded and never read; stating a rule is the
   moment to measure whether it holds.

### 4a. What drag, bundle, collapse, hide, undo and save must guarantee

The features above were each verified alone. Their *combinations* were not, and
seven of them were broken — four at high severity, two contradicting sentences
elsewhere in this file. These are the requirements a change to any one of them
must not break, each written so that it is a measurement. Bracketed numbers are
what the current build reports; the driver is
[`prototypes/team-d/tools/dragbundle.mjs`](./prototypes/team-d/tools/dragbundle.mjs).

**Placement**

1. Dragging a container must move that container and its descendants by the
   drag vector and **every other node by 0 px**. [364.21 px carried; 0.00 px
   over the other 22]
2. Dragging a repository must move **only** that repository (0 px for every
   other node) and must leave it **inside its container's box** — its drawn
   rectangle within the parent's, on all four sides. [0.00 px; inside]
3. A container box is sized from its child *count*, so a drag that the clamp
   reduces to nothing must be **refused explicitly**: no history entry, and the
   user told why. A silent snap-back is a failure. [0.00 px moved, 0 history
   entries, toast raised]
4. The pinned set is not decoration: every layout run must receive it, and no
   layout run may move a pinned node. [tier 2 reports `pinned: 39` of 40]

**Nothing else moves**

5. Expanding a node inside container A must move **0 px** of anything outside
   A, including a container the user has dragged. [0.00 px over 18 nodes]
6. Collapsing or expanding container A must move **0 px** of container B,
   whether or not A and B overlap. Separation exists to make room for
   *growth*: an overlap that existed before a resize must be left alone, or
   the layout will undo the user's arrangement to satisfy a margin nobody
   asked for. [0.00 px over 51 nodes; was 513.31 px]
7. A collapse → expand round trip must return every node to within 0 px of
   where it started, *after* an arbitrary number of drags. [0.00 px]

**Undo**

8. Undo of a move must restore **0.00 px**; redo must re-apply **0.00 px**.
   [0.00 / 0.00, including interleaved with collapses]
9. Every user action that changes the view must leave **exactly one** history
   entry, and a step that abandons its entry must abandon **its own**. A step
   runs across awaits, so a second step can open and close inside it; a
   history that pops blindly loses the wrong one. [0 orphaned entries]
10. No gesture may mutate the view while a probe is in flight. Either refuse it
    and say so, or make it a first-class step — never let it land inside
    someone else's undo entry. [refused, `S.busy` guard]
11. Every toolbar toggle that undo can change must be **re-read from state on
    every repaint**, not remembered from the last click. [bundle button matches
    `S.bundle`]

**Hide**

12. Hiding a node must move **0 px** of everything still shown. [0.00 px over
    50]
13. Showing a node the user placed by hand must return it to **0 px** of where
    they put it. [0.00 px; was 236.52 px] A node the *engine* placed may be
    re-placed, and that is a stated choice rather than an accident.
14. Hiding a container must not change the containment of anything: a node
    whose parent is hidden must not become a root. **Currently violated** —
    769.41 px of movement, children drawn outside any box.

**Save / load**

15. Save → load → save must be a **fixpoint**: the second file equals the first
    apart from the timestamp. Anything the view file stores and the loader
    ignores is silent data loss that compounds on every save. [344 = 344 lines,
    1 differing line, the timestamp; it caught both a lost size table and a
    lost zoom]
16. Reload must reproduce every node position to within 1 px and every
    container box to its exact saved size. [0.48 px worst over 51 nodes]
17. One user action must change **O(1) lines** of the canonical view file, not
    O(nodes). [1 line of 344 for a container move; 14–16 of ~199 for an
    expansion, the spread being the two `saved_at` lines]

**Aggregation**

18. Bundling and collapse are the same roll-up, so in every combination of the
    two, `Σ (member counts of drawn edges) + (edges folded inside a box)` must
    equal the number of raw drawable edges. No edge may be counted twice or
    disappear. [66 = 66 in all five states of s3; also holds on s1 and s2]
19. Turning bundling off must restore the **exact** set of individual edge ids,
    and toggling it either way must move **0 px** of geometry — it is an edge
    operation, not a layout one. [exact set; 0.00 px]
20. An aggregated edge must not present a summed `ahead`/`behind` as if it were
    one repository's. [suppressed for `count > 1`]
21. An arrow that stands for N edges must offer a way to see those N edges.
    [the relation panel lists them; a `×2` bundle offers both members]

### Requirements for policy, automation and flow (added with the data-movement spec)

31. **Policy, automation and flow are three different claims.** What *should*
    be somewhere (the git-annex branch), what moves it *without a person*
    (config, hooks, cron, CI) and what *did* move (the location log) have
    different confidences and different scopes. One arrow carrying all three
    would be a lie; they get separate fields and separate styling.
32. **A location-log entry is a claim, not an observation.** It records what
    whoever ran the command believed. A reformatted machine keeps claiming its
    content until `git annex fsck` says otherwise.
33. **Direction of transfer is never recorded** — the log says B has it, not
    where it came from. Any arrow of movement is inference and must be labelled
    as such, in the schema (`"direction": "inferred"`) as well as the UI.
34. **Never reimplement preferred-content expressions.** They are a real
    language; store them verbatim and ask git-annex (`--want-get` /
    `--want-drop`) when an answer is actually needed.
35. **Automation is inferred, so carry the evidence, not a boolean.** An
    explicit `annex-tracking-branch` and an unset `annex-sync` are not the same
    claim, and must not render the same. Same discipline as
    `annex_incapable_assumed`.
36. **Do not merge world time into exploration time.** The undo history is what
    I clicked; a flow scrubber is when data moved. Two controls.

### Crawl-shape requirements (added after a real worktree-heavy repository)

22. **An edge must be identical whoever observed it.** `git worktree list`
    returns the same list from every worktree, so edges derived from it must
    be anchored on a canonical endpoint (the main worktree) and deduped by
    `(source, target, kind, name)`. Naive emission is O(N²) and looked, on a
    20-worktree checkout, like a rendering fault rather than a crawl fault.
23. **A fact that belongs to the repository must not be repeated per
    checkout.** Linked worktrees share `.git/config`; emitting their remotes
    per worktree multiplies the map and asserts something untrue.
24. **A crawl-shape bug is invisible in the viewer.** Both of the above were
    reported as "pointless flood of green arrows". Edge-count sanity per
    relation kind belongs in the crawler's own output, not in the eye of
    whoever opens the map.

42. **A subdataset is the checkout, not its URL.** The node lives at
    `<super>/<path>` and is contained in the checkout that holds it — each
    worktree has its own. The `.gitmodules` URL is where the checkout's
    origin will point, i.e. a route, not an identity. Only when nothing is
    checked out does the URL target stand in, uncontained and marked
    `not-initialized`; that declaration is repository-level, emitted once.
43. **Nothing inside `.git` is a repository.** `git worktree list` run in a
    submodule reports the absorbed git dir (`.git/modules/…`) as its main
    worktree; taken literally this invents phantom repositories and marks
    every submodule checkout a linked worktree (suppressing its remotes).
44. **Parse git config with `-z` when values can contain spaces.** The
    first-space split silently produced garbage nodes for
    testrepo_gh's `sub _1`.

25. **A remote is not one thing.** A remote no branch tracks is
    configuration; one some branch tracks is in use; the one the checked-out
    branch tracks is what you are working with now. Store `tracked_by` as a
    list, never a boolean: each worktree has its own HEAD, so *current* is a
    question about a node, not about the edge.

## 5. Testing

Every interaction defect in this prototype so far was found by a human
clicking, and every one of them was a small bug behind a control whose label
promised something else: *"expand all seems to do nothing"*, *"hiding a
container leaves the individual nodes on screen"*, *"collapse all still leaves
individual repos"*, *"pointless flood of green arrows"*. None would have
survived a test that asserted what the label says. That is what this section
is for.

### 5a. What the suite is

[`tools/e2e/`](./tools/e2e/) — `./run-all.sh` runs all of it, `README.md`
there is the operator's copy.

| stage | what it proves |
|---|---|
| `setup-fixture.sh` | eight **real** repositories on disk: a clone of `datalad/testrepo_gh` with a live github remote, a submodule, two clones, two linked worktrees, and the same subdataset a second time with `origin` removed |
| `worldmap-crawl.py` | the crawl-shape requirements (22–25) hold on real repositories, not on generated JSON |
| `app.py` + `e2e.mjs` | Playwright walks the viewer and asserts the §4a guarantees |
| `--worldmap … --scenario …` | the viewer half replayed against every `scenarios/*/worldmap.json` (24, 51, 68 nodes today; a new scenario gains coverage by existing) — a regression that only shows on a wider map fails here |
| `.github/workflows/worldmap-e2e.yml` | the whole suite on every push touching the prototype, failure artifacts uploaded |

The fixture is built for the awkward cases, not the easy ones.
`independent-sub` is the same dataset as `super/sub` with **no local remote
joining them** — only shared history and the dataset id relate them, which is
the identity problem stated in
[distribution-modeling-and-repo-identity](./distribution-modeling-and-repo-identity.md).
`clone-b` carries two remotes no branch tracks, which is what the
`current`/`tracked`/`all` scopes exist for. The worktrees are what the
one-arrow-per-worktree fix was for.

### 5b. Rules the suite itself follows

26. **Assert relations, not golden numbers.** `reveal all ⊇ opening view`,
    not `19 nodes`. A fixture that grows must not turn the suite red.
27. **Assert what the label promises, not what the code does.** The stray
    check (no node drawn whose parent is collapsed or hidden) passed on every
    map while "collapse all leaves individual repos" was still true, because
    the two are different claims. The test that matters is *after collapse
    all, every drawn box is a container*.
28. **Every fix to a reported interaction defect ships with the assertion
    that would have caught it.** The four complaints above are now four
    named checks.
29. **A viewer invariant is tested on more than one map.** Conformance mode
    exists because the shapes differ enough (24 → 9 boxes on s1, 68 → 2 on
    s3) that a single fixture proves little.
30. **Zero console errors is an assertion,** held across the whole walk, not
    a thing someone notices afterwards.
37. **Test the build that is served, and rebuild it when the source is
    newer.** The server serves `web/dist`, a Vite build — not `web/src`. A
    mutation drill ran green against sabotaged source because the build
    predated it, and the collapse-all fix itself was first "verified" by a
    build from before the fix. The suite now rebuilds on staleness; the
    fix's green runs date from after that.
38. **A harness is only trusted once it has been seen red.** The mutation
    drill (sabotage → named FAILs, exit 1 → restore → green) is in the
    suite's README and is re-run whenever the harness itself changes. Its
    first execution is what found rule 37.
39. **Never trust a server you did not health-check, and never share fixed
    ports.** A zombie on a fixed port does not fail loudly — it serves stale
    data (the silent-fallback trap). Ports are probed free by default; the
    served scenario list and the loaded page must both name the requested
    scenario, as check 0.
40. **Wait for quiescence, not for a guessed number of milliseconds** — two
    identical consecutive samples of positions and edge count, with a floor
    and a ceiling. The walk got 5× faster *and* less flaky at once.
41. **Artifacts are removed on success and kept on failure** (or `--keep`),
    so a red run can be examined and a thousand green runs leave no litter.

### 5c. What it does not cover yet

* **git-annex** — the fixture is plain git, because the sandbox has no
  git-annex. The storage badges, `git annex info` sizing and the `git annex
  find` content diff are the three 🟡 rows and are still unverified
  end-to-end (§6).
* **ssh and forge APIs** — nothing remote is exercised beyond one clone of a
  public repository and `--ls-remote`.
* **Scale** — the largest map under test is 68 nodes.
* **Save/load and export** are not walked; `loadView` has already been wrong
  twice (lost container sizes, wrong zoom), so this is the next gap to close.
* **Layout quality** is not asserted at all, only layout *stability* (undo
  and uncollapse restore positions to sub-pixel).

## 6. Known gaps and untested claims

* **Nothing has been tested above 68 real nodes.** Every scale claim across
  all four prototypes is extrapolation from synthetic data.
* **The map counts automation as population.** Re-reading `dandi-bib`'s
  `git-annex` branch with plain git: 25 UUIDs in `uuid.log`, **24** described
  as `runner@runnervm…:~/work/dandi-bib/dandi-bib`, **1** holding any key at
  all, and the branch's last commit authored by `github-actions[bot]`. The
  crawler is behaving correctly — those UUIDs are real — but the map gives 24
  ephemeral GitHub Actions VMs the same rectangle, weight and expandability as
  the repository on your laptop, and states nothing about the one fact that
  matters: content lives in a single place and a bot puts it there. This is
  not a missing feature on top of a correct map; it is the map being wrong on
  real data. [data movement and annex policy](./data-movement-and-annex-policy.md)
  is the fix, and its first step is nearly free.
* **A ✅ that names only the happy path is not a ✅.** Drag and bundling were
  both marked "built & verified" here after each was measured *alone*. A pass
  over their combinations found seven defects, four of them high severity, two
  contradicting sentences in this file. Every future ✅ on an interactive
  feature must name the combination it was tested in.
  ([UX-DRAG-BUNDLE](./prototypes/team-d/UX-DRAG-BUNDLE.md) is that pass.)
* **Two interactions are still known-wrong**, recorded as such in §4a: hiding
  a container orphans its children (rule 14), and a container dropped on top
  of another stays overlapping — stable and reversible since the separation
  fix, but with no feedback that it happened.
* Rendering was measured on **software WebGL** (SwiftShader), ±40 % run to
  run; treat frame times as ordering, not magnitude.
* **git-annex is not installed in the development sandbox.** The storage
  badge group, `git annex info` sizing and the `git annex find` content diff
  are implemented and unit-tested against real-shaped output and against
  git-annex being absent, but **no end-to-end run against a real annex
  exists**. These are the only 🟡 rows in the ledger and they are the first
  thing to check on a machine that has git-annex.
* Ahead/behind reflects the **last fetch**, not live state; `--ls-remote`
  checks reachability only.
* The prototypes are a bake-off, not a product: no ssh, no forge APIs, no
  identity resolution, no writes.

## 7. Next, in order

1. **`actor` — is this clone a person or a bot?** Promoted to the top because
   it is nearly free (`uuid.log` descriptions plus `git log git-annex`, no
   git-annex binary, no network beyond the fetch already made) and because it
   fixes a map we are demonstrably drawing wrong today (§6). Then the rest of
   [data movement and annex policy](./data-movement-and-annex-policy.md) in
   its own cheapest-first order: policy from the branch, in-repo automation
   evidence, then opt-in flow replay.
2. **Verify the git-annex path on a machine that has git-annex** — the three
   🟡 rows. Everything else in the ledger has an end-to-end measurement; these
   have unit tests and a shape assumption. Blocked here: the sandbox has no
   git-annex.
3. **Persistence into the repo** — `.git/orinoco/` plus the `orinoco` branch,
   which turns a crawl into something shareable.
4. **The two-collections test** — the CON research-group graph and the git
   worldmap in one store, one UI, two perspectives. This is the cheapest
   proof of the pluggability claim, on data that already exists — and it now
   has a concrete UI meaning: step 3 of the staged plan in
   [lenses-and-joined-graphs](./lenses-and-joined-graphs.md), preceded by
   extracting the lens descriptor and toolbar type filters (steps 1–2).
5. Fork discovery and identity resolution (issues #6 and the identity work).
6. **Close the testing gaps in §5c**, cheapest first: walk save / load /
   export (`loadView` has been wrong twice already), then add a git-annex
   arm to the fixture on a machine that has git-annex — which is the same
   errand as item 2.
7. **Run the suite on every change.** It is `./tools/e2e/run-all.sh` and it
   takes about three minutes; nothing in this file gets a ✅ that the suite
   has not been extended to hold.
