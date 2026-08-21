# Git-native visualization & navigation tools — landscape survey

Scope: existing open-source tools that draw and/or navigate graphs of git repositories, clones,
branches, commits, remotes and their relationships. Assessed against the con/ceptualization
"worldmap of git and git-annex" goal (issues #1, #4, #5, #6): an interactive, incrementally
expandable, persistable graph whose **nodes are clones/repos/hosts/special-remotes** and whose
**edges are remote relationships**.

Verification policy used here: every project listed under a name + URL was fetched (GitHub repo
page or homepage) unless explicitly marked `[UNVERIFIED]`. Star counts are as reported on the
fetched page (Aug 2026) and are approximate. Where a repo page did not surface a last-commit date,
this is stated as "not shown" rather than guessed.

---

## TL;DR — top 5 most relevant

| # | Project | Verdict | Why |
|---|---------|---------|-----|
| 1 | **`git annex map`** (git-annex builtin, GPL-3) | **BASE (data model), REJECT (UI)** | The only existing tool whose node type is *a clone* and whose edge type is *a git remote*. It already SSH-spiders to reachable hosts, colours by trust (trusted/untrusted/dead), groups repos into host boxes, and emits Graphviz. Static dot dump, no interactivity, no incremental expansion, no persisted view. Its **collector semantics** are the thing to reimplement/extend; its renderer is not. |
| 2 | **Argo Lite** — poloclub/argo-graph-lite (MIT, JS/WebGL, ~130★) | **BASE / strong IDEA** | The closest existing match to the *UX* requirement: in-browser graph explorer with explicit **"incremental exploration — start from a few nodes and progressively add neighbours"**, plus **shareable immutable snapshot URLs** that a viewer can keep exploring from, plus iframe embedding. Graph-generic, not git-aware — you supply nodes/edges. This is the "persist the view and come back to keep expanding" property nothing git-native has. |
| 3 | **ungit** — FredrikNoren/ungit (MIT, Node.js, ~10.6k★) | **BASE (shell), IDEA (UX)** | Proven pattern of "run a local Node server against a repo on the machine that has the repo, drive it from a browser". Actively maintained, plugin architecture, MIT. But its graph is the *commit* DAG of *one* repo; remotes are a sidebar, not nodes. Would need the whole graph model replaced. |
| 4 | **Sapling ISL** (Interactive Smartlog) — facebook/sapling (GPL-2 core, **MIT for ISL**, ~7k★) | **IDEA** | Best-in-class demonstration of a locally-served web UI over a VCS with live state, drag-and-drop mutation, and a VS Code-embedded variant. Git-compatible. Again single-repo, commit-level. Borrow the architecture (local daemon + web client + optional editor host), not the code. |
| 5 | **Gephi Lite / Retina / graph-explorer** (GPL-3 / GPL-3 / Apache-2) | **IDEA (renderer tier)** | Serverless, browser-side, sigma.js/WebGL graph apps with filtering, styling and shareable state. Proof that the rendering + interaction tier is a solved, forkable problem; the novel work is entirely in the git/git-annex *collector* and the *incremental expand* action. |

**One-line summary of the whole survey:** essentially the entire git-visualization ecosystem draws
the **commit DAG of a single repository**. The number of tools whose *nodes are repositories and
whose edges are remotes* is approximately **one** (`git annex map`), and it is a static Graphviz
dump. Nothing in the open-source world does incremental click-to-expand navigation over a
repo-level graph with persisted state.

---

## 1. Commit-DAG visualizers (single repo)

This is the largest and least relevant category. Included for completeness and because a couple of
them are useful *component* references (graph layout algorithms, ahead/behind rendering).

An excellent pre-existing catalog of this whole category is
**indigane/git-graph-drawing** (https://github.com/indigane/git-graph-drawing) — "a collection of
git graph drawing implementations", listing gitk, tig, gitg, giggle, qgit, git-cola, GitUp,
GitAhead, Gittyup, Guitar, Gitnuro, Kommit, GitExtensions, TortoiseGit, SourceGit, IntelliJ's
VCS-log, mhutchie/vscode-git-graph, mlange-42/git-graph, lusingander/serie, plus the simulation
family (gitgraph.js, GitGraph4J, visualizing-git, learnGitBranching, Sapling's renderdag).
Verdict for the catalog itself: **IDEA** — use it as the shortlist for stealing layout algorithms.

| Name | URL | Lang | License | Activity / ★ | What it does | Verdict |
|---|---|---|---|---|---|---|
| git-graph (was mlange-42, now git-bahn org) | https://github.com/git-bahn/git-graph | Rust | MIT | ~963★, repo live 2026 | CLI that renders the commit graph arranged per branching model (GitFlow etc.); terminal output, custom formats, ASCII mode. No dot/SVG export found. | REJECT — single-repo, commit-level, terminal-only |
| git-igitt | https://github.com/mlange-42/git-igitt (redirects to git-bahn) | Rust | MIT | live | Interactive TUI built on git-graph: browse history, diffs, file versions. | REJECT — TUI, single repo |
| serie | https://github.com/lusingander/serie | Rust | MIT | ~2.0k★ | Rich commit graph in the terminal using terminal *image* protocols (kitty/iTerm2). Explicitly "not a full git client". | REJECT — display tech is a dead end for a browser app |
| Git Graph (VS Code) | https://github.com/mhutchie/vscode-git-graph | TypeScript | **Modified MIT — redistribution of derivative works NOT permitted** | ~2.5k★, ~448 forks | Interactive commit graph inside VS Code, actions from the graph, remote HEAD refs. | **REJECT — license is a hard blocker.** You may read it, you may not ship a fork. Worth flagging loudly. |
| GitLens | https://github.com/gitkraken/vscode-gitlens | TypeScript | Dual: MIT + `plus/` proprietary | ~9.9k★ | Commit Graph shows ahead/behind, unpushed/unpulled, change size, uncommitted work **across worktrees**. Commit Graph on private repos requires a paid GitKraken account. | REJECT — partially proprietary and account-gated |
| git-sim | https://github.com/initialcommit-com/git-sim | Python (manim) | GPL-2.0 (per project) `[license not directly verified]` | active | Renders a *hypothetical* git command's effect as PNG/MP4 via manim. | IDEA only — the "pre-view what would happen if I did X" framing maps nicely onto issue #6's "pre-view a discovered clone before adding it" |
| git-branchless | https://github.com/arxanas/git-branchless | Rust | GPL-2.0 `[license not directly verified]` | active | `git smartlog` = compressed, relevance-filtered view of the commit graph; hides irrelevant commits. | IDEA — the *filtering* idea (show only what's not merged/relevant) is directly applicable to issue #5's "unmerged worktree branches" |
| gitviz (kevinw) | https://github.com/kevinw/gitviz | Python + JS | MIT | ~61★, 36 commits, date not shown | Live-updating browser view of git *internals* (blobs/trees/commits/refs) via dulwich + pydot + canviz + socket.io. Teaching tool. | IDEA — live push-to-browser architecture; the object-level view is not what's wanted |
| git-graph (hoduche) | https://github.com/hoduche/git-graph (PyPI `git-graph`) | Python | MIT | last release **Feb 2020** | Git plugin drawing the internal DAG (objects, refs) via Graphviz. | REJECT — abandoned, object-level |
| git-tree-viz | https://github.com/ewa/git-tree-viz | Python | GPL-3.0 | ~5★ | Collapses linear commit runs into single edges, leaving only topology (roots, heads, splits, merges), rendered with Graphviz. | **IDEA — genuinely useful**: issue #6 wants "DAG of how far a discovered clone advanced past current state"; edge-collapsing is exactly the right abstraction |
| grawkit | https://github.com/deuill/grawkit | awk | `[license not verified]` | playground at grawkit.deuill.org | Builds SVG graphs from textual descriptions of git commands. | REJECT — simulation, not introspection |
| prigitsk | https://github.com/orloffm/prigitsk | C#/.NET | `[license not verified]` | Windows console, "web version planned" | Draws repo graphs via Graphviz dot, assumes Flow branching. | REJECT |
| git-draw | https://github.com/sensorflo/git-draw | shell | `[license not verified]` | small | Draws nearly the entire content of a *tiny* repo as a graph. | REJECT — toy/teaching scale |
| tig / gitk / gitg / qgit / git-cola / GitExtensions / SourceGit / Gittyup / GitUp / Gitnuro | see indigane catalog | C / Tcl / Vala / C++ / Python / C# / C# / C++ / Obj-C / Kotlin | mostly GPL-2/GPL-3 | all live except GitAhead (superseded by Gittyup) | Desktop/TUI clients; all commit-DAG for one repo at a time. | REJECT as a base; **IDEA**: several show per-branch ahead/behind columns worth copying for issue #5 |

**Category conclusion:** zero of these model a *clone* as a node. The transferable assets are
(a) commit-graph layout algorithms, (b) ahead/behind badge design, (c) topology-collapsing
(git-tree-viz), (d) relevance filtering (smartlog).

---

## 2. Web-based git browsers / frontends

| Name | URL | Lang | License | Activity / ★ | What it does | Verdict |
|---|---|---|---|---|---|---|
| **ungit** | https://github.com/FredrikNoren/ungit | JavaScript/Node | **MIT** | ~10.6k★, 4015 commits, actively CI'd | Local Node server + browser UI; flow-chart commit graph, file browser, diffs, auto-refresh with recursive dir watching, **plugin architecture**, editor integrations (VS Code/Atom/Brackets). Explicitly designed to be run on a headless/cloud box and driven from your browser. | **BASE** — best available "local daemon + browser" shell with a compatible license. Graph model would be replaced wholesale. |
| git-truck | https://github.com/git-truck/git-truck | TypeScript | MIT | ~773★ | `git truck` opens a browser; hierarchy-oriented visualization of repo evolution (who worked where/when), fully offline. VISSOFT 2022 paper. | IDEA — good precedent for "CLI command that pops a local web app"; content is file/author-centric, not repo-network |
| githru | https://github.com/githru/githru | TS/JS | MIT | ~68★, only 10 commits on master, README has TBD sections | Visual-analytics system for large commit graphs: graph reconstruction + clustering + context-preserving squash-merge to abstract huge histories; summary view + comparison view. Research (VIS 2020). | IDEA — the **clustering/abstraction** technique matters if a worldmap gets big; project itself looks dormant |
| GitList | https://github.com/klaussilveira/gitlist | PHP | **BSD-2-Clause** (verified) | ~3.0k★, 724 commits | Web viewer for local repos: history, blame, diff, multiple branches. **No network/graph view.** | REJECT |
| klaus | https://github.com/jonashaag/klaus | Python | **ISC** | ~702★, 606 commits | Zero-config git web viewer, syntax highlighting, Smart HTTP push/pull, ctags navigation. No graph views. | REJECT (as a visualizer); mildly interesting as a minimal Python git web server skeleton |
| gitweb / git-instaweb | shipped with git | Perl | GPL-2.0 | maintained | Browse many repos under a common root, revision logs, file history. No commit graph, no repo-relationship view. | REJECT |
| cgit | https://git.zx2c4.com/cgit/ `[not fetched — verified only via secondary sources]` | C | GPL-2.0 | maintained | Hyperfast web frontend; basic UI, no graph, no auth. | REJECT |
| Gitea / Forgejo commit graph | https://gitea.com/gitea/docs/graph (live instance page); module `code.gitea.io/gitea/modules/gitgraph` | Go | MIT (Gitea) / GPL-3 (Forgejo) | live | `/{owner}/{repo}/graph` renders a commit graph with branch selector, search across branches. Gitea issue #786 asking for a GitHub-style *network* graph was **closed as duplicate** (opened 2017); no fork-network view exists. | REJECT for the goal; **relevant negative result**: forges do commit graphs, not repo-relationship graphs |
| GitLab "Repository → Graph" | built into GitLab (gitlab-org/gitlab) | JS (historically Raphaël) | MIT Expat (FOSS edition) | live | Network/commit graph of the project's own history. Portable extraction attempt **ChromatixAU/gitlab-network-graph** exists but was **archived 2018-08-08**. | REJECT — archived extraction; upstream is entangled in GitLab |
| GitHub "Insights → Network" | github.com (closed source) | — | proprietary | live | Branch history across the *entire fork network*, up to ~100 most-recently-pushed branches. | **IDEA — this is the single closest existing UX to issue #6.** Not reusable; must be reimplemented against the GitHub API |
| radicle-explorer | https://github.com/radicle-dev/radicle-explorer | TS (Svelte) | `[license not verified]` | live mirror | Web interface over a Radicle seed node's HTTP API; browse repos replicated on the P2P network. | IDEA — relevant because issue #1 mentions collecting `rad` identifiers; a seed node is effectively a "host node" in the worldmap |
| gat Graph | https://graph.gat.sh/ , https://gat.sh/docs/graph | — | **not open source** ("Coming Q1 2026") | hosted SaaS | Paste a repo URL, get an interactive commit graph with author filter, diffs, search. | REJECT — closed, hosted, single-repo |
| Graphoria | https://www.gitgraphoria.com/ | — | `[UNVERIFIED — could not confirm an open-source repo]` | — | Marketed as a Git GUI rendering the repo as an interactive DAG with push/fetch/clone. | REJECT pending verification |

---

## 3. Multi-repo / fleet tools

These manage *many repos at once*. Critically: **all of them are list/table-shaped, none is
graph-shaped**, and none models the relationships *between* the repos they manage.

| Name | URL | Lang | License | Activity / ★ | What it does | Verdict |
|---|---|---|---|---|---|---|
| **gitpane** | https://github.com/affromero/gitpane | Rust | MIT | ~123★, 538 commits, active 2026 | Terminal dashboard over a scanned root dir: per-repo branch, dirty state, **ahead/behind arrows with 30s auto-fetch polling**, **worktree count + expand/collapse (`w`)**, commit history, split diffs, GH issues/PRs panel via `gh`. TOML config for scan depth/exclusions/pins. | **IDEA — the closest thing to issue #5's "dashboard of up-to-dateness".** Steal the metric set (ahead/behind, dirty, worktrees) verbatim; the presentation is a TUI table, not a graph |
| gita | https://github.com/nosarthur/gita | Python | MIT | ~1.9k★ | Side-by-side status of many repos, colour-coded ahead (purple) / behind (yellow) / dirty; batch command delegation; repo groups. | IDEA — same as above, simpler |
| git-workspace | https://github.com/orf/git-workspace | Rust | MIT | ~343★, 536 commits | Syncs all repos from GitHub / GitLab (incl. self-hosted) / Gitea into a directory tree; **automatically sets upstreams for forks**; archives deleted repos; parallel fetch. | **IDEA/REUSE (as a collector)** — the fork→upstream auto-detection and multi-forge enumeration is directly reusable input for issue #6's discovery step |
| meta | https://github.com/mateodelnorte/meta | JavaScript | MIT | ~2.2k★, 297 commits | "Clone a many-project architecture in one line"; plugin architecture; run arbitrary commands across child repos; monorepo↔meta-repo migration. | REJECT (no visualization); IDEA for the `.meta` manifest as a persisted "which clones do I care about" file |
| vcstool | https://github.com/dirk-thomas/vcstool | Python | **Apache-2.0** | ~502★ | YAML manifest of repos (git/hg/svn/bzr), recursive discovery, export/import of repo sets, parallel commands. ROS ecosystem standard. | IDEA — its **`vcs export` YAML** is a good prior art for the persisted set-of-clones format |
| west | https://docs.zephyrproject.org/ (zephyrproject-rtos/west) | Python | Apache-2.0 `[license not directly verified]` | live | Zephyr's multi-repo manifest tool; "augments git in minor ways for multi-repo work". | REJECT — manifest tool, no viz |
| myrepos (`mr`) | myrepos.branchable.com `[site egress-blocked; verified via secondary sources]` | Perl | GPL-2+ | mature/stable | VCS-agnostic registry of all your checkouts; `mr status`/`mr update` across everything. Joey Hess (same author as git-annex). | IDEA — its `~/.mrconfig` registry is the natural "list of local clones to seed the walker with" |
| gitslave (`gits`) | https://gitslave.sourceforge.net/ | Perl | GPL-2 `[license not directly verified]` | old | superproject + slave repos, clone/populate together. | REJECT — superseded by submodules |
| vcspull | https://pypi.org/project/vcspull/ | Python | MIT `[license not directly verified]` | live | Sync many git/svn/hg repos from JSON/YAML. | REJECT |
| git-dashboard (kojung) | https://github.com/kojung/git-dashboard | Python | `[license not verified]` | small | Dashboard of status for many repos, grouped via `config.yaml`. | REJECT — subsumed by gitpane/gita |
| git-xargs | https://github.com/gruntwork-io/git-xargs `[not fetched]` | Go | Apache-2.0 `[UNVERIFIED]` | — | Run a command across many GitHub repos and open PRs. | REJECT — mutation tool, no viz |
| Android `repo` | https://gerrit.googlesource.com/git-repo `[not fetched]` | Python | Apache-2.0 `[UNVERIFIED]` | live | Manifest-driven multi-repo checkout for AOSP. | REJECT |
| Backstage catalog-graph plugin | https://github.com/backstage/backstage/tree/master/plugins/catalog-graph | TypeScript/React | Apache-2.0 | very active | `EntityRelationsGraph` React component + `CatalogGraphPage`: **navigate through entities by clicking, filter by kind/relation, set max depth, change layout direction**. Card variant embedded on each entity page with "View Graph". | **BASE / strong IDEA** — this is a production-quality, Apache-2 React component for exactly the "expand a relationship graph by depth and relation type" interaction. Swap the catalog backend for a git-clone backend |
| Nx project graph (`nx graph`) | https://nx.dev/docs/features/explore-graph | TypeScript | MIT `[license not directly verified]` | very active | CLI opens a browser with an interactive dependency graph; **composite nodes expand in place**, "focus" a node to re-render around it, search bar, hide/show, click node for details, export PNG. | **IDEA — best-in-class "expand in place / focus" interaction model** and the exact "CLI command opens a local browser graph" shape wanted here |
| oss-dashboard (Amazon) | https://github.com/amzn/oss-dashboard `[not fetched]` | Ruby | Apache-2.0 `[UNVERIFIED]` | dormant | Dashboard across many GitHub orgs. | REJECT |

---

## 4. Repo-relationship / fork-network tools

The category that *should* be central to issue #6, and is nearly empty.

| Name | URL | Lang | License | Activity / ★ | What it does | Verdict |
|---|---|---|---|---|---|---|
| **useful-forks** | https://github.com/useful-forks/useful-forks.github.io | JavaScript | MIT | ~1.3k★ | Web tool + Chrome extension + bookmarklet. Recursively queries the GitHub API over a repo's forks and renders a **table: slug, stars, forks, commits ahead, commits behind, last updated**, filtering out forks with zero new commits. Supports authenticated requests for rate limits. | **REUSE (logic) / IDEA (UX)** — issue #6 asks almost literally for this: "grey out clones with no new commits, show how far they advanced". Its ahead/behind-per-fork query logic is directly liftable |
| GitHub Active Forks | https://github.com/activeforks/activeforks.github.io | JavaScript | `[license not verified]` | live; also a Chrome Web Store extension | Injects an "active forks" section into GitHub repo pages showing commits ahead/behind per fork, sortable by stars / last commit / sub-forks. | IDEA — same as above, plus the "sub-forks" (transitive fork tree) notion |
| GitHub Insights → Network | closed source | — | proprietary | live | Branch history across the whole fork network. | IDEA (see §2) |
| gitlab-network-graph | https://github.com/ChromatixAU/gitlab-network-graph | JS (Raphaël) | `[license not verified]` | **archived 2018-08-08** | Attempt to make GitLab's network graph portable, incl. tools to generate the JSON from `git log`. | REJECT — archived, 8 years stale |
| Gitgraph (PhilippMatthes) | https://github.com/PhilippMatthes/Gitgraph | JavaScript | **no license file** | **archived 2020-12-02**, 0★ | Explore GitHub *user* cliques: type a username, **left-click a node to load that user's followers into the graph**, node size by in-degree, right-click to open the profile. | **IDEA — the single clearest existing implementation of the click-to-expand-a-spider-graph interaction**, but it maps users, not repos, and is unlicensed + archived. Copy the interaction, not the code |
| swh-graph (Software Heritage) | https://github.com/SoftwareHeritage/swh-graph | Rust (+ Python bindings) | **GPL-3.0** | ~5★ on mirror; project very active | In-memory compressed (Boldi–Vigna/WebGraph) representation of the whole SWH Merkle DAG — contents → directories → revisions → releases → snapshots → **origins**. gRPC service + Python bindings. **No browsable UI** in this repo; browsing lives in the separate archive.softwareheritage.org front end. | **IDEA — the one existing global "worldmap of git"**, but at archive scale, immutable, and origin-centric (URL of a crawl), with no notion of a *live clone's remotes*. Useful as an external oracle: "who else has this commit?" |
| Software Heritage archive browse UI | https://archive.softwareheritage.org `[not fetched]` | Python/Django | AGPL/GPL `[UNVERIFIED]` | live | Browse origins, visits, snapshots, directories; SWHIDs as permanent identifiers. | IDEA — SWHID as a stable cross-clone identifier is worth comparing to annex/datalad UUIDs |
| VisFork (research) | Chen et al., "Use the Forks, Look!" (https://jacobkrueger.github.io/assets/papers/Chen2024ForkVis.pdf) | D3.js prototype | academic | paper only | Fork-ecosystem exploration: commit-distribution bar chart doubling as a date-range brush, then per-fork detail. | IDEA — prior art to cite for issue #6 |
| forkstat | — | — | — | — | **Not relevant**: `forkstat` is Colin King's Linux process fork/exec/exit monitor, nothing to do with git forks. | REJECT |
| ghcrawler (Microsoft) | https://github.com/microsoft/ghcrawler `[not fetched]` | Node.js | MIT `[UNVERIFIED]` | dormant | Queue-driven crawler that transitively walks GitHub API entities and stores them. | IDEA — architecture reference for the "discover new clones" collector in issue #6 |
| societe-generale/github-crawler | https://github.com/societe-generale/github-crawler `[not fetched]` | Python | Apache-2.0 `[UNVERIFIED]` | dormant | Crawls all repos of an org (GitHub + GitLab) looking for patterns. | REJECT |

---

## 5. Repo-as-landscape / novel visual metaphors

| Name | URL | Lang | License | Activity / ★ | What it does | Verdict |
|---|---|---|---|---|---|---|
| Gource | https://github.com/acaudwell/Gource | C++ | **GPL-3.0** | ~13.1k★ | Animated force-directed tree of a repo's directory structure over time, with avatars. Single repo per run (multi-repo only by manually merging custom-format logs). **git-annex can emit `--gource`-compatible output.** | REJECT for the worldmap; **note the existing git-annex↔Gource integration** as prior art for "git-annex emits a viz feed" |
| code_swarm | (Michael Ogawa, 2008) `[not fetched — historical]` | Java | GPL `[UNVERIFIED]` | dead | Organic swarm animation of commit activity. | REJECT |
| anvaka/map-of-github | https://github.com/anvaka/map-of-github | JavaScript | MIT | ~2.9k★, May-2025 data release | 690k repos × 1.5k clusters laid out as a *geographic-style map*: Jaccard similarity over ~500M GitHub stars → Leiden clustering → ngraph.forcelayout → GeoJSON → Tippecanoe tiles → **MapLibre**. Pan/zoom/search a "galaxy" of repos. | **IDEA — the best answer to "what does a *worldmap* of repos actually look like"**, and a concrete tile-based rendering pipeline for very large node counts. Wrong data (star co-occurrence, not remotes) |
| CoderCity | https://github.com/INSO-World/CoderCity | JS/TS `[from repo listing]` | `[license not verified]` | research | Web-based interactive code-ownership visualization on the Code City metaphor. | REJECT — file/ownership level |
| codecity (grahambrooks) | https://github.com/grahambrooks/codecity | `[not fetched]` | `[UNVERIFIED]` | — | "Multi-repository code visualization as a 3D city view." | IDEA — one of the very few *multi-repo* metaphor tools; still file-level, not remote-level |
| RepoVis | Feiner & Andrews, VISSOFT 2018 (IEEE 8530126); code at https://github.com/pjuhasz/repovis `[repo not fetched; name collision possible]` | — | academic | paper | Visual overviews + full-text search of a git repo; files/LOC colour-coded by last modification, developer, type, issue. | REJECT — file level |
| EvoStreets / VR-GitCity | academic (UPV, VISSOFT) | — | academic | papers | 3D/VR street-and-building metaphors for software evolution. | REJECT |
| "Zeeker" | — | — | — | — | `[UNVERIFIED — could not confirm any such repository-visualization project exists]` | drop |

---

## 6. git-annex / DataLad specific

| Name | URL | Lang | License | Activity | What it does | Verdict |
|---|---|---|---|---|---|---|
| **`git annex map`** | https://git-annex.branchable.com/git-annex-map/ (**site is egress-blocked from this environment; content below corroborated by two independent secondary sources, not fetched directly — re-verify before quoting**) | Haskell | GPL-3.0 | shipped, stable | Generates a Graphviz file of repos and the git-remote arrows between them; ovals = repositories coloured **white=regular, green=trusted, red=untrusted, grey=dead**; **light-blue boxes = hosts** containing their repos; displays via `dot` if available, or saves the `.dot`. Documented limitation: *"only connects to hosts that the host it's run on can directly connect to and does not try to tunnel through intermediate hosts, so it might not show all connections"*. Secondary sources also state the map can be emitted **as a JSON object** — `[NEEDS DIRECT VERIFICATION: whether `--json` is implemented for `map` specifically, or whether this is the generic git-annex `--json` blurb; the parent brief says there is an open todo for `--json`]`. | **BASE for the data model / collector semantics; REJECT as the renderer.** Everything issue #1 asks for (remote names, hosts, trust colouring, ssh spidering) is *already conceptually here*; what is missing is interactivity, incremental expansion, persistence, annex-UUID/dataset-UUID annotation, and the error/warning layer |
| git-annex assistant webapp | https://git-annex.branchable.com/design/assistant/webapp/ `[egress-blocked; secondary sources only]` | Haskell (Yesod) | GPL-3.0 | shipped | localhost-only web UI for setting up repos and controlling the assistant; repository lists and groups. **No graph/network view.** | REJECT — but proves the "git-annex ships a localhost web UI" precedent, incl. auth-token-in-URL pattern |
| git-annex `--gource` output | git-annex `log --gource` | Haskell | GPL-3.0 | shipped | Emits Gource-compatible custom log format. | IDEA — existing precedent for git-annex feeding an external visualizer |
| DataLad Registry | https://github.com/datalad/datalad-registry | Python (Flask/Celery/PostgreSQL/RabbitMQ) | **MIT** | 1764 commits; live at registry.datalad.org | Central registry of DataLad datasets keyed by **dataset UUID**; finds *clones* of a dataset and datasets *using it as a subdataset* across platforms; web UI with search + stats (unique datasets, annexed file count/size). Deployable read-write or read-only. | **REUSE — this is the discovery backend issue #6 asks for.** MIT, same org, already exposes "give me the known URLs for this UUID". No graph rendering |
| DataLad Gooey | https://github.com/datalad/datalad-gooey | Python (Qt) | MIT `[license not directly verified]` | 0.2.x, low activity | Desktop GUI: expandable **tree view** of directories with type/state annotations (dataset vs directory vs file; annexed / committed-to-git / modified / untracked), command/metadata/history/properties tabs. | IDEA — its annotation vocabulary (type + state badges) is the right vocabulary for worldmap node badges; tree ≠ graph |
| `datalad tree` (datalad-next) | https://docs.datalad.org/projects/next/en/stable/generated/man/datalad-tree.html | Python | MIT | live | `tree`-like renderer where depth is **subdataset nesting level regardless of filesystem location** — for discovering dataset hierarchies. | **REUSE (for issue #4)** — this is already the subdataset-hierarchy walker; it needs a graph renderer, not a new walker |
| `datalad subdatasets` | https://docs.datalad.org/en/stable/generated/man/datalad-subdatasets.html | Python | MIT | live | Machine-readable listing of subdatasets, bottom-up or top-down, recursive. | **REUSE — collector primitive for issue #4** |
| git-annex-metadata-gui | https://github.com/alpernebbi/git-annex-metadata-gui | Python/Qt | `[license not verified]` | dormant | Qt GUI for git-annex *metadata* commands. | REJECT — file metadata, not topology |
| git-annex-ria-remote | https://github.com/datalad/git-annex-ria-remote | Python | MIT `[license not directly verified]` | superseded by datalad's ORA remote | RIA store special remote. | Reference only — defines the RIA store layout the worldmap must model as a node type |

---

## 7. Generic interactive graph-exploration platforms (the "expand by clicking" tier)

Not git-aware at all — but this is where the *required UX* actually exists today.

| Name | URL | Lang | License | ★ | Incremental expansion? | Persisted view? | Verdict |
|---|---|---|---|---|---|---|---|
| **Argo Lite** | https://github.com/poloclub/argo-graph-lite | JS (D3 + Three.js/WebGL) | **MIT** | ~130★ | **Yes — documented "start with high-ranking nodes and progressively add neighbouring nodes"** | **Yes — shareable immutable snapshot URLs that viewers can keep exploring from; iframe embedding** | **BASE** — closest existing match to the required interaction + persistence model; small, MIT, browser-only |
| Backstage `catalog-graph` | https://github.com/backstage/backstage/tree/master/plugins/catalog-graph | TypeScript/React | Apache-2.0 | (monorepo) | Yes — click to navigate, max-depth control, relation-type filters, layout direction | Partially (URL params) | **BASE** — production-grade React relationship-graph component |
| AWS graph-explorer | https://github.com/aws/graph-explorer | TypeScript/React | **Apache-2.0** | ~478★ | Yes — "interactively explore connections around nodes and edges" without writing queries; faceted search; per-node styling/icons | Saves images; view persistence not confirmed | **BASE/IDEA** — a full no-query graph browser; would need its Gremlin/SPARQL/openCypher backend swapped for a git collector API |
| Gephi Lite | https://github.com/gephi/gephi-lite | TypeScript/React + sigma.js + graphology | **GPL-3.0** | — | Filtering/appearance, client-side; expansion not its focus | Save/load graphs via GitHub gists; shareable URL / iframe | IDEA — GPL-3 is fine if the project goes GPL; heavy for this use case |
| Retina | https://gitlab.com/ouestware/retina | TypeScript + sigma.js | **GPL-3.0** | — | Explore/filter a published graph | **Yes — serverless sharing of a network visualization, state in the URL/hosted file** | IDEA — "publish a snapshot of the worldmap for a colleague" is exactly its purpose |
| sigma.js / graphology | https://github.com/jacomyal/sigma.js | TypeScript | MIT | ~11k★ `[star count not directly verified]` | building block | building block | **REUSE (library)** — WebGL renderer for large graphs |
| Cytoscape.js | https://js.cytoscape.org/ | JS | MIT | — | building block (rich event model, compound nodes for host/subdataset grouping) | serializable JSON graph state | **REUSE (library)** — compound-node support maps directly onto "host box contains repos" and "superdataset contains subdatasets" |
| vis-network | https://github.com/visjs/vis-network `[not fetched]` | JS | Apache-2.0/MIT dual `[UNVERIFIED]` | — | building block | — | REUSE (library) alternative |
| Gephi (desktop) | https://github.com/gephi/gephi | Java | GPL-3 / CDDL | — | Desktop, batch-oriented | .gephi files | REJECT — desktop, not embeddable |
| Neo4j Browser / Bloom | neo4j.com | — | Browser is GPL-3; Bloom proprietary | — | Yes (double-click to expand) | Saved perspectives (Bloom, proprietary) | IDEA — the canonical "double-click a node to expand its neighbours" idiom |
| Graphviz | https://graphviz.org/ | C | EPL-1.0 | — | No — static layout | .dot files | REUSE (as one export format only). `git annex map`'s current renderer; the thing being replaced |
| Mermaid | https://mermaid.js.org/ | TypeScript | MIT | — | No | text source | REUSE — issue #1 explicitly names Mermaid flowcharts as a render target; good for embedding in docs/issues, not for navigation |

---

## 8. Discovery / crawling components (inputs to the walker)

| Name | URL | Lang | License | Status | Notes | Verdict |
|---|---|---|---|---|---|---|
| git-repo-crawler | https://github.com/irvinlim/git-repo-crawler | Node.js | MIT | **archived 2020-05-16**, 3★ | Walks a directory tree finding git repos, optionally runs a command in each. No remote handling. | REJECT — 30 lines of `find -name .git` |
| git-spider (joeyrideout) | https://github.com/joeyrideout/git-spider `[not fetched]` | bash | `[UNVERIFIED]` | — | Security tool: crawls hostnames for *exposed* `.git` dirs over HTTP. | REJECT — different problem (pentesting) |
| ghcrawler / github-crawler | see §4 | — | — | dormant | Transitive GitHub API crawlers. | IDEA |
| git-workspace | see §3 | Rust | MIT | active | Enumerates repos across GitHub/GitLab/Gitea orgs, resolves fork→upstream. | **REUSE (as collector)** |
| giturlparse | https://github.com/nephila/giturlparse `[not fetched]` | Python | Apache-2.0 `[UNVERIFIED]` | live | URL normalization across https/ssh/git — named in issue #1. | REUSE (library) — required for the "same clone reached by different URL schemes" dedup problem |

---

## Gaps — what NONE of these tools do

1. **Nobody makes a *clone* the node.** With the sole exception of `git annex map`, every tool in
   this survey visualizes commits, files, authors, or (rarely) forge-side forks. The primitive
   "this working tree on host A has a remote named `orig` pointing at that bare repo on host B,
   which is the same annex UUID as the RIA store on host C" is drawn by exactly one program in the
   world, statically, as a `.dot` file.

2. **Nobody handles the per-clone remote-name problem.** The identity of a repository is
   global (annex UUID / datalad dataset UUID / SWHID-ish), but the *name* of the edge is local and
   different in every clone (`origin` here, `upstream` there, `datalad` elsewhere). No tool models
   an edge whose label is clone-relative. Every fork-network tool assumes a single global naming
   authority (the forge).

3. **Nobody does incremental expansion of a git graph.** The click-to-expand-neighbours idiom
   exists (Argo Lite, Backstage catalog-graph, Nx, AWS graph-explorer, Neo4j Browser) but never
   over git remotes; and the one tool that spiders git remotes (`git annex map`) expands everything
   eagerly in one shot and then stops. There is no "I see this node, fetch *its* remotes now, add
   them to my view" loop anywhere.

4. **Nobody persists an exploration.** Argo Lite's snapshot URLs and Retina's serverless sharing
   are the only persistence-of-a-graph-view mechanisms found, and they persist a *frozen* graph,
   not "my accumulated knowledge base about a set of clones that I intend to keep growing across
   sessions". No tool has a durable local store of visited clones + their observed metadata +
   staleness timestamps.

5. **Nobody annotates repo-level *errors and warnings*.** Duplicate annex UUIDs (two clones
   claiming the same UUID), dead remotes, unreachable hosts, encrypted/exporttree/importtree
   special-remote flags — `git annex map` colours by trust only. No tool surfaces
   "these two nodes are the same UUID and that is a bug".

6. **Nobody aggregates ahead/behind across *remotes* into a topology view (issue #5).** gitpane,
   gita and GitLens compute ahead/behind well, but present it as a per-repo table row. Nothing
   attaches "+37 commits / 4 branches ahead" as an *edge weight* on a remote arrow, and nothing
   models "N unmerged worktree branches" or "a RIA store accumulating one result branch per
   subject" as a first-class alert.

7. **Nobody bridges forge-side discovery to local action (issue #6).** useful-forks and
   GitHub Active Forks compute per-fork ahead/behind and grey out empty forks — but they stop at a
   web table with a link. There is no "preview this discovered clone's DAG relative to mine, then
   press Add to make it a real remote in my working tree, then keep exploring from it".

8. **Nobody unifies the three graph *kinds* the goal needs.** Issue #4's subdataset containment,
   issue #1's remote edges, and issue #6's fork/upstream edges are three different edge types over
   overlapping node sets. `datalad tree` / `datalad subdatasets` handle containment; `git annex map`
   handles remotes; useful-forks handles forks. No tool overlays them.

9. **Nobody models hosts, special remotes and non-git endpoints as peers of repos.** git-annex's
   special remotes (S3, rsync, directory, ORA/RIA, encrypted variants) are edges to non-git things;
   `git annex map` shows repos and host boxes but not special-remote endpoints as typed nodes with
   their own properties (encryption, exporttree, importtree, keystore layout).

10. **Nobody carries edge-quality metadata.** Ping distance, bandwidth, shared vs unique annexed
    content size — the "collectors plugin" idea in issue #1 — has no precedent in any of these
    tools. The closest analogue is git-annex's own `--fast`/trust levels and `whereis` accounting,
    which is content-level, not edge-level.

### Practical implication

The build is best framed as **collector + store + browser app**, borrowing:

- **collector semantics** from `git annex map` (host/repo/trust/ssh-spider) + `datalad subdatasets`
  / `datalad tree` (containment) + `git-workspace` (forge enumeration, fork→upstream) +
  `useful-forks` (per-fork ahead/behind via GitHub API) + `datalad-registry` (UUID → known clones),
- **alert metrics** from gitpane / gita / GitLens (ahead/behind, dirty, worktrees) and
  git-tree-viz (topology collapsing for the "how far did it advance" DAG),
- **UI shell** from ungit (local node server + browser) or Sapling ISL (local daemon + web client
  + VS Code host),
- **graph interaction** from Argo Lite (incremental expansion + snapshot URLs), Backstage
  catalog-graph (relation-typed depth-limited expansion) and Nx (expand-in-place / focus),
- **renderer** from sigma.js or Cytoscape.js (compound nodes for host / superdataset grouping),
  with Graphviz and Mermaid retained only as static *export* formats.

Nothing in the survey can be adopted wholesale. The genuinely novel, unimplemented parts are:
the clone-identity/remote-name edge model, the incremental spider-expand loop, the durable
exploration store, and the repo-level alert layer.

---

## Appendix A — License compatibility notes

The project is expected to be MIT/BSD-ish or at least GPL-compatible. Relevant hazards found:

| Project | License | Consequence |
|---|---|---|
| **mhutchie/vscode-git-graph** | **Modified MIT: "Permission is NOT GRANTED to publish, distribute, sublicense, and/or sell derivative works"** | **Hard blocker.** Cannot fork, cannot vendor, cannot ship a derivative. Read for inspiration only. This is the single most likely license trap in this space because the extension is the obvious first thing people point at. |
| GitLens | MIT + separate proprietary `plus/` tree; several graph features gated behind a GitKraken account | Cannot reuse the interesting parts |
| Gource, git-tree-viz, gephi-lite, Retina, swh-graph, Gephi | GPL-3.0 | Fine only if the project itself goes GPL-3; blocks an MIT/BSD outcome for linked code (Gource is a separate process, so *piping data to it* is fine) |
| `git annex map`, git-annex assistant | GPL-3.0 (git-annex) | Reimplementing the *semantics* is unencumbered; copying Haskell source is not, unless the project accepts GPL-3 |
| gitk, tig, gitg, qgit, git-cola, gitweb, cgit, myrepos, Sapling core | GPL-2 family | Same consideration |
| **ungit** | MIT | Clean for a fork/BASE |
| **Argo Lite** (poloclub/argo-graph-lite) | MIT | Clean for a fork/BASE |
| **Backstage catalog-graph**, **AWS graph-explorer**, **vcstool** | Apache-2.0 | Clean, with patent grant; Apache-2 is GPL-3-compatible but not GPL-2-compatible |
| **datalad-registry**, **gita**, **meta**, **git-workspace**, **gitpane**, **useful-forks**, **git-truck**, **githru**, **serie**, **git-graph (git-bahn)**, **sigma.js**, **Cytoscape.js**, **Mermaid** | MIT | Clean |
| **GitList** | BSD-2-Clause (verified from LICENSE file) | Clean |
| **klaus** | ISC | Clean |
| PhilippMatthes/Gitgraph | **no license file at all** | Unusable; archived 2020 |
| activeforks, grawkit, prigitsk, git-draw, CoderCity, git-annex-metadata-gui | not verified | Check before touching |

## Appendix B — Library vs application, and programmatic drivability

For the browser-app plan, what matters is whether a candidate can be *driven from data* rather
than only from a repo on disk.

- **Data-driven, embeddable, browser-native:** sigma.js, Cytoscape.js, vis-network, Mermaid,
  gitgraph.js (**archived**; author now recommends Mermaid), Argo Lite, Retina, Gephi Lite,
  Backstage `EntityRelationsGraph`, AWS graph-explorer. These accept an arbitrary node/edge model —
  which is what a repo-level worldmap needs, since no git-specific renderer models these nodes.
- **Repo-driven applications, not embeddable:** ungit, git-truck, githru, Sapling ISL, all TUIs and
  all desktop clients. They read a repo path and own the whole UI. Forkable, not embeddable.
- **One-shot exporters (pipe-friendly):** `git annex map` (→ dot), git-tree-viz (→ dot),
  hoduche/git-graph (→ dot), grawkit (→ svg), Gource (consumes a custom log format —
  git-annex already emits it via `--gource`), `datalad subdatasets` (→ machine-readable records),
  `vcs export` (→ YAML), useful-forks (→ GitHub API queries). These are the realistic *inputs*.
- **Closed/hosted, not usable:** GitHub Insights Network, gat Graph, GitKraken Desktop,
  Sourcetree, Graphoria (unconfirmed).

## Appendix C — Named in the assignment but not usable / not found

Recorded so the same ground is not re-searched:

- **forkstat** — not a git tool. It is Colin King's Linux kernel process fork/exec/exit event
  monitor. No relation to fork networks.
- **"Kohsuke's Network Graph"** — could not confirm a standalone open-source project of this name;
  GitHub's network graph itself is closed source. `[UNVERIFIED]`
- **"git-fork-graph"** — no such project confirmed. `[UNVERIFIED]` The functional equivalents that
  do exist are useful-forks and activeforks.
- **"Zeeker"** — no repository-visualization project of this name confirmed. `[UNVERIFIED]`
- **Sourcetrail** — archived source-code (symbol-level) explorer; wrong granularity entirely. REJECT.
- **gitgraph.js** (nicoespeon) — **ARCHIVED**; the README now points users at Mermaid. Do not build on it.
- **ChromatixAU/gitlab-network-graph** — archived 2018-08-08.
- **PhilippMatthes/Gitgraph** — archived 2020-12-02, unlicensed.
- **irvinlim/git-repo-crawler** — archived 2020-05-16.
- **hoduche/git-graph** — last release Feb 2020.
- **GitAhead** — succeeded by Murmele/Gittyup.
- **GitQlient** — Qt desktop client, commit-DAG for one repo; REJECT (not separately fetched).
- **Gitea network graph** — requested in go-gitea/gitea#786 (opened 2017), **closed as duplicate**;
  Gitea/Forgejo ship a per-repo commit graph at `/{owner}/{repo}/graph`, not a fork network.

## Appendix D — Sources fetched and verified

git-bahn/git-graph · mhutchie/vscode-git-graph (+ LICENSE) · kevinw/gitviz · lusingander/serie ·
FredrikNoren/ungit · git-truck/git-truck · githru/githru · klaussilveira/gitlist (+ LICENSE) ·
jonashaag/klaus · acaudwell/Gource · nosarthur/gita · mateodelnorte/meta · dirk-thomas/vcstool ·
affromero/gitpane · orf/git-workspace · useful-forks/useful-forks.github.io ·
PhilippMatthes/Gitgraph · irvinlim/git-repo-crawler · drewfish/git-moo · git-school/visualizing-git ·
ewa/git-tree-viz · indigane/git-graph-drawing · aws/graph-explorer · poloclub/argo-graph-lite ·
anvaka/map-of-github · SoftwareHeritage/swh-graph · datalad/datalad-registry · facebook/sapling ·
gitkraken/vscode-gitlens · go-gitea/gitea#786 · pypi.org/project/git-graph · con/ceptualization#1.

Not fetchable from this environment (egress-blocked, so relied on secondary sources and flagged
accordingly): **git-annex.branchable.com**, manpages.debian.org, sources.debian.org, linux.die.net,
systutorials.com, myrepos.branchable.com. **The `git annex map` man page in particular should be
re-read directly** before the design settles, especially regarding `--json` and the exact spidering
behaviour.
