# Node badges and relation details

Specification. **Not yet implemented** — this is the TODO, written down
properly so it can be built against.

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

### Annex size without asking anyone

The obvious source is `git annex info`, but it needs git-annex installed, and
for a remote it needs the remote. There is a much cheaper route that works
from a single fetched `git-annex` branch:

**git-annex keys encode their own size.** A key like
`SHA256E-s12345--<hash>.nii.gz` carries `-s12345` — the byte count. The
location log records which UUIDs hold which keys. So summing `-s<bytes>` over
the keys logged against a UUID gives **the bytes that UUID is believed to
hold, for every clone in the map, from data already fetched, with no network
and no git-annex binary.**

Caveats to state in the UI, not hide:

* it is **believed**, not verified — location logs are what the last person to
  sync recorded, so mark it as an observation with its `t_observed`;
* keys with no `-s` field (some backends, `URL--` keys) are uncountable;
  report them as a separate `+N unknown` rather than silently undercounting;
* `git annex info` remains the accurate local source and should be used when
  git-annex is present, with the log-derived figure as the fallback for
  everyone else.

### `annex-ignore`, and the aggregate that is actually interesting

`remote.<name>.annex-ignore` is **per-clone git config**, so it is a property
of the *edge*, not of the target. Three clones may disagree about whether
GitHub is worth asking for content.

The requested aggregate — "ignored by all known" — is therefore a **derived
graph finding**, not a stored fact: *every* edge pointing at node X carries
`annex-ignore`, over at least two edges. That is worth a node badge (`⊘*`)
because it means the map contains no route to content there at all, which is
a real conclusion the picture should show. With one edge it is just that
edge's setting; do not promote it.

This is a good example of the model earning its keep: the fact lives on edges,
the conclusion lives on a node, and nothing had to be denormalised.

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
| bytes per UUID | parse `-s<bytes>` from keys in the `git-annex` branch location logs | free, one branch fetch |
| local annex size | `git annex info --json --fast` when git-annex is present | local |
| branch correspondence | `git ls-remote` + local `for-each-ref` | 1 RTT |

## Open questions

1. Do badges belong on the node rectangle, or in a gutter beside it? On the
   rectangle they compete with the label at low zoom; in a gutter they need
   layout space that the two-tier geometry does not currently reserve.
2. Should `⟳` staleness be per-node or per-fact? A node is rarely uniformly
   stale — its remotes may have been probed at different times.
3. Is `+N unknown` for sizeless keys worth the pixels, or should uncountable
   keys just footnote the total?
