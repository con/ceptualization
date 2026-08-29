# Repo-embedded things, and many collections over common nodes

Fourth follow-up. Three new inputs since the last document:

1. `orinoco/query-things` is now readable at
   [`con/query-things`](https://github.com/con/query-things) -- it was the
   biggest open unknown, and it **resolves a gap I previously reported**.
2. The store should live **inside each `.git/`** (e.g. under `orinoco/`), as
   transactions or as the graph itself, with the browser starting *from that
   repo as a node* and then reaching further via `ssh://` or `file:///`,
   triggering the same exploration remotely and aggregating locally.
3. Multiple **enrichment collections** -- research-group graphs, publication
   dumps such as [`dandi/dandi-bib`](https://github.com/dandi/dandi-bib) --
   distinct collections sharing **common nodes**: People, repositories, papers.

Read from source at: `con/query-things` `9263c69` (2026-08-19),
`dandi/dandi-bib` `74df570` (2026-08-22).

## 1. Correction: query-things already does the traversal I said was missing

The previous document concluded that dump-things offers "no way to ask *what
links to this pid*". That is true of the HTTP API, but **query-things
implements exactly that**, client-side, and more besides. It is a
`click`-based **Unix pipeline toolkit** (`query-things`, aliases `qrg`/`qri`)
over `dump-things-pyclient`, where records stream as JSON lines through
composable filters:

| Command | What it does |
| --- | --- |
| `list` | emit records from a collection |
| `filter-linked-pid <collection> <pid> <property>` | **forward**: keep piped records whose `pid` appears in `<pid>`'s `<property>` |
| `filter-links-pid --link <PROPERTY> <PID>` | **backward**: *"Filter records that link a specific object via a given property"* -- with a `recursive` mode |
| `inline-things` / `inline-records` | resolve pid references into nested objects; the head commit adds *"support for arbitrary nesting"* |
| `inject-links-pid` | add links into records |
| `render-record` | Jinja2 rendering |
| `cache` | memoise records read from stdin |

Two details matter more than the command list.

**It normalises association classes.** `filter-linked-pid` turns a property
value into `{'object': ...}` whether it was a bare pid, a list, or a list of
association-class instances, with the comment that this *"will make it easier
to extend the matching (ie. with time windows) later on"*. Qualified,
data-carrying edges are already first-class in the query layer -- and the
author has already anticipated **time-windowed** matching, which is precisely
what the observation/staleness layer needs.

**It resolves records across collections.** `_get_rec_from_any_collection`
takes a *tuple* of collections and returns the first hit for a pid, caching
misses as well as hits. So cross-collection identity resolution -- the exact
mechanism the "common nodes across many collections" requirement needs --
already exists and is already used by the recursive backward filter.

**Revised verdict on the stack:** dump-things is the store; query-things is the
query layer; the missing piece is narrower than I said. What is still absent is
an *index* (every backward query streams the candidate set through a filter,
which is O(collection) per hop and fine for thousands of records, not for
interactive expansion over millions) and anything graphical. The pipeline model
is also a genuinely good fit for a pluggable expander contract: an expander
that emits JSON lines composes with everything above for free.

## 2. Things in `.git/` -- verified mechanics, and what they force

The instinct is right and matches how git-annex already works, but the
placement detail decides whether the graph travels. I tested this rather than
assuming.

**Experiment.** In repo `A`: wrote `.git/orinoco/things.json`; created a real
orphan branch `orinoco` containing `things.json`; created a non-branch ref
`refs/orinoco/things` pointing at the same commit. Then `git clone A B`:

| Placement | Present in the clone? |
| --- | --- |
| `.git/orinoco/things.json` | **NO** |
| `refs/orinoco/things` (non-branch ref) | **NO** |
| `refs/heads/orinoco` (a real branch) | **YES** -- as `origin/orinoco`; `git show origin/orinoco:things.json` returns the content |

So: **nothing under `.git/` propagates**, and neither do refs outside
`refs/heads/*` and `refs/tags/*` under a default clone or fetch. Only a real
branch travels for free. This is exactly why git-annex keeps its own state in
the **`git-annex` branch** rather than in `.git/annex/`, and the same reasoning
applies here.

That gives a clean two-tier split which, pleasingly, is the split dump-things
already models:

| Tier | Location | Travels? | dump-things analogue |
| --- | --- | --- | --- |
| local, cheap, disposable | `.git/orinoco/` | no | **incoming** area |
| shared, curated, reviewable | `orinoco` branch | yes | **curated** area |

Concretely:

* `.git/orinoco/` holds the **transaction log** -- append-only observation
  JSONL per crawl run, the derived SQLite index, probe caches, the visited-set.
  All disposable, all rebuildable, none of it anyone else's business. It also
  correctly never pollutes the working tree, so `git status` stays clean and no
  `.gitignore` entry is needed.
* The `orinoco` branch holds the **curated record set** -- one file per record.
  And "one file per record, laid out by pid" is precisely the dump-things
  `record_dir` backend layout, so **the branch can literally be a dump-things
  record store**, served by pointing a local `dump-things-service` at a
  worktree of that branch. No new format.

One-record-per-file also solves merging: two people who observe different
things add different files, and git merges additions without conflict. That is
the same union-of-immutable-records argument from the architecture document,
now with git doing the union. Where the same record is genuinely edited on both
sides, that is a real curation conflict and should surface as one -- unlike
git-annex's union merge driver, which is right for append-only logs but wrong
for curated records.

**Fetching another repo's graph is then one cheap command:**

```
git fetch <url> refs/heads/orinoco:refs/remotes/<name>/orinoco   # ~1 RTT, small
git show <name>/orinoco:<record-path>
```

which is the same trick, and the same cost profile, as the `git-annex` branch
fetch measured earlier (1.58 s / 8.1 MB for a real dataset). A repo therefore
publishes its own view of the world to anyone who can read it, with no server.

**Two cautions.** First, an orphan `orinoco` branch is invisible to most people
and will be pruned by tools that only understand `main` -- it needs to be
documented, and `git push` must be told about it (a matching `push.default`
refspec or an explicit push, exactly the friction that makes `git-notes`
unpopular). Second, publishing repo-embedded things re-raises the redaction
problem from finding 2 of the synthesis: a public repo's `orinoco` branch
would carry hostnames, login names and absolute paths. **Redaction must apply
at promotion time** -- moving a record from `.git/orinoco/` to the branch is
exactly the right moment to enforce it.

## 3. Repo-as-node: the browser starts where you are

This is a better entry point than the design had, and it should replace the
"crawl a list of repos" framing:

```
cd ~/datasets/1076_spacetop
things browse .        # or: git worldmap
```

The current repo becomes the **seed node**; everything else arrives by
expansion. Consequences worth committing to:

* **The URL bar becomes the addressing scheme.** `file:///path`, `ssh://host/path`,
  `https://forge/owner/repo` are all just node identities that some expander
  knows how to probe. `file:///` is the cheap local case and should be
  implemented first -- it needs no network at all and covers sibling clones,
  subdatasets and worktrees on the same machine.
* **Remote exploration is the same program, run remotely.** Rather than a
  bespoke probe protocol, the natural move is: ssh to the host, run `things`
  there against its local repos, have it write into *its* `.git/orinoco/`, and
  return records over stdout for local aggregation. The remote gains a cached
  local graph as a side effect, so the next person to explore from that host
  starts warm. That is genuinely distributed: the worldmap accretes at every
  vantage point it has been observed from.
* **But it must degrade.** Requiring `things` on the remote breaks the HPC
  case the previous document handled with a POSIX `sh` probe. So: use the
  remote's `things` if present, fall back to the `sh` probe if not, and record
  which was used in the observation's `by` field.
* **Aggregation is a merge, not a copy.** Records fetched from a remote are
  observations *from that vantage point*; they keep their `via` and are merged,
  never overwritten. Two hosts disagreeing about a remote's URL is data, not a
  bug.

## 4. Many collections, common nodes

`dandi-bib` makes the point concretely. It is **itself a DataLad dataset**
(`.datalad/config`, git-annex commits, 3.2 MB) containing `dandi.bib`,
`dandi.ris`, `citations/*.tsv` and generation code. So it is simultaneously:

* a **node** in the worldmap -- a git-annex repo with clones and remotes; and
* a **collection provider** -- a source of `Publication` and `Person` records.

That duality is the shape of the whole system, and it argues that "repository"
and "collection" must be separate concepts that can point at the same thing.

**Proposed collection split** -- one per *provenance*, not per entity type:

| Collection | Source | Principal classes |
| --- | --- | --- |
| `worldmap` | git/git-annex crawl | Clone, Host, Remote, SpecialRemote, Worktree |
| `con-research` | orinoco records (`con/dump-research-info`) | XYZPerson, XYZProject, XYZOrganization, XYZPublication |
| `psychoinformatics` | another group's published records | same classes, different pids |
| `dandi-bib` | bibliography dump | Publication, Person |

Keeping collections aligned with provenance is what makes trust, refresh and
redaction tractable: you can re-crawl one collection, distrust another, or
publish only one, without untangling per-record ownership. It also matches
dump-things, where a collection binds to a schema and carries its own
permissions.

**Common nodes are then an identity problem, and it is the hard part.** The
same person is `xyzrins:persons/yaroslav-halchenko` in one collection, an ORCID
in another, a `git config user.email` in a commit, and a GitHub login on a
fork. Four mechanisms are already available and should be used in this order:

1. **Mint pids from authoritative identifiers where they exist** -- ORCID for
   people, DOI for papers, annex UUID for annex repos, dataset UUID for DataLad
   datasets, canonicalised clone URL for plain repos. This is the
   `concepts.datalad.org/ns/{gitsha,dataset-uuid,annex-key}` pattern from the
   previous document, extended.
2. **`same_as`** from `relations-mixin` for cross-collection assertions, as an
   explicit, reviewable record rather than an implicit join.
3. **`_get_rec_from_any_collection`** (query-things) to resolve a pid across
   collections at query time -- already implemented.
4. **Never merge silently.** Biolink's investment in identifier mapping, and
   issue #1's insistence that two clones sharing an annex UUID is an *error*,
   point the same way: co-reference is an assertion with provenance, not an
   inference. Render "these two nodes are probably the same" as a suggestion
   the user confirms, and store the confirmation as a record.

A satisfying corollary: **the citation graph and the clone graph meet at real
nodes.** A paper cites a dataset; that dataset is a DataLad dataset with a UUID;
that UUID has clones on four hosts; those clones were made by people who are
also authors on the paper. One graph, several perspectives -- which is the
thesis of this whole line of work, now with a concrete example that needs no
new data.

## 5. Where this leaves the design

Revised stack, with the new inputs folded in:

```
  seed          the repo you are standing in  (things browse .)
  local tier    .git/orinoco/   transactions, index, caches      [never travels]
  shared tier   orinoco branch  curated records, record_dir layout [travels as a branch]
  service       dump-things-service over a worktree of that branch, or a central instance
  query         query-things pipelines: forward, backward, recursive, cross-collection
  index         NEW: derived adjacency index for interactive expansion
  expanders     NEW: (node_type, relation) -> [nodes, observations]
                 file:/// · ssh · git-annex branch · forge API · another collection
  views         NEW: graph: annotations bundled as named perspectives
  UI            NEW: Cytoscape.js explorer; shacl-vue reused for record editing
```

Four things to build, everything else adopted -- one fewer than last document,
because query-things covers traversal.

**Sharpened first milestone.** Rather than crawling anything remote:

1. `things browse .` in a DataLad dataset with subdatasets and a few
   `file:///` siblings.
2. Records written to `.git/orinoco/`, promoted to the `orinoco` branch on
   request.
3. Second collection loaded from `con/dump-research-info`; the two share
   `XYZPerson` nodes.
4. Two perspectives: "remotes" and "people". Same graph, same store.

That exercises repo-embedded storage, cross-collection identity, pluggable
expanders and per-model views, with **no ssh, no forge API and no new
vocabulary** -- all four risky pieces deferred, all four architectural claims
tested.

## 6. Open questions

1. Branch name and layout: `orinoco`, or `refs/heads/things`? Orphan branch or
   a subdirectory on an existing branch? Orphan matches git-annex and keeps the
   worktree clean, at the cost of discoverability.
2. Does `dump-things-service`'s `record_dir` backend read cleanly from a git
   worktree, and does its on-disk layout survive round-tripping through a
   branch? (The `dump-things-storage-v0` spec page is egress-blocked here.)
3. Should promotion from `.git/orinoco/` to the branch be a `things` command,
   or should the branch simply *be* the curated area of a locally-run
   dump-things instance?
4. Is there an existing convention for third-party data in `.git/`? Namespacing
   under `.git/orinoco/` risks colliding with whatever else adopts the idea.
5. For `dandi-bib` specifically: generate records from `dandi.bib` at read time
   (an expander), or commit derived records into the repo (a collection)? The
   first stays fresh; the second is reviewable and offline. Probably both, with
   the derived records as a cache.
