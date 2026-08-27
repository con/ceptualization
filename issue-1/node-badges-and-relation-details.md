# Node badges and relation details

Specification.

**Status:** Part 1 (badges) is **implemented** in the Team D prototype, along
with hide/show and version stamping. Part 2 (the relation details panel) is
**still TODO** — clicking an edge does not yet swap the panel. The
`git annex info` / `git annex find` collection described below is specified but
not yet wired into the crawler, so storage badges read *unknown* wherever
git-annex is absent.

Two requests, one principle: *the graph should answer questions without being
clicked.* Today a node rectangle carries a label and the panel carries
everything else, so assessing a repository means selecting it and reading
prose. And selecting an edge does not even do that — the details panel keeps
showing the repository, so a remote's own configuration is currently
unreachable.

## Part 1 — badges on the node

### The constraint that shapes the design

Team D measured node text rendering at **6.8 px at fit zoom** (edge labels
were fixed at 13 px; node text was not). Team C's canvas labels collide at
**51 nodes**. So a badge strip made of words will be unreadable exactly when
it is most useful — looking at the whole map.

**Therefore badges are glyph-and-colour first, text second.** Each badge is a
small shape with a stable colour and, at reading zoom only, a text tail.
The information must survive being 8 px wide.

### The badge set

Grouped, because the toggle should be per group rather than all-or-nothing:

| Group | Badge | Source | Cost |
| --- | --- | --- | --- |
| **Topology** | `↗N` outgoing relations not yet walked | `rel_counts` | free |
| | `↙N` incoming relations not yet walked | `rel_counts` | free |
| | `⊙N` children hidden inside a collapsed container | view state | free |
| **Storage** | humanised annex size held here, e.g. `4.2G` | see below | free |
| | `∅` annexed repo holding no content (a pure keystore peer) | location log | free |
| **Annex policy** | `⊘` this remote is `annex-ignore`d | `remote.<n>.annex-ignore` | free |
| | `⊘*` ignored by **every** clone that knows it | derived, see below | free |
| **Form** | bare / worktree / linked-worktree / RIA / export-tree | `layout` | free |
| **Trust** | trusted · semitrusted · untrusted · **dead** | `trust.log` | free |
| **Health** | `!` error finding, `⚠` warning finding | findings | free |
| | `?` never probed · `⟳` stale (observed > N days ago) | observations | free |

Rules:

* **Cap at four badges plus `+N`.** Order by the group priority above —
  health, then annex policy, then storage, then topology, then form. A node
  with everything on must not become a badge salad.
* **Toggle per group**, persisted per viewer (`localStorage`), defaulting to
  health + topology on, the rest off.
* **Zero is not a badge.** `↗0` is noise; omit it.
* Badges belong to the *node*, so they must move with container geometry and
  survive undo — i.e. they are rendered from state, never cached positionally.

### Annex sizes come from `git annex info` — do not recompute them

**Corrected from an earlier draft**, which proposed summing the `-s<bytes>`
field out of key names in the location log. That reimplements, badly,
something git-annex already does properly and quickly.

Verified from the git-annex source and docs:

* `git annex info` with no argument reports *"the annex sizes of each
  repository"* — per-remote totals, in one command;
* `git annex info <remote|uuid|description>` reports *"the total amount of
  annexed data stored in it, and a variety of configuration information"* for
  one peer;
* `--json`, `--bytes` (raw bytes instead of nice units), `--batch` and `-z`
  make it machine-readable;
* `--show=<field>` exists precisely to *"avoid info doing work to calculate
  things you don't need"*, naming fields such as `annex sizes of
  repositories`;
* `--fast` restricts output to what is quick to gather.

And it is not a naive scan: the CHANGELOG for **10.20240831** records
*"info: Improved speed by using new repository size tracking"*, alongside the
new `maxsize` command. git-annex maintains repository sizes rather than
recomputing them, so asking it is both correct and cheap.

So the crawler shells out:

```
git annex info --json --bytes --show='annex sizes of repositories'
```

Two consequences to accept rather than engineer around:

* **This needs git-annex installed.** Where it is absent, report the size as
  *unknown* rather than substituting a hand-rolled estimate — an estimate that
  silently disagrees with `git annex info` is worse than a blank.
* It reports what git-annex *believes* from location tracking, so it still
  carries an observation timestamp like every other fact.

### Comparing two peers: a matching expression, not set arithmetic

For "what does this peer have that I do not", the same principle applies — ask
git-annex with a **matching expression** rather than differencing key sets by
hand:

```
# present there but not here, with sizes
git annex find --in=<remote> --not --in=here --format='${bytesize} ${key}\n'
# and the mirror
git annex find --in=here --not --in=<remote> --format='${bytesize} ${key}\n'
```

`--in=repository` accepts a remote name, UUID or description; `--not` negates;
`--format` exposes `bytesize`, `humansize`, `key`, `file`, `backend` among
others, and `--json` is available. Summing one column is arithmetic we are
entitled to do; deciding *which keys are in which repository* is not.

Both directions matter and answer different questions — "what would I gain by
fetching" versus "what would be lost if this peer died" — so the panel shows
two figures, never one signed number.

This stays the expensive row: lazy, behind an explicit action, result cached
as an observation.

### `annex-ignore`, forge defaults, and the git-lfs exception

`remote.<name>.annex-ignore` is **per-clone git config**, so it is a property
of the *edge*, not of the target. Three clones may disagree about whether a
peer is worth asking for content.

The requested aggregate — "ignored by all known" — is therefore a **derived
graph finding**: *every* edge pointing at node X carries `annex-ignore`, over
at least two edges. That earns a node badge (`⊘*`), because it means the map
contains no route to content there at all. With a single edge it is just that
edge's setting; do not promote it.

**Forge defaults.** Some hosts cannot carry annexed content over plain git —
github.com being the obvious one — so the crawler may annotate such a remote
as annex-incapable *by default*, without probing. Two rules keep that honest:

* mark it as an **assumption**, visually distinct from an observed
  `annex-ignore` setting. It is a prior, not a measurement, and a wrong prior
  that looks like a measurement is a bug nobody will ever find.
* keep the list short, explicit and overridable — hardcoded host lists age
  badly, and self-hosted forges (Forgejo-aneksajo especially) *do* carry
  annexed content.

**The exception that shapes the design.** A `git-lfs` special remote — a real
git-annex remote type, `Remote/GitLFS.hs` in the source — stores annexed
content *on* exactly such a host by (ab)using LFS. Other transports smuggle
content through services that refuse annex branches in the same spirit.

So **annex-capability is a property of the route, not of the host.**
`github.com/con/foo` reached as a git remote cannot hold annexed content; the
same underlying storage reached as a `type=git-lfs` special remote can. In the
model these are *two distributions* — different `vcs`, different `annex_mode`,
possibly different `annex_uuid` — that happen to share a host. The
Distribution-with-instance-slots model from
[distribution modeling](./distribution-modeling-and-repo-identity.md) already
expresses this; a host-level flag could not.

Two requirements follow:

1. **Never colour a host node as annex-incapable.** The badge belongs on the
   distribution or the edge. A host box containing both a plain git mirror and
   a git-lfs special remote is entirely legal.
2. When a `git-lfs` special remote points at a host the default list calls
   annex-incapable, that is **not a contradiction to flag** — it is the
   interesting configuration, and the UI should make it legible rather than
   warn about it.

## Part 2 — the relation details panel

### The bug

Clicking a remote arrow leaves the details panel showing the repository.
A relation is a first-class thing in this model — `RemoteLink` is a reified
statement carrying its own data
([distribution modeling](./distribution-modeling-and-repo-identity.md)) — so
it must be selectable and inspectable in its own right.

### What the panel shows

Ordered by cost, because that ordering *is* the design: everything free is
shown immediately, everything expensive is behind an explicit action.

**Free — already crawled**

* the **name this clone uses** for the peer, and the names *other* clones use
  for the same peer — the disagreement issue #1 exists to expose;
* fetch URL and push URL when they differ;
* `annex-ignore`, and whether the other clones agree;
* recorded `remote.<n>.annex-uuid` versus the UUID actually observed at the
  target — a mismatch is a finding, not a detail;
* trust level from `trust.log`;
* ahead/behind for the tracked branch, with the observation timestamp,
  because these come from local remote-tracking refs and are **only as fresh
  as the last fetch** — a stale clock badge belongs here;
* special-remote configuration when the target is one (type, exporttree,
  encryption, chunking).

**One round trip — offer a button**

* `git ls-remote` → the **branch correspondence table**: every ref on both
  sides, matched by name, showing same / ahead / behind / only-here /
  only-there. This is the table the request asks for and it is one command;
* refresh ahead/behind against live refs rather than cached ones.

**Expensive — explicit, and cached as an observation**

* **content comparison**: keys held here but not there, there but not here,
  and the byte totals of each. From location logs this is a set difference
  over two UUIDs and is *free*; against a live special remote it may require
  `git annex info <remote>` or a listing, which can be slow or billable.
  So: show the log-derived answer immediately and label it *believed*, and
  offer "verify" separately.

Every computed row is stored as an observation with `t_observed`, `by` and
`via`, so the panel can show *when* each number was true and re-running is a
refresh rather than a recompute. Lazy evaluation is not just a performance
tactic here — it is what keeps the panel honest about what is known versus
what is assumed.

### Interaction

* clicking an edge selects the edge and swaps the panel; clicking a node swaps
  it back — selection is one shared slot, not two competing ones;
* the panel names both endpoints and lets you jump to either;
* multi-edges between the same pair (two clones each naming the other) are
  individually selectable;
* the `contains` relation gets a simplified panel — it has no configuration,
  only a path.

## What the crawler must add

None of this is collected yet. In `worldmap-crawl.py`:

| Need | Command | Cost |
| --- | --- | --- |
| `annex-ignore` per remote | `git config --get remote.<n>.annex-ignore` | free |
| recorded annex uuid per remote | `git config --get remote.<n>.annex-uuid` | already collected |
| push URL when different | `git config --get remote.<n>.pushurl` | free |
| per-repository annex sizes | `git annex info --json --bytes --show='annex sizes of repositories'` | fast since 10.20240831; needs git-annex |
| one peer's size and config | `git annex info --json --bytes <remote>` | as above |
| what each side lacks | `git annex find --in=X --not --in=Y --format='${bytesize} ${key}'` | expensive; lazy |
| special-remote type (incl. `git-lfs`) | `remote.log` in the `git-annex` branch | free |
| branch correspondence | `git ls-remote` + local `for-each-ref` | 1 RTT |

## Open questions

1. Do badges belong on the node rectangle, or in a gutter beside it? On the
   rectangle they compete with the label at low zoom; in a gutter they need
   layout space that the two-tier geometry does not currently reserve.
2. Should `⟳` staleness be per-node or per-fact? A node is rarely uniformly
   stale — its remotes may have been probed at different times.
3. How short can the annex-incapable forge list be while still being useful,
   and should it live in the crawler, the model, or user config?
4. When git-annex is absent the storage badge is simply unknown — is that
   acceptable, or should the badge group hide itself entirely rather than
   show gaps?
