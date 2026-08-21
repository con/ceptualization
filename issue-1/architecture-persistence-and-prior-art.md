# git walker/drawer — application architecture, persistence, and prior art in expandable knowledge maps

Research note for con/ceptualization issues [#1](https://github.com/con/ceptualization/issues/1),
[#4](https://github.com/con/ceptualization/issues/4), [#5](https://github.com/con/ceptualization/issues/5),
[#6](https://github.com/con/ceptualization/issues/6).

Scope of this note: **application architecture, persistence of the accumulated "worldmap", and prior art in
incrementally-expanded knowledge maps.** It does *not* cover the collector implementation details
(what exactly to run over ssh) beyond what constrains the architecture.

Every tool cited below was fetched and verified unless explicitly marked `[UNVERIFIED]`.

---

## TL;DR

1. **Build one repo, three packages, one CLI.** `walker` (probes + ssh fan-out), `model` (schema + store),
   `viewer` (SPA + exporters). Do not split into three projects yet — the schema *is* the product and it is
   not stable.
2. **The app is a local daemon + browser SPA**, launched as `git-worldmap serve` (the `git instaweb` /
   `datalad webapp` shape). Python + FastAPI/uvicorn bound to `127.0.0.1`, SSE for crawl progress,
   Cytoscape.js in the browser. A pure static page cannot crawl; ssh must run in a real process with the
   user's existing agent.
3. **Reject Electron/Tauri for v1.** Tauri buys you a Rust backend you do not want in a datalad/dandi world;
   Electron buys you 100+ MB for a window. `python -m webbrowser` + localhost is 100% of the benefit at 0% of
   the cost. Revisit only if "double-click an .app" distribution becomes a real requirement.
4. **The store is an append-only JSONL observation log in a git repo**, plus a *derived, gitignored* SQLite
   index, plus *separate* view files for layout/expansion/filters. Every fact carries
   `(observed_at, observed_by, probe, status)`.
5. **Merging is solved by naming, not by CRDTs.** One JSONL file per crawl run, named
   `<timestamp>--<agent>--<runid>.jsonl`. Two people crawling different parts of the world produce two new
   files; `git merge` is a pure add with zero conflicts. Automerge/Yjs/Loro solve a problem
   (concurrent mutation of a shared document) that an append-only observation log does not have.
6. **Ship two exporters from day one**: `--mermaid` (pasteable into a GitHub issue — this is *literally* how
   issue #1 communicates today) and `--html` (self-contained single file, committable, attachable).
7. **Steal this UX: Maltego.** Entities + Transforms + Machines + a saved `.mtgx` graph maps 1:1 onto
   clones + probes + crawl policies + a saved worldmap. Steal this *code*: **AWS graph-explorer**
   (Apache-2.0, React 19 + Cytoscape.js + jotai + localforage) — its expand/persist patterns are exactly
   what you need. Steal this *feature*: **Juggl's Workspace mode** ("save your graph and continue working on
   it later") and **Litmaps' Monitor** (background re-crawl → alerts), which is issue #5 verbatim.
8. **MVP = `git annex map`, but incremental, saved, and interactive.** That alone is a win, and it is
   achievable in weeks, not months.

---

# Part A — Prior art in incrementally-expanded, persistent knowledge maps

## A.1 The table

Columns: **Expansion model** = how the map grows. **Persistence** = what "come back to it later" means.
**Reusable?** = could con/ actually build on it.

| Tool | License | Expansion model | Persistence | Reusable for this? |
|---|---|---|---|---|
| **Maltego** (desktop) | Proprietary (free Community tier) | Right-click entity → run **Transform** → new entities appear; **Machines** chain transforms into pipelines, run in parallel/sequence | `.mtgx` saved graph file, shareable, portable across machines | ❌ code, ✅ **model**. The reference design. |
| **AWS graph-explorer** | Apache-2.0 | Search node → expand neighbours; filter by node type; also raw query | Session persistence: "restore your previous graph visualization" and it *refreshes* nodes/edges from the source. Client-side via `localforage` (IndexedDB) | ⚠️ ✅ as code to crib, ❌ as a drop-in base — see A.2 |
| **OpenCTI** | Apache-2.0 (CE) / proprietary EE | **Investigations** workspace: expand button (4-arrows) or double-click; dialog lets you pick which entity/relationship types to pull in; each node shows a badge with the count of *linked-but-not-displayed* neighbours | Investigation is a first-class saved object; convertible to a report; exportable as STIX bundle | ✅ **UX details worth copying** (esp. the hidden-neighbour badge), ❌ as a base (huge stack) |
| **Juggl** (Obsidian plugin) | GPL-3.0 | Interactive, stylable, expandable local graph on cytoscape.js; selectively browse/hide nodes, **pin** locations | **Workspace mode**: "save your graph and continue working on it later" | ✅ closest small-scale precedent for *exactly* the requested UX |
| **SpiderFoot** | MIT | Batch: 200+ modules in a publisher/subscriber mesh, each module's output feeds others automatically | SQLite backend, scans are queryable; CSV/JSON/**GEXF** export; embedded web server (`127.0.0.1:5001`) | ✅ **architecture precedent** (Python + localhost web UI + SQLite + pub/sub modules) — very close to what you want to build |
| **Recon-ng** | GPL-3.0 | Modular framework, Metasploit-style CLI; modules populate a shared datastore | **Workspaces** (the concept you want: named, resumable investigation state) | ✅ workspace concept, ❌ no graph view |
| **Aleph** (OCCRP) | MIT | Cross-referencing of entities across documents/datasets, FollowTheMoney model | Elasticsearch-backed | ❌ — **maintenance of this version ended after Dec 2025**, superseded by proprietary "Aleph Pro" |
| **Neo4j Bloom / "Explore"** | Proprietary (bundled with Neo4j Desktop/Aura) | Click-to-expand, natural-language-ish search phrases; no Cypher required | Perspectives + scenes stored server-side | ❌ licence |
| **Graphistry / PyGraphistry** | client BSD-3-Clause; **server is Hub/commercial** | GPU-rendered large graphs; upload → session | Persistent shareable URLs (`hub.graphistry.com/graph/...`), iframe-embeddable | ⚠️ nice sharing model, wrong licence for the interesting half |
| **Kùzu / Kùzu Explorer** | MIT | Embedded graph DB + Cypher + browser explorer | On-disk DB | ❌ **DO NOT USE — repo archived 2025-10-10**, Kùzu Inc. acquired by Apple; community forks (`bighorn` by Kineviz) exist but are unproven |
| **Wikidata Query Service explorer / Graph Builder** | Open (WMF) | Click a node → expand all outgoing (or toggle to incoming) properties; multiple views (graph/tree/map/table) | **State is the SPARQL query URL**, not a materialized graph; results exportable as JSON/TSV/CSV | ✅ important *design lesson* — see A.5 |
| **Connected Papers** | SaaS, closed | Seed paper → ~50k papers analysed → few dozen strongest by co-citation + bibliographic coupling; force-directed layout; click node to re-root | Account-gated; free tier capped at 5 new graphs/month | ✅ visual-encoding lessons (size = citations, colour = year), ❌ not expandable in the click-to-grow sense |
| **Litmaps** | SaaS, closed | Seed set → citation network expands; add more seeds; filter by date/citations | **Saved maps** + **Monitor**: background daily re-run of the map's search, alerts on new matching papers | ✅✅ **Monitor == issue #5.** Study this. |
| **NetBox** + `netbox-topology-views` | Apache-2.0 both | Topology derived from recorded cable connections (not click-to-expand) | Positions in a dedicated **`Coordinate` model** in the DB, with **coordinate groups** = several layouts over one dataset; exports to draw.io XML / PNG | ✅✅ **best precedent for data/view separation.** Copy this shape. |
| **Cytoscape (desktop)** | LGPL | Manual + app-driven expansion | `.cys` = a **zip session archive** bundling networks, styles and views together | ⚠️ anti-pattern for git — one opaque zip is unmergeable and unreviewable |
| **Obsidian core graph / Logseq / TheBrain / Foam / Trilium** | mixed | Graph is a *view* over a note corpus; expansion = navigation | Notes are the store; graph state usually ephemeral | ❌ wrong domain, but Juggl (above) is the exception that matters |
| **Kumu** | SaaS, closed (free tier = public projects only) | Manual/imported relationship mapping, systems maps | Cloud projects | ❌ |
| **Zenmap topology / LibreNMS / Netdisco / Observium** | mixed | Auto-discovery of an L2/L3 topology, then a rendered map | Per-tool DB | ⚠️ conceptually adjacent (discover-then-draw infrastructure), but none does click-to-expand-and-save |

### Nothing in the git world does this

A deliberate search for an existing "visualize git remotes across multiple clones and hosts" tool turns up
only commit-history visualizers (GitKraken, GitLens, Git Graph, gitk, Gource) — all of which draw the DAG
*inside one repository*. The niche of "graph of repositories and their relationships" is, as far as this
research found, occupied by exactly one tool: `git annex map`. And per its own manual page, it

> "only connects to hosts that the host it's run on can directly connect to. It does not try to tunnel
> through intermediate hosts, so it might not show all connections between the repositories in the network."

…and it renders one-shot Graphviz. **This is a genuinely empty niche.** That is both the opportunity and the
warning (no user base is waiting; make the MVP tiny).

---

## A.2 Deep dive: AWS graph-explorer — evaluate as a BASE

**Verified facts.** Apache-2.0. React 19 + React Router 8 + **Cytoscape.js 3.34** (with `d3-force`, `dagre`,
`fcose`, `klay` layout plugins) + **jotai** for state + **localforage** (IndexedDB wrapper) for storage +
TanStack Query for server state + Monaco editor + Radix UI. Three views: Graph, Data Explorer (paginated
tables by node type), Schema Explorer. Deploys as a container; also EC2/ECS/SageMaker. Connects to
**Gremlin (HTTP), SPARQL 1.1 (HTTP), or openCypher (Neptune)**. Ships session persistence that restores your
previous visualization *and re-fetches current data for every node and edge in it*.

**Verdict: use it as a one-week spike, not as the base.**

*For it:* it is the single closest running artifact to what issue #1 asks for, it is permissively licensed,
and its persistence semantics ("restore the graph, then refresh the facts") are *exactly* right for a
worldmap of things that change. Its stack is also what you'd choose anyway (Cytoscape.js is the right
renderer: MIT, headless-capable in Node, ~70 extensions including expand-collapse, and `cy.json()` gives you
trivial serialization).

*Against it:* its data access is a hard-coded set of three graph-query protocols. To use it unmodified you
would have to materialize your crawl as RDF and serve a SPARQL endpoint. That is *actually cheap* —
**Oxigraph** (Apache-2.0/MIT, Rust, RocksDB-backed, ships a standalone SPARQL 1.1 Protocol HTTP server, and
has `pyoxigraph` on PyPI) does it in an afternoon. So:

> **Spike worth doing in week 1:** `git-worldmap crawl → RDF → oxigraph serve → point graph-explorer at it`.
> You will have a clickable, expandable, session-persisting worldmap of your spacetop clones for maybe two
> days of work, and you will learn what the UX actually needs to be.

But it dead-ends, for three reasons:

1. **Expansion in graph-explorer is a query against a static database.** Your expansion must *run a probe* —
   ssh somewhere, run `git annex info --json`, take 40 seconds, possibly fail. That needs progress reporting,
   cancellation, and per-node error state. Retrofitting that into graph-explorer's query layer is a rewrite
   of its most central abstraction.
2. **Issue #6 needs write actions** ("Add any found clone as a remote"). graph-explorer is a read-only
   viewer over a database.
3. **Its node/edge styling is generic.** You need badges for bare-vs-worktree, annex-vs-plain,
   encrypted/exporttree/importtree special remotes, and red for duplicate-annex-UUID errors.

So: **crib the code, not the repo.** Specifically crib (a) the jotai + localforage persistence layer,
(b) the Cytoscape layout/plugin configuration, (c) the "Data Explorer" tabular companion view — a table of
all known clones is at least as useful as the graph and much easier to grep.

---

## A.3 Deep dive: Maltego — the model to copy

Maltego's conceptual model, verified from its docs:

- **Entity** — a typed node (`maltego.Domain`, `maltego.URL`, …) with a schema of fields.
- **Transform** — a function `Entity → [Entity]` plus edges. Every entity type has a set of applicable
  transforms. Running one is a right-click.
- **Machine** — a macro written in the *Maltego Scripting Language*: a set of pipelines
  ("a set of Transforms and filters that are executed in sequence"), which can run transforms in parallel
  and sequentially, plus triggers and feeders.
- **Graph** — the accumulated result, saved as `.mtgx`, portable and shareable.

The mapping to this project is embarrassingly direct:

| Maltego | git worldmap |
|---|---|
| Entity type `maltego.Domain` | Entity type `clone`, `host`, `forge-repo`, `special-remote`, `worktree`, `annex-uuid` |
| Transform "domain → DNS records" | Probe `clone → git remote -v` / `git annex info --json` / `git for-each-ref` |
| Transform "domain → subdomains" (expansion) | Probe `forge-repo → forks` (issue #6), `clone → subdatasets` (issue #4) |
| Transform returning nothing / erroring | Unreachable host, permission denied, dead remote |
| **Machine** ("crawl 3 hops, but only personal forks") | Crawl policy: `--depth`, host allowlist, "only forks owned by $user" |
| `.mtgx` | `worldmap/` repo |
| Graph "incremental layouting" | Don't re-layout the whole map when 3 nodes arrive — pin what the user pinned |

**Design consequences you should adopt now, before writing code:**

- Name the unit of work a **probe** (or transform) and make it a plugin with a declared
  `(applies_to_entity_type, produces_entity_types, cost, requires)` signature. Issue #1 already asks for a
  plugin system; give it a *typed* one so the UI can offer "what can I do with this node?" as a menu.
- Every probe returns **entities + edges + a status**, never mutates state directly.
- Distinguish **cheap/local** probes (run automatically on discovery) from **expensive/remote** ones
  (`ssh`, forge API, `git annex info` on a big repo) that require an explicit click. This single distinction
  is what makes the difference between "instant map" and "hangs for 4 minutes on startup".

---

## A.4 Deep dive: OpenCTI investigations, and one UI detail worth stealing

Verified: expansion in the graph view is supported specifically in the **Investigations** workspace; you
expand a node via a 4-arrows button or by double-clicking, which opens a dialog to **choose which entity
types and relationship types to pull in**. And:

> "On each node, there's a bullet with a number inside, serving as a visual indication of how many entities
> are linked to it but not currently displayed in the graph."

**Steal that badge.** It is the single best solution to the core problem of an incremental map: the user
cannot tell the difference between "this clone has no other remotes" and "I haven't looked yet". In our
domain the badge is richer and should encode three distinct states:

- **grey `?`** — never probed. (Nearly all nodes at first.)
- **blue `+7`** — probed at time T; 7 known neighbours not currently shown.
- **amber clock** — probed, but the observation is older than your staleness threshold.
- **red `!`** — last probe failed (unreachable host, auth, dead remote).

Issue #1's error taxonomy (duplicate annex UUID, dead remotes) and issue #6's "clones without new commits
should be greyed out" are both *node decorations over the same state machine*. Design the decoration
vocabulary once.

Also note OpenCTI's exit: an investigation converts to a report / STIX bundle. Analogue: a worldmap view
exports to mermaid for an issue comment.

---

## A.5 Deep dive: Connected Papers / Litmaps / Wikidata — three different answers to "what is saved?"

These three answer the *same* question three different ways, and you must pick one consciously.

**Wikidata Query Service: the saved thing is the *recipe*.** State is the SPARQL query in the URL. Sharing is
sharing a link. Expansion (click a node → expand outgoing/incoming properties) is ephemeral. Cheap, always
fresh, zero storage — but you cannot annotate, you cannot record "I checked this yesterday and it was
unreachable", and you cannot work offline.

**Connected Papers: the saved thing is a *derived snapshot*.** One seed → a deterministic algorithm over
~50k papers → a fixed graph of a few dozen. Not expandable by clicking; you re-root instead.

**Litmaps: the saved thing is a *living collection with a watcher*.** Seed set → map → **saved map** →
**Monitor** re-runs the map's search on a schedule and alerts you to new matches.

**Recommendation: be Litmaps.** The worldmap is *accumulated knowledge about a mutable world*, and issue #5
("draw alerts about updates in remotes") is a Monitor feature by another name. Concretely this means:

- The store keeps facts *with timestamps*, not a snapshot (so "typhon was 12 commits ahead as of Tuesday"
  is representable).
- A `git-worldmap refresh` command re-runs the probes that produced the current view, and a diff of
  before/after is a first-class output ("3 remotes advanced, 1 host became unreachable").
- Optional `--watch`/cron mode emits that diff to stdout/desktop notification. This is the whole of #5.

And take the *recipe* idea from Wikidata as a complement: a view file should record the *seeds and the
crawl policy*, not just the resulting node set, so a worldmap can be regenerated from scratch.

---

## A.6 Honourable mentions and explicit rejections

- **SpiderFoot** (MIT) is the closest *architectural* sibling: Python 3, embedded web server on localhost,
  SQLite backend, 200+ pub/sub modules that feed each other, YAML-configurable correlation rules with 37
  built-ins, CSV/JSON/GEXF export. Read its module interface before designing yours. Its weakness is that it
  is **batch, not interactive** — you launch a scan and wait. That weakness is precisely the gap issue #1 is
  complaining about with respect to `git annex map`. Don't repeat it.
- **Recon-ng** (GPL-3.0): steal the word **workspace**. Users understand "I'm in the `spacetop` workspace".
- **Aleph**: do not build on it. This version's maintenance officially ended after December 2025.
- **Kùzu**: do not build on it. Archived 2025-10-10 after the Kùzu Inc. → Apple acquisition. A cautionary
  tale for picking an exotic embedded graph DB over SQLite.
- **Graphistry**: BSD-3 client, commercial server. Its persistent-shareable-URL model is the right answer
  for "put this in a GitHub issue" *if* you're willing to run a server — but a self-contained HTML file is
  strictly better for con/'s culture.
- **Kumu / TheBrain / InfraNodus**: closed SaaS, manual curation. Not relevant beyond aesthetics.
- **Gephi / VOSviewer**: batch layout tools for finished datasets. Useful as *exporters* (GEXF is a fine
  interchange target, and SpiderFoot already emits it) but not as the app.

---

# Part B — Application architecture options

## B.0 The constraint that decides everything

The backend must **run local shell commands and ssh**. That kills the static-page-only option for the
*crawling* half. It does not kill it for the *viewing* half — and that asymmetry is the single most
important architectural fact here. **Crawling and viewing should be separate processes with a file between
them.** Everything below follows from that.

Secondary constraints, from the issues:
- Multi-hop discovery: the walker must be able to ssh from A to B, and from B onward if identity forwarding
  is set up, while "not visit[ing] already reached/visited host from another node" (#1).
- Long, failure-prone operations. `git annex info` on a large repo over ssh is not a 200 ms request.
- Write actions eventually (`git remote add`, #6).
- The user's world is Python (datalad, dandi, datalad-registry is Flask+Postgres+Celery).

## B.1 The options

### Option 1 — Local daemon + browser SPA (`git instaweb` / `datalad webapp` shape)

`git-worldmap serve` starts uvicorn on `127.0.0.1:<random port>`, opens a browser. SPA (Vite + Cytoscape.js)
talks to a small REST API plus **SSE** for progress.

- **ssh auth:** do nothing clever. Inherit the user's environment; rely on `ssh-agent`, `~/.ssh/config`,
  `ControlMaster`/`ControlPersist` for connection reuse, and `ProxyJump` for multi-hop. Never prompt for or
  store passwords. If a host needs interaction, mark the node `needs-auth` and tell the user to fix their
  ssh config. Refusing to be an ssh client library is a *feature*.
- **Remote probes:** ship the remote-side collector as a **single POSIX `sh` script** piped over ssh
  (`ssh host 'sh -s' < probe.sh`) so you don't require Python (or a matching Python) on every host. Output
  one JSON object per line on stdout. This is what makes multi-hop crawling actually work on HPC clusters
  like discovery.dartmouth.edu.
- **Long crawls:** the API returns a `run_id` immediately; `GET /runs/{id}/events` is an SSE stream of
  `{entity_discovered, probe_started, probe_finished, error, done}`. SSE, not WebSocket: unidirectional,
  survives proxies, trivially reconnectable, and `curl`-able for debugging. Commands go over plain POST.
- **Multi-user:** **none.** Bind to loopback, generate a token in the URL. If someone wants shared access,
  they run the same daemon behind their own auth — a con/serve-shaped problem, not this project's.

### Option 2 — Desktop shell (Tauri / Electron / Wails / pywebview / Neutralino)

- **Tauri** (MIT/Apache-2.0, Rust backend, system webview: WKWebView / WebView2 / WebKitGTK, v2 adds
  iOS/Android). Small binaries. **But the backend is Rust.** Every collector, every datalad integration,
  every schema change would live in a language the target community does not use. You'd end up shelling out
  to Python anyway, at which point you've built option 1 with extra steps.
- **Electron:** ~100 MB+ per app, bundles Chromium, and buys nothing over a browser tab here.
- **pywebview** (BSD-3-Clause): the *only* desktop-shell option that fits. Native webview (WinForms / Cocoa /
  QT-or-GTK / Android), built-in HTTP server, two-way JS↔Python, "does not bundle a heavy GUI toolkit or web
  renderer with it keeping the executable size small", and supports freezing into distributables. **If** a
  double-clickable app is ever demanded, wrap the option-1 daemon in pywebview — it's ~30 lines and does not
  change the architecture.

### Option 3 — Jupyter widget / anywidget

`ipysigma` (MIT, sigma.js + graphology, WebGL, `to_html()` / `Sigma.write_html()` for **standalone HTML**,
takes networkx or igraph directly), `ipycytoscape` (BSD-3, cytoscape.js), `yfiles-jupyter-graphs`
(proprietary core `[UNVERIFIED]`), `anywidget` (MIT, ESM-in-Python, works in Jupyter/Lab/Colab/VSCode/marimo,
state via traitlets `.tag(sync=True)`).

**Is a notebook widget a legitimate answer?** As the *primary* answer, no — the worldmap is a long-lived
artifact you return to, and a notebook is a session. Kernel death loses your expansion state unless you
serialize it out, and interactive ssh crawls block the kernel. As a *secondary renderer over the same data
file*, absolutely yes, and it is nearly free: if the store is a documented JSONL/SQLite file, then
`worldmap.to_networkx()` + `ipysigma.Sigma(g)` is a 10-line function that gives the datalad/dandi notebook
crowd a real deliverable. Build it in v1, not MVP.

Also note **marimo** (Apache-2.0): reactive notebooks stored as pure `.py`, git-friendly, runnable as an app
(`marimo run`), and able to run in the browser via WASM. If you want a notebook-shaped *and* shareable
artifact, marimo beats Jupyter on both counts.

### Option 4 — TUI (Textual / ratatui)

Textual (MIT) is excellent and even has `textual serve` to run the same app in a browser. But it has no
graph/canvas widget — a force-directed layout in a terminal is a bad idea, and the ASCII-art versions are
unreadable past ~20 nodes.

**Opinion: yes to terminal output, no to a TUI graph.** What the terminal actually needs is:

```
git-worldmap ls                  # table: clone, host, uuid, annex?, bare?, last-seen, status
git-worldmap tree                # subdataset / remote tree, indented (this is #4's 80% case)
git-worldmap show <uuid>         # everything known about one clone, with provenance
git-worldmap diff                # what changed since last crawl  (#5)
git-worldmap doctor              # just the errors: duplicate UUIDs, dead remotes, unreachable hosts
```

These are cheap, scriptable, and cover most day-to-day use. A `--tui` browsing mode over the *table* views
(Textual's `DataTable` + `Tree` are strong) is a reasonable v2 nicety. A `--tui` *graph* is not.

### Option 5 — Static self-contained HTML export

Crawl offline → emit one HTML file, interactive, committable, attachable to an issue.

Verified libraries that produce a single self-contained interactive HTML file:
- **pyvis** (BSD-3-Clause) — wraps vis.js/vis-network; `net.show("map.html")` writes a standalone file.
  Easiest path; styling control is mediocre.
- **ipysigma** (MIT) — `Sigma.write_html(...)`, WebGL/sigma.js. Fast for large graphs; note the caveat that
  many simultaneous WebGL canvases can exhaust GPU memory.
- **gravis** (Apache-2.0) — "Interactive graph visualizations with Python and HTML/CSS/JS", accepts
  networkx. Standalone-export claim `[UNVERIFIED — docs site unreachable from this environment]`.
- **Hand-rolled Cytoscape.js** — one HTML file with the library inlined and `elements` as a JSON blob.
  ~250 KB, total styling control, and it's the *same* renderer as the live app, so styles are written once.
  **This is the right answer.**
- **mermaid** — not a file but a fenced code block; GitHub renders it natively in issues. This is the actual
  currency of the con/ community, as issue #1 itself demonstrates.

### Option 6 — Hybrid: CLI walker → portable data file → several viewers

Issue #1 already proposes `walker` / `collectors` / `renderer`. **That separation is correct**, with one
amendment.

*For:* the file is a contract; it makes the CLI usable in cron and CI; it makes the notebook widget, the
static export, the mermaid dump, and the SPA all peers rather than forks; it lets datalad-registry produce
worldmaps server-side without ever running a browser; and it makes the whole thing testable without a UI.

*Against, and the amendment:* a **strict** one-way `walker → file → renderer` pipeline forbids the central
UX of issue #1 — *click a node to expand it*, which requires the renderer to invoke the walker. Do not build
a pipeline; build a **hub**:

```
              ┌─────────────┐
   probes ───▶│    store    │◀─── mermaid / html / gexf / dot exporters
  (walker)    │  (the file) │
      ▲       └─────────────┘
      │              ▲
      └──── daemon ──┘   ◀── SPA, notebook widget, CLI
        (schedules probes, streams progress)
```

The store is the only shared thing. The daemon is a thin scheduler that both reads the store and enqueues
probes into it. `renderer` in issue #1's sense becomes *exporters* — pure functions of the store — while the
interactive viewer is a client of the daemon.

## B.2 Scored comparison

Weights reflect this project's stated goals (1–5; higher is better; weighted total out of 100).

| Criterion (weight) | 1. Daemon+SPA | 2a. Tauri | 2b. pywebview | 3. Notebook | 4. TUI | 5. Static HTML | 6. Hybrid hub |
|---|---|---|---|---|---|---|---|
| Can crawl (shell/ssh) (5) | 5 | 5 | 5 | 4 | 5 | 1 | 5 |
| Interactive expand-and-grow (5) | 5 | 5 | 5 | 3 | 1 | 2 | 5 |
| Persist & resume a worldmap (5) | 5 | 5 | 5 | 2 | 4 | 1 | 5 |
| Python-ecosystem fit (4) | 5 | 1 | 5 | 5 | 5 | 5 | 5 |
| Implementation effort (inverse) (4) | 3 | 1 | 3 | 4 | 3 | 5 | 3 |
| Shareability (issue/gist/repo) (4) | 2 | 2 | 2 | 3 | 2 | 5 | 5 |
| Install friction for a user (3) | 4 | 3 | 3 | 4 | 5 | 5 | 4 |
| Works over ssh on a headless box (3) | 4 | 1 | 1 | 3 | 5 | 5 | 5 |
| Long-term maintenance burden (3) | 3 | 2 | 3 | 3 | 4 | 5 | 4 |
| Write actions (#6) (2) | 5 | 5 | 5 | 4 | 5 | 1 | 5 |
| **Weighted total /100** | **~81** | **~62** | **~74** | **~68** | **~72** | **~62** | **~88** |

## B.3 Recommendation

**Option 6 (hybrid hub), realized as Option 1 (local daemon + SPA) plus Option 5 (static export), with
Option 3 (notebook widget) as a cheap bonus and Option 4 reduced to good CLI subcommands.**

Concretely:

- **Language:** Python 3.11+. FastAPI + uvicorn. `click`/`typer` CLI. Remote probes as POSIX `sh` piped over
  ssh. Reuse `giturlparse` (Apache-2.0, handles GitHub/GitLab/Bitbucket/Assembla and rewriting between
  ssh/https/git forms) for issue #1's URL-harmonization requirement.
- **Frontend:** Vite + TypeScript + **Cytoscape.js** (MIT), with `fcose` for layout and `expand-collapse` for
  host/forge grouping. No React necessary at MVP; add it if the panel UI grows. Cribbing graph-explorer's
  jotai+localforage patterns is fine either way.
- **Transport:** REST + SSE. No WebSocket until bidirectional streaming is actually needed.
- **Security:** loopback bind + per-run token in the URL. Explicit host allowlist in config before the
  crawler is allowed to ssh anywhere; `--depth` limit; a persisted visited-set keyed by
  `(host, canonical path)` so the crawl terminates (issue #1 asks for exactly this).
- **Not** Electron. **Not** Tauri. **Not** a graph TUI.

---

# Part C — Persistence of the worldmap

## C.1 What kind of thing is being stored

Not a graph. **A set of timestamped observations, from which a graph is derived.** This distinction is the
whole design:

- "typhon has a remote named `rolando-exchange` pointing at annex UUID 40795e62…" is a *fact observed at a
  time by an agent from a vantage point*.
- Facts go stale, contradict each other (a remote gets renamed), and fail to be gathered (host down).
- Two people crawling from different laptops legitimately observe *different* worlds — issue #1's whole
  premise is that remote names differ per clone.

An event-sourced, append-only log is therefore not a design flourish; it is the natural shape of the data.
It also makes issue #5 ("how far ahead is this remote") and issue #6 ("grey out clones with no new commits")
fall out for free, because both are *time-indexed edge attributes*.

## C.2 Store: recommendation

**Primary: append-only JSONL files in a git repository. Derived: SQLite (gitignored). Rejected: everything else.**

| Candidate | Verdict |
|---|---|
| **JSONL append-only log** | ✅ **primary store.** Diffable, greppable, mergeable-by-construction, streamable, trivially produced by shell probes over ssh, schema-evolvable. |
| **SQLite** | ✅ **derived index**, rebuildable from the log in seconds. Gives you `ls`/`doctor`/`diff` queries and the API's read path. Never the source of truth (binary → unmergeable). Also the precedent: SpiderFoot and Recon-ng both use it. |
| YAML per entity | ⚠️ optional *derived*, human-reviewable materialization (`entities/clone/<uuid>.yaml`). Nice for `git log -p` on a single clone. Generated, never edited. |
| DuckDB | ❌ analytics engine; same binary-blob problem as SQLite with less ubiquity. |
| **kuzu** | ❌ **archived October 2025.** Do not. |
| RDF Turtle / JSON-LD / named graphs | ⚠️ **as an export, yes; as the store, no.** But *do* design the JSON so a `@context` can be dropped on top later — that is what makes it interoperable with `concepts.datalad.org` and metalad `[concepts.datalad.org unreachable from this environment — UNVERIFIED]`, and what feeds the graph-explorer/Oxigraph spike from B/A.2. |
| GraphML / GEXF | ⚠️ export only. XML, no provenance model, no partial observations. |
| A git repo as the container | ✅✅ **yes** — see below. |
| A datalad dataset | ✅ optional superset: use it when the worldmap accumulates large artifacts (rendered SVGs, raw `git annex info` dumps, screenshots). For a text-only worldmap plain git is enough. |

**Why a git repo is the right container**, beyond being on-brand: it gives you history of the worldmap for
free (which is *itself* the staleness/diff feature of issue #5), it gives you merging, review, blame,
branches per-investigation, and hosting/sharing (push it, or attach it to an issue). And the artifact is
self-describing to this community.

## C.3 Merge-ability: reject CRDTs, use naming

The brief asks whether to use Automerge / Yjs / **Loro**. Verified: Loro (MIT, Rust, JS-wasm + Swift
bindings, movable-tree and movable-list CRDTs, time travel, "Shallow Snapshot that Works like Git Shallow
Clone") and Automerge (MIT, Rust + wasm + C bindings, compressed format + sync protocol, Automerge 3 cut
memory ~10×) are both excellent — for **concurrent mutation of a shared document**.

**We do not have that problem.** The observation log is append-only, and a set of immutable observations is a
join-semilattice under union: merging *is* union, and union is exactly what git does when two branches add
different files. So:

> **One file per crawl run: `observations/<ISO8601>--<agent>--<run-ulid>.jsonl`.**
> Two people crawl different parts of the world → two new files → `git merge` succeeds with zero conflicts,
> and `git log` tells you who learned what, when.

This buys the entire benefit of a CRDT with none of the dependency, none of the binary format, and full
human reviewability. It also means a crawl on a headless HPC node can be `scp`'d back and just dropped in.

**Where CRDTs would earn their keep:** live multi-user co-editing of a *view* (two people dragging nodes on
the same map simultaneously, Figma-style). That is a v3 feature at best. If it ever happens, use **Loro** —
its movable-tree CRDT is the right primitive for hierarchical view state, and its shallow snapshots keep
files small. Do not adopt it pre-emptively.

**"Just re-crawl" is not an alternative**, because re-crawling requires reachability. The Dartmouth HPC node
may only be reachable from one person's laptop. Federating *observations* is the point.

## C.4 Staleness & provenance

**Model: event-sourced append-only log, bitemporal-lite.** Every observation record carries:

- `t_observed` — when the probe ran.
- `t_valid` — when the *fact* was true, where it differs (e.g. a commit timestamp, a `git-annex` branch
  timestamp). Usually equals `t_observed`; keep the field anyway, retrofitting bitemporality is miserable.
- `by` — tool + version, agent identity, and the **probe** that produced it.
- `via` — vantage point: which host, which working directory, which remote name it was reached through.
  This matters enormously here: "reachable *from lena* as `ssh://typhon/...`" is a different fact from
  "reachable from smaug".
- `status` — `ok | partial | error`, with an error class. **Failed probes are observations too**, and must
  be stored; that's how the red `!` badge and issue #1's warning taxonomy get populated.

Current state = a fold over the log: per `(subject, predicate)`, last-observation-wins, but retain the
history and expose `git-worldmap show --history`. Conflicts that *matter* — most importantly issue #1's
"multiple instances with the same annex uuid" — are detected during the fold and surfaced as first-class
**findings**, not silently resolved.

Alternatives considered: RDF **named graphs** + **PROV-O** (`prov:wasGeneratedBy`, `prov:wasAttributedTo`,
`prov:generatedAtTime`) is the academically correct answer and is the natural export target
`[W3C spec page unreachable from this environment — UNVERIFIED]`; it is overkill as the working format but
should be a supported *export* precisely because this project sits next to `concepts.datalad.org`.
Full bitemporal SQL modelling is heavier than needed. Neither changes the on-disk recommendation.

## C.5 Separating data from view — two files, definitively

Evidence from the field:

- **Cytoscape** `.cys` is a **zip session archive** bundling networks + styles + views. One opaque binary
  per session: unmergeable, unreviewable, un-diffable. **Anti-pattern for a git-native tool.**
- **`netbox-topology-views`** stores coordinates in a dedicated `Coordinate` model, with **coordinate
  groups** enabling *several layouts over the same topology*, positions auto-saved on drag.
  **This is the pattern.** Copy it.
- **Gephi/GEXF** can carry `viz:position` inline — convenient, but it welds layout to data. `[UNVERIFIED]`
- **draw.io** is the opposite extreme: the file *is* the view, there is no separable data model.

So: **`observations/` (data, append-only, merge-by-union) and `views/*.view.yaml` (view, mutable, one per
saved perspective, small enough to hand-merge)**. A view names its seeds and crawl policy, the expanded node
set, pins/positions, filters, and highlight rules. Multiple views over one dataset is a *feature*: "the
spacetop map for Heejung" and "everything I own on discovery" are different views over the same facts.

## C.6 Proposed on-disk layout

```
my-worldmap/                          # a git repo; optionally a DataLad dataset
├── worldmap.yaml                     # config: seeds, host allowlist, depth, probe settings,
│                                     #   forge tokens *by env-var name only* (never values)
├── observations/                     # THE SOURCE OF TRUTH — append-only, never edited
│   ├── 2026-08-21T14-03-11Z--yoh@lena--01J8XK2M.jsonl
│   ├── 2026-08-22T09-15-02Z--yoh@typhon--01J8ZP4Q.jsonl
│   └── 2026-08-25T11-40-58Z--heejung@mbp--01J93R7T.jsonl
├── entities/                         # DERIVED, committed, human-reviewable (regenerable)
│   ├── clone/97b6f5e4-4642-43a7-988a-c483caf553c5.yaml
│   ├── host/typhon.dartmouth.edu.yaml
│   └── forge/github.com/spatialtopology/ds005256.yaml
├── views/
│   ├── default.view.yaml
│   └── spacetop-for-heejung.view.yaml
├── findings.yaml                     # DERIVED: duplicate annex UUIDs, dead remotes, unreachable hosts
├── exports/
│   ├── spacetop.mmd                  # paste into a GitHub issue
│   ├── spacetop.dot
│   └── spacetop.html                 # self-contained, interactive, committable
├── .gitignore                        # ignores .worldmap/
└── .worldmap/
    ├── cache.sqlite                  # derived index, rebuilt by `git-worldmap reindex`
    └── runs/                         # raw probe stdout/stderr for debugging
```

An observation record (one JSON object per line):

```json
{
  "obs": "01J8XK2M9YQ3W7B4",
  "t_observed": "2026-08-21T14:03:11Z",
  "t_valid": "2026-08-21T14:03:11Z",
  "by": {"tool": "git-worldmap/0.3.0", "agent": "yoh@lena", "probe": "annex-info@1"},
  "via": {"host": "typhon.dartmouth.edu", "path": "/mnt/DATA/data/yoh/1076_spacetop",
          "reached_as": "ssh://typhon.dartmouth.edu/mnt/DATA/data/yoh/1076_spacetop"},
  "subject": "annex:97b6f5e4-4642-43a7-988a-c483caf553c5",
  "status": "ok",
  "facts": {
    "kind": "worktree", "bare": false, "annex": true, "annex_version": "10",
    "git_annex_version": "10.20250721", "description": "yoh@typhon:/mnt/DATA/data/yoh/1076_spacetop",
    "datalad_id": "ba2d3c6e-...", "rad_id": null
  },
  "edges": [
    {"pred": "git-remote", "object": "annex:590b4fd0-0142-4e9d-8964-d1158c242c6a",
     "attrs": {"remote_name": "origin", "url": "ssh://bids@rolando/inbox/.../1076_spacetop",
               "ahead": 12, "behind": 0, "branches_ahead": ["git-annex"]}},
    {"pred": "special-remote", "object": "annex:e5f1e780-543c-421e-ad0b-7a270c1ad09b",
     "attrs": {"remote_name": "s3-PUBLIC", "type": "S3", "encryption": "none", "exporttree": true}}
  ]
}
```

Note that issue #5's "aheadness" is an **edge attribute with a timestamp** — which is exactly why the
observation log, not a snapshot graph, is the right store.

A view file:

```yaml
# views/spacetop-for-heejung.view.yaml
name: spacetop, for Heejung
seeds: ["annex:b14a3911-d089-44da-8327-6d2cbbd05871"]
policy: {depth: 3, follow: [git-remote, special-remote], hosts: [typhon.*, rolando.*, github.com]}
expanded: ["annex:b14a3911-...", "annex:97b6f5e4-...", "host:rolando.cns.dartmouth.edu"]
collapsed_groups: [host:github.com]
pins:
  "annex:b14a3911-...": {x: 0,   y: 0}
  "annex:97b6f5e4-...": {x: 340, y: -120}
layout: fcose
show: {annex_uuid: false, remote_names: true, aheadness: true}
stale_after: 7d
```

## C.7 Sharing a worldmap

| Channel | Verdict |
|---|---|
| **Mermaid block in a GitHub issue** | ✅ **the default.** GitHub renders it natively; issue #1 is already doing this by hand. `git-worldmap export --mermaid --view X` is the highest-value single feature in the project. |
| **Self-contained HTML** | ✅ commit to the repo, publish on gh-pages, attach to an issue. Interactive, no server. |
| **The worldmap git repo itself** | ✅ for teams and for anything that needs to be *updated* rather than *shown*. |
| **A DataLad dataset** | ✅ when large artifacts accumulate; also the dogfooding story. |
| **A gist** | ⚠️ fine for a one-off export; no merge story. |
| **A small server** | ⚠️ later. `git-worldmap serve --read-only --bind 0.0.0.0` for a lab; datalad-registry (Flask + Postgres + Celery, MIT) is the natural host if this ever becomes a service. |

---

# Part D — Naming and scope

## D.1 Names, in the con/ house style

Ranked, with blunt notes:

1. **`con/verge`** — clones that converge and diverge; "verge" also reads as edge/boundary. Short, memorable,
   pronounceable, and it says what the tool is *about* (relatedness of clones) rather than what it draws.
   Risk: `git-converge` would sound like a merge tool, so name the CLI differently (below). **Top pick.**
2. **`con/stellation`** — a map of stars and the groupings between them. Best fit for the literal "worldmap"
   framing; visually evocative; the con/ split (`con/stellation`) is clean. Slightly long.
3. **`con/spectus`** — Latin *conspectus*, "a comprehensive survey / general view". Matches the register of
   `con/ceptualization` exactly, and is precisely what the tool produces. Obscure, which is either charming
   or annoying.
4. **`con/gregation`** — a gathering of clones. Cute, slightly churchy.
5. **`con/tour`** — map contours + "a tour of your clones". Nice pun, but `contour` is heavily overloaded.
6. **`con/nections`** — too plain; the split is awkward.

**CLI name** (separate decision — pick something greppable and unambiguous):
`git-worldmap` (works as `git worldmap` subcommand for free, and the phrase is already the user's own),
with short alias `gwm`. Alternative: `gwalk`.

**Recommendation:** project **`con/verge`**, CLI `git-worldmap` / `gwm`, Python package `converge` or
`gitworldmap`.

## D.2 Scope: one project or three?

**One project. One repo. Three *packages* behind one CLI.**

The temptation to split into `walker` / `model+store` / `viewer` repos is real — issue #1 itself frames it
that way — and it is wrong *for now*:

- **The schema is the product**, and it will churn hard for the first six months. Three repos means three
  release cycles and version-skew bugs, on a project that likely has one or two contributors.
- The interesting UX (click-to-expand) requires viewer→walker calls. Two repos would immediately need a
  stable RPC contract before anyone knows what it should be.
- Splitting is cheap *later* (a `pyproject` workspace, then separate repos) and expensive to undo.

**But do enforce the boundaries inside the repo from day one:** `converge.model` must not import
`converge.walker`; exporters must be pure functions of the store; the daemon must be a thin layer over the
same API the CLI uses. If a second consumer appears (datalad-registry generating worldmaps server-side),
`converge.model` + `converge.walker` split out painlessly.

**What is genuinely a separate project:** a *hosted* worldmap service. Don't. That's a con/serve-shaped
thing, and it isn't what any of #1/#4/#5/#6 asks for.

## D.3 MVP definition

> **MVP = `git annex map`, but incremental, persistent, and clickable.**

That framing is deliberately unambitious and it is the right bar: it is a feature the user already uses, whose
limitations (one-shot, no persistence, no tunneling, no non-annex repos, no errors surfaced) are concretely
known.

**In scope for MVP:**

- `git-worldmap crawl <path|url> ...` — walk local repos + directly-reachable ssh remotes. Entities:
  `clone` (worktree/bare), `host`, `forge-repo`, `special-remote`. Edges: `git-remote` (with the per-clone
  **remote name** — the thing issue #1 says is the whole point), `special-remote`.
- URL canonicalization via `giturlparse`, so `https://`, `ssh://`, `git@…` and `.git`-suffixed forms of the
  same repo collapse to one node.
- Identity: `annex.uuid` where present; canonical URL otherwise; `(host, realpath)` for local non-annex.
- Provenance on every fact; failed probes recorded as observations.
- **Findings**: duplicate `annex.uuid` across differing clones (issue #1's headline error), dead remotes,
  unreachable hosts, bare-vs-worktree.
- Store: the layout in C.6. `crawl` is resumable and idempotent-by-append.
- `git-worldmap ls|show|doctor` in the terminal.
- `git-worldmap export --mermaid` and `--html` (self-contained Cytoscape.js).
- `git-worldmap serve`: pan/zoom, group-by-host (expand/collapse), badges for annex/bare/special-remote,
  red for findings, a saved default view. **Read-only expansion of already-crawled data is enough for MVP.**

**Explicitly out of MVP:** clicking a node to trigger a *live* remote probe; forge fork discovery; aheadness
metrics; subdatasets; write actions; multi-hop tunneling; anything multi-user.

**Definition of done:** yarikoptic runs it on the spacetop constellation, gets a map at least as complete as
the `git annex map` output pasted into issue #1, saves it, comes back a week later, re-crawls, and sees what
changed — and can paste a mermaid version into a GitHub issue.

## D.4 Phased roadmap, mapped onto the issues

### MVP (v0.1) — "`git annex map`, saved" → **issue #1, core**
As above. Ship the store format documented (JSON Schema) before anything else; everything downstream is
cheap once the file is right. Week-1 side-quest: the **Oxigraph + graph-explorer spike** (A.2) to
de-risk the UX before committing to a bespoke frontend.

### v0.2 — "interactive" → **issue #1, the actual ask**
- Click a node → menu of applicable probes (the Maltego move) → daemon runs it → SSE progress →
  graph grows in place, no full re-layout, pins preserved.
- OpenCTI-style neighbour badge: `?` unprobed / `+N` known-not-shown / clock stale / `!` failed.
- Named views, saved and switchable; positions persisted (NetBox coordinate-groups model).
- ssh multi-hop via `ProxyJump`, host allowlist, visited-set, `--depth`.
- Notebook renderer via ipysigma/ipycytoscape over the same store — ~a day's work, real community value.

### v1.0 — "subdatasets" → **issue #4**
- `subdataset` edges; containment as a *different* edge type from `git-remote`, rendered as nesting
  (Cytoscape compound nodes) rather than arrows.
- Filtering/perspective controls (the gap datalad/datalad#7820 is poking at): depth limits, "only
  subdatasets with local content", "only those diverging from their registered commit".
- `git-worldmap tree` in the terminal covers the 80% case.

### v1.1 — "aheadness & alerts" → **issue #5**
- Per-edge `ahead`/`behind` counts (total commits and per-branch), recorded as timestamped edge attributes.
- **Worktrees as nodes** (a worktree is "a local shared clone with its branches"), with unmerged branches
  shown.
- `git-worldmap diff` and `--watch`: re-run the probes behind a view on a schedule; emit a change summary.
  This is Litmaps' Monitor, and it is the feature that turns a picture into a dashboard.
- RIA-store-aware rendering (BABS/mechababs: per-subject branches accumulating in a RIA remote until merged)
  — the archetypal "how far ahead is this remote" case.

### v2.0 — "discover and adopt" → **issue #6**
- Forge plugins: GitHub Insights→Network / forks API, GitLab, and **datalad-registry lookup by dataset UUID**.
- "Pre-view" a discovered clone without adding it: fetch refs, compute ahead/behind, **grey out clones with
  no commits past the current state** (issue #6's explicit ask).
- **Write action**: "Add as remote" — `git remote add` from the UI. First mutating operation; gate it behind
  a confirmation and record it as an observation with `by.agent = user`.
- DAG-of-advances view: for a chosen set of clones, the commit DAG of what each has that others don't.

### Deferred / maybe never
- Sensed edge attributes from issue #1 (ping distance, bandwidth, shared/unique annexed content size).
  Genuinely useful for balancing, but each is a separate expensive probe; make them opt-in plugins, not core.
- Live multi-user co-editing of views (this is where **Loro** would come in).
- A hosted service.
- A graph TUI.

---

## Appendix: the five decisions worth arguing about

1. **Append-only observation log rather than a mutable graph store.** Costs a fold on every read (mitigated
   by the SQLite index); buys provenance, staleness, merge-by-union, and issues #5/#6 nearly for free.
2. **No CRDT.** File-per-run naming solves federation. Revisit only for live co-editing of views.
3. **No desktop shell.** localhost + browser. pywebview is the escape hatch if packaging demands it.
4. **Cytoscape.js everywhere** — same renderer in the live app and the static export, so styling is authored
   once. (Same choice AWS graph-explorer and Juggl made independently.)
5. **Mermaid export is a first-class feature, not an afterthought.** It is how this community actually
   communicates, and it is the cheapest possible path from "I built a crawler" to "someone else understood
   my repo layout".

### Sources

Maltego docs (Transforms, Machines, `.mtgx`) · [aws/graph-explorer](https://github.com/aws/graph-explorer)
· [OpenCTI](https://github.com/OpenCTI-Platform/opencti) + pivoting/investigation docs
· [Juggl](https://github.com/HEmile/juggl) · [SpiderFoot](https://github.com/smicallef/spiderfoot)
· [recon-ng](https://github.com/lanmaster53/recon-ng) · [alephdata/aleph](https://github.com/alephdata/aleph)
· [kuzudb/kuzu](https://github.com/kuzudb/kuzu) (archived) ·
[The Register on Kuzu](https://www.theregister.com/software/2025/10/14/kuzudb-graph-database-abandoned-community-mulls-options/1142229)
· [NetBox](https://github.com/netbox-community/netbox) +
[netbox-topology-views](https://github.com/netbox-community/netbox-topology-views)
· [cytoscape.js](https://github.com/cytoscape/cytoscape.js) ·
[ipycytoscape](https://github.com/cytoscape/ipycytoscape) · [ipysigma](https://github.com/medialab/ipysigma)
· [pyvis](https://github.com/WestHealth/pyvis) · [gravis](https://github.com/robert-haas/gravis)
· [anywidget](https://github.com/manzt/anywidget) · [marimo](https://github.com/marimo-team/marimo)
· [Tauri](https://github.com/tauri-apps/tauri) · [pywebview](https://github.com/r0x0r/pywebview)
· [Textual](https://github.com/Textualize/textual) · [Oxigraph](https://github.com/oxigraph/oxigraph)
· [Loro](https://github.com/loro-dev/loro) · [Automerge](https://github.com/automerge/automerge)
· [PyGraphistry](https://github.com/graphistry/pygraphistry) ·
[giturlparse](https://github.com/nephila/giturlparse) ·
[datalad-webapp](https://github.com/datalad/datalad-webapp) ·
[datalad-registry](https://github.com/datalad/datalad-registry) ·
[git-annex-map manual](https://git-annex.branchable.com/git-annex-map/) ·
Litmaps Monitor docs · Connected Papers announcement · Wikidata Query Service help.
