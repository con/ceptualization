# Ecosystem prior art and data-acquisition sources for the git/git-annex "worldmap" walker

Research notes for con/ceptualization issues [#1](https://github.com/con/ceptualization/issues/1)
(walker/drawer), [#4](https://github.com/con/ceptualization/issues/4) (subdatasets),
[#5](https://github.com/con/ceptualization/issues/5) (aheadness alerts),
[#6](https://github.com/con/ceptualization/issues/6) (discovery + pre-view).

**Verification status legend.** Claims below are marked:
`[src]` verified by reading actual source/docs obtained in this session;
`[run]` verified by actually running the command here (git 2.43.0, Linux);
`[web]` verified only through a web-search summary (page itself unreachable);
`[UNVERIFIED]` could not be checked — treat as a lead, not a fact.

> Sandbox caveat: this session's egress proxy blocks `git-annex.branchable.com`,
> `docs.datalad.org`, `handbook.datalad.org`, `registry.datalad.org`, `codeberg.org`,
> `archive.softwareheritage.org`, `docs.softwareheritage.org`, `api.ecosyste.ms`,
> `deps.dev`, `manpages.*`, and `api.github.com`. Anonymous `git clone` of public GitHub
> repos *does* work, so upstream sources were read from clones instead
> (git-annex upstream via `con/git-annex` branch `upstream/master` @ `6bc17908`,
> `datalad/datalad`, `datalad/datalad-registry`, `datalad/datalad-metalad`,
> `datalad/datalad-usage-dashboard`, `SoftwareHeritage/swh-web`,
> `radicle-dev/heartwood`, `go-gitea/gitea`, `ecosyste-ms/repos`, `github/docs`).

---

## TL;DR — the five highest-leverage data sources, ranked

1. **The `git-annex` branch of any one clone (`uuid.log` + `remote.log` + `trust.log` +
   location logs).** Highest value/cost ratio by a wide margin. A single anonymous
   `git fetch --depth 1 --filter=blob:none <url> refs/heads/git-annex:...` — **1.58 s,
   8.1 MB** on a real dataset `[run]` — yields the *complete roster of every annex clone
   ever seen*, with human descriptions that conventionally encode `user@host:/path`,
   plus every special remote's full configuration, plus which of them are dead. On
   `OpenNeuroDatasets/ds005256` this recovered **14 repositories across 6 hosts and 3
   special remotes**, i.e. essentially the whole hand-drawn map in issue #1, **without
   ssh-ing anywhere** `[run]`. Do this first, always.
2. **`git annex map --json`** — already implemented upstream (git-annex 10.20250605
   `[src]`); the todo ticket filed from issue #1 is `[[done]]` `[src]`. It gives the
   ssh-spidered node/edge graph for free. Wrap it, don't reimplement it — then extend
   where it stops (see the gap table in Part A).
3. **`git ls-remote` + a `--filter=tree:0` fetch.** The entire aheadness problem (issue
   #5/#6) collapses to: 0.45 s per remote for refs `[run]`; 1.08 s / 6.8 MB to obtain
   the *whole commit DAG* of a 17.8k-commit repo, then `git rev-list --left-right
   --count A...B` is local and instant `[run]`. Blobs and trees are never needed to
   count commits.
4. **datalad-registry + datalad-usage-dashboard.** `GET /api/v2/dataset-urls?ds_id=<UUID>`
   is a real, documented-in-code query `[src]`, and each record already stores
   `branches` = `{name: {hexsha, last_commit_dt}}`, `head`, `annex_uuid`, `ds_id`
   `[src]` — i.e. a *pre-computed remote-state snapshot* for issue #6's "pre-view"
   without touching the clone. Behind it, `datalad-repos.json` (7.24 MB, public, no
   auth `[run]`) enumerates ~12.5k GitHub + 974 GIN + 4628 hub.datalad.org + 199 OSF +
   115 ATRIS DataLad repos `[src]`.
5. **Forge fork APIs** — GitLab `GET /api/v4/projects/:id/forks` works unauthenticated at
   500 req/min `[run]`; Gitea/Forgejo `GET /repos/{owner}/{repo}/forks` `[src]`; GitHub
   `GET /repos/{o}/{r}/forks` + `parent`/`source` (60/h unauth, 5,000/h PAT, up to
   15,000/h app `[src]`). GitHub's *Network* graph itself has **no API** `[src]`.

Honourable mention, deliberately *not* in the top five: **Software Heritage**. Its
origin index is genuinely a global clone-discovery source, but the graph traversal that
would answer "which origins contain this commit" is **not publicly available and requires
authentication plus a special user permission** `[src]`. See Part B.

---

# Part A — git-annex / DataLad prior art

## A.1 `git annex map`: what it already gives us

Man page (`doc/git-annex-map.mdwn`, upstream) `[src]`:

```
SYNOPSIS   git annex map
DESCRIPTION
  Helps you keep track of your repositories, and the connections between them,
  by going out and looking at all the ones it can get to, and generating a
  Graphviz file displaying it all. If the `xdot` command is available,
  it is used to display the file to your screen.

  This command only connects to hosts that the host it's run on can
  directly connect to. It does not try to tunnel through intermediate hosts.
  So it might not show all connections between the repositories in the network

  Also, if connecting to a host requires a password, you might have to enter
  it several times as the map is being built.

  Note that this subcommand can be used to graph any git repository; it
  is not limited to git-annex repositories.
LEGEND
  Ovals are repositories. White is regular, green is trusted, red is
  untrusted, and grey is dead.
  Arrows between repositories are connections via git remotes.
  Light blue boxes are hosts that were mapped, and contain the repositories
  on that host.
OPTIONS
  --fast     Don't display the generated Graphviz file, but save it for later use.
  --json     Output the map as a JSON object.
```

Implementation, `Command/Map.hs` `[src]`:

* **Crawl**: `spider` is a breadth-first walk from the local repo. For each repo it
  `scan`s the config, then enumerates that repo's remotes
  (`Git.Construct.fromRemotes` / `fromRemoteUrlRemotes`), makes their URLs absolute
  relative to the parent, and enqueues them.
* **How it reaches a remote host** (`tryScan`): for `ssh://`-style remotes it *first*
  runs, over ssh:
  `sh -c "if ! cd <dir> 2>/dev/null; then cd <dir>.git; fi && git config --null --list"`,
  and only if that fails falls back to `git-annex-shell configlist`. The source comments
  the reason: works on non-git-annex repos, and `configlist` "doesn't include information
  about the remote's remotes". For **local paths** it reads the config directly. For
  **any other URL scheme (https, S3, ...) it does not connect at all** — it just reuses
  the annex UUID cached locally for that named remote.
* **Dedup**: `same` compares scheme + authority + path for URLs, path for local repos;
  `combineSame` then nubs by `annex.uuid`. Loop protection for mutually-recursive ssh
  paths was added in 10.20250520 `[src]`.
* **Rendering**: node id = `annex.uuid` when known, else repo location; label = the
  `uuid.log` description, falling back to the remote name; one Graphviz `subgraph
  cluster_<hostname>` per host, labelled with the first dot-component of the hostname;
  fill colours green/red/grey/white by trust level.
* **`--json` shape** (`outputJSONMap`) `[src]`:

```json
{"nodes":[{"description": "...", "uuid": "...|null", "url": "...",
           "remotes":[{"remote": "name|null", "uuid": "...|null", "url": "..."}]}]}
```

  Repositories (and remotes) whose trust level is `DeadTrusted` are **filtered out**.

`CHANGELOG` `[src]`: `map: Support --json option.` and `map: Improve display of remote
names.` shipped in **10.20250605**; `map: Fix buggy handling of remotes that are bare git
repositories accessed via ssh` and `map: Avoid looping forever with mutually recursive
paths` shipped in **10.20250520**. The branchable todo opened from issue #1 is closed
`[[done]]` `[src]`.

### What `git annex map` does **not** give us

| Missing | Needed by |
|---|---|
| Any ahead/behind information; no refs are fetched at all | #5, #6 |
| Branch names, worktrees, unmerged branches | #5 |
| Special-remote *configuration* (type, encryption, exporttree/importtree) — only the UUID appears | #1 |
| bare-vs-worktree flag in the JSON | #1 |
| DataLad dataset UUID, `rad` RID/NID | #1 |
| Submodule/subdataset edges | #4 |
| Forge-side discovery (forks, upstream, network) | #6 |
| Dead remotes as an explicit *warning* — `--json` drops them entirely | #1 (explicitly wants them flagged) |
| Duplicate-`annex.uuid` detection — `combineSame` silently **merges** them, which is exactly the error condition #1 wants to surface | #1 |
| Persistence / incremental re-walk / caching | #1, interactive UI |
| Parallelism, per-host timeouts, depth or budget limits | any real crawl |
| Host identity beyond the literal hostname string — `typhon` and `typhon.dartmouth.edu` become two clusters | #1 |
| `proxy.log` / `cluster.log` edges (git-annex proxies and clusters) | #1 |
| https/S3/other non-ssh remotes are never contacted, even when they *are* reachable git repos (e.g. a GitHub clone) | #1, #6 |

**Recommendation:** shell out to `git annex map --json` where git-annex ≥ 10.20250605 is
available, treat its output as one *collector* among several, and keep our own richer
node model. Reimplementing the ssh-config-scraping trick is not worth it; extending
around it is.

## A.2 The `git-annex` branch — the map you can read without ssh-ing anywhere

This is the single most under-exploited source. Layout from `doc/internals.mdwn` `[src]`:

| File in `git-annex` branch | Content | Worldmap value |
|---|---|---|
| `uuid.log` | `<uuid> <description> timestamp=<t>` per known repo | **The roster of every clone.** Descriptions are conventionally `user@host:/path` |
| `remote.log` | `<uuid> k=v k=v ... timestamp=` for special remotes; `autoenable=true`; `cipher=` for encrypted | Special-remote nodes with type/encryption/`exporttree`/`publicurl` |
| `trust.log` | `<uuid> 1|0|?|X timestamp=` (trusted/untrusted/semi/dead) | Node colouring, dead-remote warnings |
| `group.log`, `preferred-content.log`, `required-content.log`, `group-preferred-content.log`, `maxsize.log` | policy per uuid | Why content lives where; balancing hints |
| `export.log` | `<t> <exporter-uuid>:<remote-uuid> <tree-sha> [<in-progress-sha>...]` | Export edges + which tree each export mirrors |
| `proxy.log` | `<t> <proxy-uuid> <uuid>:<remotename> ...` | **Extra edges**: which repos are reachable *via* a proxy |
| `cluster.log` | `<t> <cluster-uuid> <node-uuid>...` | Cluster grouping nodes |
| `aaa/bbb/<key>.log` | `<t> 1|0|X <uuid>` per key | Per-uuid content presence ⇒ **shared/unique content size between any two clones**, i.e. issue #1's `{shared,unique}-content-size`, computed offline |
| `aaa/bbb/<key>.log.web` | URLs per key | Web/`addurl` provenance edges |
| `aaa/bbb/<key>.log.cid`, `.log.cnk`, `.log.rmt`, `.log.met`, `.log.rmet` | per-remote content ids, chunking, remote state, metadata | secondary |
| `difference.log`, `activity.log`, `schedule.log`, `transitions.log`, `multicast.log` | misc | node badges |

**Measured demonstration** (`OpenNeuroDatasets/ds005256`, the very dataset from issue #1)
`[run]`:

```
$ git init --bare gab && cd gab
$ git remote add origin https://github.com/OpenNeuroDatasets/ds005256
$ git config remote.origin.promisor true
$ git config remote.origin.partialclonefilter blob:none
$ git fetch --depth 1 --filter=blob:none origin refs/heads/git-annex:refs/heads/git-annex
   # 1.58 s, repo grows to 8.1 MB
$ git show git-annex:uuid.log        # 0.48 s (fetches just that blob on demand)
```

Result — 14 repositories, unedited:

```
40795e62-...  bids@rolando:/inbox/BIDS/Wager/Wager/1076_spacetop.git
52fad46d-...  s3-PUBLIC
590b4fd0-...  bids@rolando:/inbox/BIDS/Wager/Wager/1076_spacetop
5977e022-...  yoh@typhon:/tmp/ds005256
5ded375b-...  openneuro
620673e7-...  f0042x1@discovery7.hpcc.dartmouth.edu:/dartfs-hpc/.../1076_spacetop
73e9e7ca-...  yoh@lena:~/proj/dbic-datasets/1076_spacetop
8028ca7a-...  f0042x1@discovery7.hpcc.dartmouth.edu:/dartfs-hpc/.../dartmouth
930e5e3f-...  OpenNeuro
9441b7fd-...  h@h-MacBook-Pro.local:~/Documents/projects_local/1076_spacetop
97b6f5e4-...  yoh@typhon:/mnt/DATA/data/yoh/1076_spacetop
b14a3911-...  yoh@lena:~/datasets/1076_spacetop
e5f1e780-...  s3-PUBLIC
fa9e758a-...  yoh@smaug:/mnt/btrfs/datasets/incoming/yoh/1076_spacetop
```

plus `trust.log` marking `52fad46d` **dead**, and `remote.log` giving the three special
remotes in full, e.g.:

```
e5f1e780-... autoenable=true bucket=openneuro.org exporttree=yes encryption=none
             fileprefix=ds005256/ host=s3.amazonaws.com name=s3-PUBLIC partsize=1GiB
             publicurl=https://s3.amazonaws.com/openneuro.org type=S3 versioning=yes
5ded375b-... encryption=none externaltype=openneuro name=openneuro type=external
             url=https://openneuro.org/git/0/ds005256
```

Compare this against the `git annex map` graphviz pasted in issue #1: the same hosts
(`rolando`, `typhon`, `smaug`, `lena`, `discovery7`, a MacBook), the same UUIDs. **One
anonymous HTTPS fetch reproduced most of a map that otherwise required ssh access to
four institutions.**

**What the annex branch cannot tell you** (and therefore what ssh/forge steps are
actually for):
* the **git remote URLs configured inside each other clone** — that lives in each
  clone's `.git/config`, nowhere in the branch. So *nodes* come cheap; *edges between
  remote nodes* still need `git annex map`-style scanning (or the registry).
* whether a UUID is bare vs worktree, its git-annex version, whether it still exists.
* branch/commit state of other clones (issue #5) — nothing in the branch tracks that.
* Descriptions are **free text**. `user@host:path` is a strong convention (git-annex
  generates it by default) but must be parsed defensively and never trusted as identity.

## A.3 Other git-annex commands worth wiring in

* `git annex info --json` `[src]` — options `--fast` (only cheaply-gathered info),
  `--json`, `--bytes`, `--show=<name>` (repeatable, restricts work), `--batch`, `-z`,
  `--autoenable`, `--dead-repositories`. Emits `"trusted repositories"`,
  `"semitrusted repositories"`, `"untrusted repositories"` lists (via
  `Remote.prettyPrintUUIDs`, which handles the JSON rendering) `[src]`. `--fast` is the
  right default for a walker; the non-fast path walks the whole worktree.
* `git annex whereis [--all|--key=K|--branch=REF] [--json]` — **"does not contact remotes
  to verify if they still have the content of files. It only reports on the last
  information that was received"** `[src]`. So it is a pure read of the annex branch:
  cheap, and safe to run on every clone.
* `git annex map --fast --json` — writes `.git/annex/map.dot` instead of launching
  `xdot` `[src]`.
* No graph/map UI exists in the **webapp/assistant** — `Command/Map.hs` is referenced
  only from the CLI command table; nothing under `Assistant/` uses it `[src]`. The
  webapp offers repository lists/configurators, not a topology view. So issue #1's UI is
  genuinely new work.
* `git-remote-annex` / `annex::` URLs: a git repo can itself be stored *on* a special
  remote (`doc/internals.mdwn` points to `doc/git-remote-annex`) `[src]` — such a remote
  is both an edge and a node and will need its own rendering.

## A.4 DataLad

**`datalad subdatasets`** parameters today `[src]`: `-d/--dataset`, `path...`, `--state`,
`--recursive`, `--recursion-limit`, `--contains`, `--bottomup`, `--set-property NAME
VALUE`, `--delete-property NAME`. There is deliberately **no property-based filtering** —
which is exactly what issue #4 complains about.

**PR [datalad/datalad#7820](https://github.com/datalad/datalad/pull/7820)** (yarikoptic,
**draft/open**) `[web]` adds `--r-filter EXPR` to ~20 recursive commands (`get`, `drop`,
`foreach-dataset`, `clean`, `update`, `status`, `diff`, `save`, `push`, ...) with syntax
`KEY=VALUE`, `KEY!=VALUE`, `KEY~=REGEX`, `KEY!~REGEX`, `KEY?`, `KEY!?` (multiple filters
ANDed), a `datalad.recursion.filter` config default, and a computed
`.relative-url-in-tree` property that detects BIDS-style interlinked subdatasets
(`derivatives/*/inputs` → `sourcedata/raw`). Example:
`datalad get -r --r-filter '.relative-url-in-tree!=present'`.
**Relevance:** the walker's subdataset-expansion policy should adopt the same filter
vocabulary rather than invent one, and `.relative-url-in-tree` is precisely the
"subdatasets that are clones of each other" case in issue #4.

**datalad-registry** (`datalad/datalad-registry`, Flask + PostgreSQL + Celery) `[src]`:

* API prefix **`/api/v2`**; resources `dataset-urls` and `url-metadata`
  (`API_URL_PREFIX = "/api/v2"`, `DATASET_URLS_PATH = "dataset-urls"`).
* `GET /api/v2/dataset-urls` query parameters: `search` (its own query language),
  `url`, **`ds_id` (a UUID — this is the "query by dataset UUID" issue #6 asks for)**,
  `min/max_annex_key_count`, `min/max_annexed_files_in_wt_count`,
  `min/max_annexed_files_in_wt_size`, `earliest/latest_last_update`,
  `min/max_git_objects_kb`, `processed`, `cache_path`,
  `return_metadata=reference|content`, `page`, `per_page`, `order_by`, `order_dir`.
* `POST /api/v2/dataset-urls` submits a URL for (re)processing; `GET
  /api/v2/dataset-urls/{id}` fetches one.
* Stored per URL (`RepoUrl` model): `url`, `ds_id`, **`annex_uuid`**, `annex_key_count`,
  `annexed_files_in_wt_count`, `annexed_files_in_wt_size`, **`head`**, `head_describe`,
  `head_dt`, **`branches` (JSONB)**, `tags`, `git_objects_kb`, `last_update_dt`,
  `processed`, `cache_path`.
* `branches` is built by `get_origin_branches()` as
  `{branch_name: {"hexsha": ..., "last_commit_dt": ...}}` from
  `for-each-ref refs/remotes/origin/` `[src]`.
* Search-language fields: `url`, `ds_id`, `head`, `head_describe`, `tags`, plus
  `branches:` (ILIKE over the JSON text) and `metadata[extractor]:` `[src]`.
* **No URL normalisation** is performed — `url` is the unique key verbatim `[src]`. Our
  harmonisation layer therefore cannot rely on the registry to dedupe; it must query
  several spellings.

> **This is the single best "pre-view without cloning" backend for issue #6.** Given a
> dataset UUID you get every registered clone URL *and each one's per-branch SHAs and
> commit dates* in one request. Ahead/behind against your local clone is then a local
> `git merge-base --is-ancestor` / `rev-list --count` once you have those SHAs (or, if
> the SHA is unknown locally, a single `--filter=tree:0` fetch).

**datalad-usage-dashboard** (`datalad/datalad-usage-dashboard`, package
`find-datalad-repos`) `[src]`: GitHub-Actions-driven crawler that searches **GitHub, OSF,
GIN, hub.datalad.org, and ATRIS** for repos that are DataLad datasets or used
`datalad run`. Output `datalad-repos.json` is public, unauthenticated, **7,244,421 bytes**
`[run]` at
`https://raw.githubusercontent.com/datalad/datalad-usage-dashboard/master/datalad-repos.json`,
and is consumed by datalad-registry's `usage_dashboard_sync` Celery task `[src]`.
Current README counts `[src]`: GitHub 5,915 "in the wild" + 6,632 "inner-circle" + 271
gone; OSF 199 + 83 gone; GIN 974 + 14 gone; hub.datalad.org 4,628 + 1 gone; ATRIS 115.
Record schema: `{name, url, status}` plus per-host extras (`stars`, `dataset`, `run`,
`container_run`, `id`).

**datalad-metalad `metalad_core`** `[src]` (`datalad_metalad/extractors/core.py`) already
emits most of issue #1's node schema:
* `@id` = refcommit SHA, `identifier` = dataset UUID, `@type: Dataset`;
* `hasPart` including subdatasets keyed by `gitmodule_datalad-id` and pinned
  `gitshasum` — the subdataset graph of issue #4;
* **`distribution`**: one entry per configured git remote `{name, url (normalised via
  `RI`/`ri2url`), "@id": "datalad:<annex-uuid>"}`, **plus** every UUID from
  `repo.repo_info(fast=True)`'s `trusted/semitrusted/untrusted repositories` that has no
  remote — i.e. exactly "clones I know of but am not connected to";
* the local/`00000000-...-0001`/`-0002` pseudo-UUIDs are skipped;
* controlled by `datalad.metadata.datalad-core.report-remotes`.
The file's own TODO says: *"dataset metadata - known annex UUIDs - avoid anything that is
specific to a local clone (repo mode, etc.) limit to description of dataset(-network)"* —
which is the same tension issue #1 has between per-clone facts and network facts. Adopt
`metalad_core` as the *record* format and add clone-specific fields in a sibling
namespace rather than fighting it.

**RIA stores** (from `datalad/distributed/create_sibling_ria.py` docstring) `[src]`:
* URL forms: `ria+ssh://[user@]host:/abs/path`, `ria+file:///abs/path`, plus
  `#<dataset-UUID>` or `#~<alias>` for a dataset, and `@<branch-or-tag>` for a version.
* Store tree: per-dataset directory named from the **DataLad dataset ID** split as
  `124/68afe-59ec-11ea-93d7-f0d5bf7b5561`; inside, a **standard bare git repo** plus an
  `annex/` object store (the storage sibling), optionally `archives/` with 7z archives.
* `ria-layout-version` at the store root **and** per dataset; `alias/` holds symlinks
  enabling `#~alias`; error logs are named `<dataset id>.<annex uuid of the remote>.log`.
* The `annex/` store uses **`dirhashmixed`**, unlike a normal annex — never run git-annex
  commands in-store; go through the ORA special remote.
* **Walker consequences:** a RIA store is *directly enumerable* — `ls` the store root and
  you have every dataset UUID it holds, and each dataset dir is a bare git repo you can
  `git ls-remote`/`fetch --filter=tree:0` over ssh with **no DataLad and no git-annex on
  either end**. That makes the BABS/mechababs case in issue #5 (a RIA accumulating
  per-subject result branches) cheap to render: one `ls-remote` per dataset gives every
  `job-<subject>` branch and its SHA.

**forgejo-aneksajo / DataLad Hub** `[web]` (codeberg.org unreachable here): a *soft fork*
of Forgejo adding git-annex support, rebased onto each Forgejo release and tagged
`v<x.y.z>-git-annex<n>`; it powers `hub.datalad.org` (4,628 repos per the usage
dashboard `[src]`). Practical implication: **hub.datalad.org speaks the Gitea/Forgejo
REST API**, so the same forge plugin covers Codeberg, Gitea, Forgejo, *and* DataLad Hub —
and `find-datalad-repos` already has a working `HUB_DATALAD_ORG_TOKEN` code path `[src]`.

**Existing visualisation in this ecosystem:** essentially none. datalad-registry ships a
single `overview.html` table template with no charting/graph code `[src]`; `git annex map`
emits Graphviz; `datalad subdatasets` prints a tree. Issue #1's interactive graph has no
prior art to inherit UI from.

---

# Part B — forge & discovery APIs

| Source | Endpoint / command | Auth | Rate limit | Yields | Verdict |
|---|---|---|---|---|---|
| GitHub REST forks | `GET /repos/{o}/{r}/forks?sort=&per_page=&page=` | optional | unauth **60/h per IP**; PAT **5,000/h**; GHEC-owned app on your behalf **15,000/h**; app installation min **5,000/h**, `+50/h` per repo over 20 and per user over 20, capped **12,500/h**; GHEC installation **15,000/h** `[src]` | direct (1-level) forks only | **Use**, but recurse manually for fork-of-fork |
| GitHub repo object | `GET /repos/{o}/{r}` → `fork`, `parent.full_name`, `source.full_name`, `forks_count`, `network_count`, `default_branch` | optional | as above | upstream + root of fork network | **Use** — cheapest way to find "the upstream I don't have as a remote" (issue #1) |
| GitHub **Network graph** (Insights→Network) | **web UI only** | — | — | branch history across the whole fork network, **"up to 100 of the most recently pushed-to branches"** `[src]` | **No API.** Docs describe it purely as a UI feature |
| GitHub `/network/meta`, `/network/chunk` | undocumented JSON behind the network UI | — | — | fork network + commit chunks | `[UNVERIFIED]` — could not reach github.com through this sandbox's proxy and web search found no corroboration. Treat as folklore; do not build on it |
| GitHub compare | `GET /repos/{o}/{r}/compare/{base}...{head}`; cross-fork `USER:REF...USER:REF` | optional | as above | `ahead_by`, `behind_by`, `total_commits`, `commits[]`, `files[]` | **Use for #5/#6 on GitHub** — one request, no clone. `[web]` (docs page is autogenerated and unreachable here) |
| GitHub GraphQL | `repository { forks(first:100) { nodes { ... } } }` | required | 5,000 points/h (observed `graphql.limit: 5000` on this session's token `[run]`) | forks + refs + `defaultBranchRef.target.oid` in one round trip | Likely the best batching for GitHub `[UNVERIFIED]` shape |
| GitHub rate-limit probe | `GET /rate_limit` | optional | free | current budgets | Observed here: `core.limit 15000`, `search.limit 30`, `graphql.limit 5000` `[run]` |
| GitHub secondary limits | — | — | ≤100 concurrent requests (shared REST+GraphQL); ≤900 points/min per REST endpoint; ≤2,000 points/min GraphQL; ≤90 s CPU per 60 s wall `[src]` | — | **Design the crawler to obey these**, they bite before the primary limit |
| GitLab forks | `GET /api/v4/projects/:id/forks?per_page=` | none for public | header `ratelimit-limit: 500`, `ratelimit-name: throttle_unauthenticated_api` (per minute) `[run]` | fork list | **Verified working unauthenticated** `[run]` |
| GitLab project | `GET /api/v4/projects/:id` → `forks_count`, `forked_from_project.path_with_namespace`, `default_branch` | none for public | as above | upstream pointer | **Verified** `[run]` (`cmprinho/gitlab` → `gitlab-org/gitlab`) |
| Gitea / Forgejo / Codeberg / **hub.datalad.org** | `GET /api/v1/repos/{owner}/{repo}/forks`; also `/compare/*`, `/branches` | token optional for public | instance-configured | forks, branches, compare | **Verified in `go-gitea` router source** (`m.Combo("/forks").Get(repo.ListForks)`, `m.Get("/compare/*", ...)`) `[src]` |
| Bitbucket, sourcehut | — | — | — | — | Not verified here; ecosyste.ms ships working `Hosts::Bitbucket` and `Hosts::Sourcehut` adapters `[src]`, so APIs exist and are usable — borrow their field mappings |
| **Software Heritage** origin search | `GET /api/1/origin/search/{url_pattern}/?limit=&with_visit=&visit_type=&use_ql=` | optional | `swh_api_origin_search` **10/min**; global `swh_api` **120/h** anon (`1200/h` authenticated `[web]`); `limit` bounded to 1000 `[src]` | every archived origin URL matching a substring | **Genuine discovery source** for public clones ("find every URL containing `ds005256`") |
| SWH origin/visits | `GET /api/1/origin/{url}/get/`, `/visits/`, `/visit/latest/` (`swh_api_origin_visit_latest` 700/min `[src]`), `GET /api/1/snapshot/{id}/` | optional | as above | per-visit **snapshot** = the full branch→target map at crawl time | **Historical `ls-remote` for free** — gives past refs of clones that may now be gone |
| SWH **graph** ("which origins contain this commit") | `GET /api/1/graph/visit/nodes/swh:1:snp:...?direction=backward&resolve_origins=true` | **authenticated + special permission `API_GRAPH_PERM`**; `max_edges` clamped by anonymous/user/staff role | — | backward traversal → origins | **The killer query is gated.** Source: *"That endpoint is not publicly available and requires authentication and special user permission in order to be able to request it."* `[src]`. Worth requesting access; do not depend on it |
| **Radicle** | `rad .` (RID), `rad self` (DID, home, storage), `rad node status` (NID), `rad inspect --payload`, `rad ls --all`, `rad node routing`, `rad node inventory <nid>`, `rad seed`, `rad remote` | local node | — | RID `rad:z3gq…`; NID `z6Mkr…`; addresses `NID@host:port`; a git remote **per delegate** plus the `rad` remote | **Use exactly as issue #1 asks.** `rad node routing` is the P2P analogue of a fork network: RID → which nodes hold it `[src]` |
| ForgeFed / ActivityPub | — | — | — | — | `[web]` Spec alive since 2019, Forgejo the main implementer; v14/v15 ship *federated starring/following*, cross-instance PRs still future. **Not usable for clone discovery in 2026** |
| **ecosyste.ms repos** | `GET /api/v1/repositories/lookup?url=`, `/api/v1/hosts`, `/api/v1/hosts/{host}/repositories/{owner}/{repo}`, `/api/v1/hosts/{host}/owners/{login}/repositories`; OpenAPI at `/docs` | none | **5,000 req/h per IP** (README) `[src]` | per repo: `fork`, `forks_count`, **`source_name`** (its upstream), `latest_commit_sha`, `pushed_at`, `default_branch`, `archived`, `topics`, `previous_names` `[src]` | **Strong cross-forge index.** Host kinds implemented: `github, gitlab, gitea, forgejo, bitbucket, sourcehut` `[src]` — also the best existing model for our own forge-plugin interface |
| deps.dev / libraries.io / grep.app / Sourcegraph | — | — | — | package- or code-centric | **Low value** for clone topology; they index *packages* and *code*, not clone lineage |
| GH Archive / PushEvent streams | — | — | — | push events per repo | `[UNVERIFIED]`; heavy, and superseded by ecosyste.ms for our purpose |
| **datalad-registry** | `GET /api/v2/dataset-urls?ds_id=<uuid>` (see A.4) | none | not enforced in code `[src]` | clone URLs + `head` + `branches{hexsha,last_commit_dt}` + `annex_uuid` | **Top-tier for #6** |
| **datalad-usage-dashboard** | `GET raw.githubusercontent.com/.../datalad-repos.json` | none | GitHub raw limits | ~12.5k GitHub + GIN + hub + OSF + ATRIS DataLad repos, 7.24 MB `[run]` | **Bulk seed list**; refresh daily, cache locally |

### Forge-plugin design note

`ecosyste-ms/repos` `Hosts::Base` already defines exactly the plugin surface issue #1
sketches `[src]`: `url`, `html_url`, `source_url`, `raw_url`, **`compare_url(repo, a, b)`**,
**`forks_url`**, `download_url`, `host_api_client`, `fetch_repository(id_or_name, token)`,
`update_from_host(repository, token)`, `download_fork_source?`, and
`recently_changed_repo_names(since)`. Copying that interface (six implementations already
exist and are maintained) is cheaper than designing a new one.

---

# Part C — cheap remote-state cookbook (the aheadness problem)

All timings measured in this session against `github.com` over the sandbox's HTTPS proxy,
git 2.43.0 `[run]`. Absolute latency will differ; the *ratios* and the byte counts are the
point.

### C.1 Refs only — ~0.45 s, ~1 RTT

```bash
git ls-remote <url>                    # ALL refs
git ls-remote --heads <url>            # branches only
git ls-remote --symref <url> HEAD      # + which branch HEAD points at
git ls-remote <url> 'refs/heads/*'     # protocol v2 ls-refs ref-prefix filter
```

Measured on `datalad/datalad` `[run]`:

| Variant | Refs returned | Bytes | Wall |
|---|---|---|---|
| all refs | 4,498 (incl. `refs/pull/*`) | 275,761 | **0.64 s** |
| `--heads` | 26 | ~2 KB | **0.44 s** |
| single ref-prefix | 1 | ~100 B | **0.46 s** |

Interpretation: cost is **dominated by TCP+TLS+auth setup (~0.45 s floor)**, not by ref
count. Filtering refs saves bytes, not round trips. On GitHub, `refs/pull/*` is 99% of the
noise — always pass `--heads` or an explicit ref-prefix. `ls-remote` alone answers
"has anything changed since I last looked?" for **every** remote, including ssh, and needs
no write access.

### C.2 Commit DAG without file content — ~1 s, ~7 MB for 17.8k commits

```bash
git init --bare probe && cd probe
git fetch --filter=tree:0 <url> refs/heads/master:refs/heads/master     # commits only
git rev-list --count master                                            # local, instant
git fetch --filter=tree:0 <url> refs/heads/maint:refs/heads/maint       # incremental
git rev-list --left-right --count master...maint                       # "0    8"
```

Measured `[run]`:

| Operation | Wall | Bare repo size |
|---|---|---|
| `--filter=tree:0` fetch of 17,784-commit branch | **1.08 s** | **6.8 MB** |
| second branch, incremental | **0.72 s** | 6.8 MB (no growth) |
| `--filter=blob:none` fetch of same branch | 1.79 s | 13 MB |
| `--depth 1` fetch of the `git-annex` branch | 2.27 s | 18 MB |
| `--depth 1 --filter=blob:none` of `git-annex` branch | **1.58 s** | **8.1 MB** |
| on-demand blob fetch of `uuid.log` after the above | 0.48 s | — |

**Rule of thumb:** to *count* commits you need commits only → `--filter=tree:0`. To *read
files* (`uuid.log`, `.gitmodules`, `.datalad/config`) you need `--filter=blob:none` plus
a promisor remote so individual blobs are fetched on demand. Never `--filter=blob:none`
when `tree:0` suffices — it doubled the transfer here.

Caveat: `--depth 1` and `--filter=tree:0` are mutually antagonistic for ahead/behind —
a shallow fetch cannot count commits. Use `tree:0` *unshallow* for counting, `--depth 1`
only when you want a single tree's files (like the annex branch).

### C.3 Ahead/behind, once you have both tips

```bash
git rev-list --left-right --count <local>...<remote>   # "behind   ahead"
git rev-list --count <local>..<remote>                 # commits remote has that I lack
git merge-base --is-ancestor <remote> <local>          # exit 0 ⇒ remote adds nothing
                                                       #   (⇒ "grey out", issue #6)
git for-each-ref --format='%(refname:short) %(objectname) %(committerdate:iso8601-strict)'
```

For issue #6's "grey out clones with no new commits": run `merge-base --is-ancestor` per
branch — pure local, microseconds.

### C.4 Asking the remote what it has, without a packfile

```bash
git fetch --negotiate-only --negotiation-tip=master <url>
```
`[run]` — returns the common-ancestor SHAs and **no packfile** (exit 0, prints
`755752d…`). Use to answer "is the remote strictly behind me / already has my tip?"
in one round trip when you don't want its history at all.

### C.5 Zero-network aheadness

* Every clone already caches remote state in `refs/remotes/<remote>/*` — issue #5's
  observation that "remotes are just cached locally info about state of the clones". Show
  that immediately with a staleness timestamp, and refresh lazily.
* `git worktree list --porcelain` + `git for-each-ref refs/heads` gives the local
  worktrees and their unmerged branches issue #5 wants, with zero I/O.
* `git annex whereis --json` / `git annex info --fast --json` never contact remotes
  `[src]` — safe to run on every local clone in the inventory pass.
* `uuid.log` from an already-fetched `git-annex` branch enumerates all known repos with no
  network at all (Part A.2).

### C.6 Forge shortcuts (no git protocol at all)

* GitHub: `GET /repos/{o}/{r}/compare/{base}...{head}` → `ahead_by`/`behind_by` `[web]`.
* GitLab / Gitea / Forgejo: `/compare` endpoints exist `[src]`; branch listing endpoints
  give SHAs directly.
* datalad-registry: `branches[*].hexsha` is a cached `ls-remote` for registered clones
  `[src]` — zero cost to *you*, at the price of staleness (`last_update_dt` tells you how
  stale).
* SWH: `/api/1/origin/{url}/visit/latest/` → snapshot → full branch map at last crawl
  `[src]`.

### C.7 Things deliberately *not* recommended

* Full `git clone` for state inspection — orders of magnitude more expensive than
  `tree:0` and pointless for counting.
* `git bundle` / bundle-URIs — a server-side optimisation for *clone bootstrapping*, not
  a query mechanism `[UNVERIFIED]` for our purposes.
* Scraping the GitHub network graph HTML — brittle, undocumented, and rate-limit hostile.

### C.8 Cost summary

| Question | Cheapest verified answer | Cost |
|---|---|---|
| Does remote X exist / is it reachable? | `git ls-remote --heads` | ~0.45 s, ~2 KB |
| What branches does it have and at what SHAs? | same | same |
| How many commits ahead? | `--filter=tree:0` fetch + `rev-list --count` | ~1 s, ~7 MB once, ~0.7 s / 0 MB after |
| Does it add anything at all? | `merge-base --is-ancestor`, or `--negotiate-only` | local / 1 RTT |
| What other clones exist? | `git-annex` branch `uuid.log` | ~1.6 s, ~8 MB |
| What special remotes exist and how configured? | `git-annex` branch `remote.log` | included above |
| Which clones are dead? | `git-annex` branch `trust.log` | included above |
| Who else on the internet has this dataset? | datalad-registry `?ds_id=`, usage-dashboard JSON, ecosyste.ms, SWH origin search | 1 HTTP request each |
| Who forked this repo? | forge forks API | 1 request per 100 forks |

---

# Security, consent, and the ethics of auto-ssh spidering

This is the part of issue #1 that most needs an explicit design decision, because the
feature as described — *"walker should be able to continue walking if host was configured
to forward ssh identity"* — is, mechanically, an **automated credentialed lateral-movement
tool**. That is not a reason not to build it; it is a reason to build it with the safety
rails that `git annex map` (which already does this, minus the rails) lacks.

**What actually happens on the wire.** `git annex map` runs, per discovered ssh remote
`[src]`:

```
ssh <host> 'sh -c "if ! cd <dir> 2>/dev/null; then cd <dir>.git; fi && git config --null --list"'
```

falling back to `git-annex-shell configlist`. So: arbitrary shell on a third-party host,
driven by strings taken out of a `.git/config` we did not write.

### Risks

1. **Untrusted input drives connections.** Remote URLs come from other people's configs
   and from `uuid.log` descriptions. A crafted remote URL can point the walker at a host
   of the attacker's choosing; historically, git URL parsing has had option-injection
   issues of the `ssh://-oProxyCommand=…` family `[UNVERIFIED]` for specific CVEs, but the
   class is real. **Mitigation:** parse and re-emit URLs through a strict parser
   (`giturlparse` handles github/gitlab/bitbucket/assembla/friendcode `[src]` — note it
   has **no** gitea/forgejo/sourcehut/`ria+ssh`/`annex::` parsers, so we need our own
   layer anyway); reject hostnames/paths starting with `-`; never pass user strings as
   ssh options; use `--` separators.
2. **Agent forwarding is transitive trust.** If you `ssh -A` into host B to keep walking,
   anyone with root on B (or any process able to reach the forwarded socket) can
   authenticate as you to every host your key opens — while the connection lives.
   **Mitigation:** default `ForwardAgent no`; prefer `ProxyJump`/`-J` (which keeps the
   private key on the origin machine) over agent forwarding; if forwarding is
   unavoidable, use a per-walk key and `ssh-add -c` (confirmation) / `-t` (timeout).
3. **Spidering into hosts you were never asked to touch.** A discovered host may belong
   to a collaborator's institution. Automated connections from an unfamiliar source can
   trip intrusion detection, violate acceptable-use policies, or simply be rude.
   **Mitigation:** **default deny.** ssh only to hosts on an explicit allowlist
   (`--ssh-host <pattern>`, repeatable, plus a config file); everything else is recorded
   as an *unvisited* node with a "click to visit" affordance in the UI. Always support
   `--dry-run` that prints the exact command per host before anything runs.
4. **Write risk.** Nothing in the walker should ever mutate a remote. Enforce it: only
   `git config --list`, `git ls-remote`, `git for-each-ref`, `git annex info --fast`,
   `git annex whereis`, `ls`. No `fetch` *into* a remote clone, no `git gc`, no
   `git annex sync`.
5. **The map itself is sensitive.** The verified `uuid.log` dump in A.2 contains
   institutional hostnames, login names (`bids@`, `f0042x1@`, `yoh@`), absolute paths
   inside HPC filesystems, and a personal laptop's hostname — from a **public** GitHub
   repo. A rendered worldmap is an infrastructure diagram. **Mitigation:** ship a
   redaction mode (hash or elide usernames/paths/hostnames) and make *exporting/sharing*
   a deliberate, defaulted-off action; warn on export that descriptions may contain PII.
6. **Password prompt storms.** The man page warns you may have to enter a password
   several times `[src]`. **Mitigation:** `ControlMaster=auto` + `ControlPersist` — which
   is exactly what git-annex itself does (`Annex/Ssh.hs`: `-o ControlMaster=auto -o
   ControlPersist=yes`, gated by `annex.sshcaching`) `[src]`. Reuse one master per host
   for the whole walk; never prompt more than once per host; support `BatchMode=yes` for
   unattended runs so the walker fails fast instead of hanging on a prompt.
7. **Forge API abuse.** Fork enumeration can burn a 60/h unauthenticated budget in one
   click. Respect `x-ratelimit-*` and `retry-after`; obey GitHub's ≤100-concurrent and
   ≤900-points/min secondary limits `[src]`; cache aggressively with ETags.

### Host identity and loop avoidance

Hostnames are **not** identities: `typhon`, `typhon.dartmouth.edu`, an IP, and a
`~/.ssh/config` alias are one machine; `localhost` is a different machine from every
node's point of view. `git annex map` clusters purely on the hostname string `[src]`, so
it splits and merges hosts wrongly. Better identity keys, in decreasing strength:

| Level | Key | How obtained | Notes |
|---|---|---|---|
| repo | `annex.uuid` | `git config annex.uuid` | strongest; **duplicates are the error issue #1 wants flagged** — do not silently merge them the way `combineSame` does |
| repo | DataLad `ds_id` | `.datalad/config` `datalad.dataset.id` | same across clones by design; identifies the *dataset*, not the clone |
| repo | `(device, inode)` of `.git` | `stat` | catches bind mounts / hardlinked copies on one host |
| host | ssh **host key fingerprint** | `ssh-keyscan -t ed25519 <host>` | best remote-safe identity; survives DNS aliases; note shared keys in HA clusters |
| host | `/etc/machine-id` | read on the host | Linux-only; the spec asks that it be treated as confidential — hash it (e.g. HMAC with a walk-local salt) rather than storing it |
| host | `hostname -f` + interface addresses | on the host | weak; NAT and containers break it |
| host | URL authority string | parse | weakest; what `git annex map` uses |

**Loop avoidance:** maintain a visited set keyed by `(host-identity, realpath)` *and* by
`annex.uuid`; enforce `--max-depth`, a global node budget, a per-host connection timeout,
and a per-command timeout. Record, for every node, **how it was discovered** (provenance
edge: "seen as remote `origin` of X", "listed in `uuid.log` of Y", "fork of Z per GitHub")
— this is what makes the graph auditable and lets a user revoke a whole discovery branch.

---

# What the walker should do, step by step

A concrete crawl algorithm. Phases 0–3 are free/local; 4–5 are cheap network; 6 is
consented ssh; 7 is opt-in discovery.

**Phase 0 — seed and normalise.**
Inputs: local paths, URLs, RIA store URLs, `datalad-registry` queries.
Build a `Node` keyed by a canonical identity tuple
`(annex_uuid | ds_id | normalised_url | (host_id, realpath))`.
Normalisation: strip trailing `/`, fold `.git` suffix *only for known forges* (on a local
filesystem `foo` and `foo.git` are different directories — issue #1 makes this point
explicitly), lowercase host, drop default ports, map `git@host:path` ⇄ `ssh://git@host/path`,
and handle `ria+ssh://…#uuid`, `annex::…`, `rad:…` as first-class schemes. Start from
`giturlparse` and extend `[src]`.

**Phase 1 — local inventory (no network).**
For each local repo: `git config --list`, `git remote -v`, `git rev-parse --is-bare-repository`,
`git worktree list --porcelain`, `git for-each-ref`, `.gitmodules` + `git submodule status`,
`.datalad/config` (`datalad.dataset.id`), `git annex version`, `git config annex.uuid`,
`git annex info --fast --json`, `rad .` and `rad self` when `rad` exists `[src]`.
Emit node attributes: bare/worktree, annex/no-annex, versions, IDs, worktree branch list.

**Phase 2 — harvest the `git-annex` branch (still local).**
Read `uuid.log`, `trust.log`, `remote.log`, `group.log`, `export.log`, `proxy.log`,
`cluster.log` out of `refs/heads/git-annex` (or `refs/remotes/*/git-annex`) `[src]`.
Every UUID becomes a node even if never contacted; parse `user@host:/path` descriptions
into *candidate* host/path hints (marked low-confidence). `remote.log` becomes
special-remote nodes with type/encryption/`exporttree`/`importtree`/`publicurl` badges —
directly satisfying issue #1's rendering list. `proxy.log`/`cluster.log` become extra
edges. Flag **duplicate `annex.uuid` across distinct nodes** as an error here.

**Phase 3 — subdataset/submodule expansion (issue #4).**
Recurse `.gitmodules`, keeping `gitmodule_datalad-id` and the pinned `gitshasum`
(same fields `metalad_core` records `[src]`). Support filter expressions in the
`--r-filter` vocabulary of PR #7820 so that YODA/BIDS interlinked subdatasets can be
collapsed (`.relative-url-in-tree`) `[web]`. Render subdataset edges distinctly from
remote edges — they are containment, not replication.

**Phase 4 — cheap remote probe (network, read-only, no ssh shell).**
For every remote URL, in parallel with a small worker pool and per-host politeness:
`git ls-remote --heads --symref` (~0.45 s each `[run]`). Diff against the locally cached
`refs/remotes/<name>/*` to get instant "N branches changed" without any fetch.

**Phase 5 — aheadness (issue #5).**
For remotes whose tips are unknown locally, fetch into a **shared bare probe repo** with
`--filter=tree:0` (1.08 s / 6.8 MB for 17.8k commits; incremental fetches are ~0.7 s and
free in space `[run]`). Then compute, per branch pair,
`git rev-list --left-right --count local...remote`, and `merge-base --is-ancestor` to grey
out clones with nothing new (issue #6). For RIA stores, enumerate dataset dirs by
`<first3>/<rest-of-uuid>` and `ls-remote` each — the BABS per-subject `job-*` branches
fall straight out `[src]`. Where a forge compare endpoint exists, prefer one API call over
a fetch.

**Phase 6 — ssh spidering (consented).**
Only for hosts on the allowlist. One `ControlMaster` per host, `ControlPersist`,
`BatchMode` for unattended runs, `ForwardAgent` off unless explicitly enabled per host
`[src]`. Per repo run the same read-only command set as Phase 1. Identify the host by ssh
host-key fingerprint (and optionally hashed `/etc/machine-id`) before recording anything.
Respect depth/budget/timeouts; record provenance. Where git-annex ≥ 10.20250605 exists
locally, `git annex map --json` can do this whole phase for the ssh subset — run it, merge
its `nodes[]` into our graph by UUID, and keep our extra attributes `[src]`.

**Phase 7 — discovery (issue #6, opt-in, never automatic).**
Query, in parallel, and present results as *candidates* to be previewed and then
explicitly "Add as remote":
* forge fork/parent APIs for each known forge URL (GitHub/GitLab/Gitea/Forgejo/DataLad Hub);
* `datalad-registry` `?ds_id=<uuid>` — returns clones **with `branches[*].hexsha`**, so the
  pre-view DAG can be drawn *before* adding anything `[src]`;
* `datalad-repos.json` bulk list (cached daily) `[src]`;
* ecosyste.ms `repositories/lookup?url=` for `source_name`/`fork` lineage across six forge
  kinds `[src]`;
* SWH `origin/search` for archived copies, and `origin/{url}/visit/latest` for their last
  known refs `[src]`;
* `rad node routing` / `rad node inventory <nid>` for Radicle replicas `[src]`.
Each candidate is rendered greyed-out if `merge-base --is-ancestor` says it adds nothing;
otherwise its "advance DAG" is drawn from a `--filter=tree:0` probe fetch.

**Phase 8 — persist.**
Store the graph in a form that supports incremental re-walk: nodes keyed by identity
tuple, edges typed (`remote`, `special-remote`, `submodule`, `export`, `proxy`, `cluster`,
`fork-of`, `radicle-delegate`), each with `first_seen` / `last_verified` / `provenance` /
`confidence`. Reuse the `metalad_core` record vocabulary (`identifier`, `distribution`,
`hasPart`) so the output is ingestible by DataLad metadata tooling, and add a
`ceptualization:` namespace for the clone-specific facts metalad deliberately avoids
`[src]`.

---

## Appendix — tools worth borrowing from

* **`myrepos` / `mr`** (`RichiH/myrepos` `[run]`) — declarative multi-repo registry with
  per-repo hooks; the `.mrconfig` model is a good fit for "the set of repos I want walked".
* **`vcstool`** (`dirk-thomas/vcstool` `[run]`) — YAML repos-file, parallel
  `import/status/pull` across VCSes; good CLI ergonomics to copy.
* **`gita`** (`nosarthur/gita` `[run]`) — side-by-side dashboard of many repos' branch and
  ahead/behind status; closest existing UX to issue #5's dashboard.
* **Ansible inventory** — the "hosts, groups, and per-host facts" model, plus the norm
  that connection targets are *declared*, not discovered. Adopt that norm for Phase 6.
* **`ecosyste-ms/repos` `Hosts::Base`** `[src]` — ready-made six-forge plugin interface.
* **`find-datalad-repos`** `[src]` — working `Searcher`/`Updater` abstraction over
  GitHub/OSF/GIN/Forgejo with rate-limit and abuse-detection handling already solved.
