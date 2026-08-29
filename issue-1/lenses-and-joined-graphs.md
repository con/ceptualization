# Lenses and joined graphs

Specification and design argument. **Nothing here is built** except where a
row says so; the point of this document is to fix the *shape* of the
generalization before more single-purpose features accrete.

## The two graphs that already exist

| | git/annex worldmap | psychoinformatics.de `/explore/` |
|---|---|---|
| schema | distributions, hosts, remotes | [demo-research-information](https://concepts.datalad.org/s/demo-research-information/unreleased/): Person, Project, Publication, Dataset, Instrument, Topic, Organization |
| what containment means | physical: a repo *is on* a host, a subdataset *is at a path inside* its super | none drawn — grouping is by node colour only |
| what an edge means | an operational route (fetch/push/sync) or a physical relation (worktree, subdataset) | an association (authored, part-of, about) |
| what click does | open the inspector, expand relations | navigate to the website page |
| layout | two-tier: containers with geometry, repos inside boxes | one force-directed ball, size ≈ degree |
| population | tens to hundreds, metadata-dense | ~300, navigation-first |

These are not two applications. They are **two lenses over graphs of the same
kind**, and the differences enumerate exactly what a lens *is*.

## A lens, defined

A lens is a declarative bundle, not code:

```json
{
  "id": "deployment",
  "collection": "worldmap",
  "containment": "contains",          // which relation becomes GEOMETRY
  "edge_classes": {
    "structural": ["contains", "subdataset"],
    "route":      ["remote", "worktree_of", "annex_knows"],
    "affinity":   ["same_as", "shared_history"]
  },
  "badges": ["health", "annex-policy", "storage", "topology", "form"],
  "primary_action": "inspect",         // vs "navigate" (page_url)
  "type_filters": ["distribution", "host", "special-remote"],
  "layout": "two-tier"                 // vs "force"
}
```

The current viewer is this lens hardcoded. The psychoinformatics explorer is:
containment `none`, everything `affinity`, primary action `navigate`
(each node carries a `page_url`), layout `force`, type filters = the
checkbox legend in its corner. Extracting the lens from the viewer's
constants is refactoring, not new machinery.

### The three edge classes — the "rethink the arrows" answer

The worldmap's evolution keeps rediscovering the same trichotomy, so make it
first-class:

* **Structural** edges are *geometry, never arrows*. A repo on a host is a
  box in a box; a subdataset at `code/sub` is a box inside its super. The
  containment machinery is already generic — containers are ordinary nodes
  with explicit geometry — so *which* relation gets to be geometry is a lens
  decision. In a portfolio lens, `Project contains its Publications` is a
  perfectly good geometric containment, and would give that ball of yarn the
  same drag/collapse/bundle behaviour the worldmap already has.
* **Route** edges are arrows: directed, styled by state, filtered by scope.
  `current / tracked / all` for remotes generalizes to per-class scope
  filters (a portfolio lens might scope `authored` to "last two years").
* **Affinity** edges (same_as, shared history, co-authorship, same topic)
  are *not drawn by default*. They power co-highlighting on selection — the
  yellow-edge behaviour in the psychoinformatics explorer — and "portals"
  (below). Drawing all affinities is what turns 300 nodes into a hairball.

The bundling, scope-toggle and grey-inactive features the worldmap already
has are all route-class policies; the selection-highlight the group explorer
has is an affinity-class policy. Neither app has the other's half. The lens
model gives both to both.

## Joining the graphs

The point of the exercise: standing on
`psychoinformatics.de/instruments/datalad/` (an Instrument in the portfolio),
jump to *my local clones of it and their infrastructure* (distributions in
the worldmap) — and back. Infrastructure cuts both ways: the group's servers
and its GitHub presence are portfolio assets *and* worldmap hosts.

### Join keys, in order of confidence

| key | bridges | confidence |
|---|---|---|
| DataLad dataset id | Dataset (portfolio) ↔ distribution (worldmap) | near-certain (the ~99% id) |
| canonical URL | Instrument/Dataset ↔ distribution or host | high — same normalization `canon_url` already does |
| host name | Organization infrastructure ↔ host node | high |
| DOI | Publication ↔ archived distribution | high |
| person (ORCID, email) | Person ↔ committer/annex-uuid describer | medium — needs the `actor` work |
| shared history | Dataset ↔ untied clone | the containment-scoring work |

### Bridges are records, not merges

A join is an explicit `same_as`-style **bridge record** stored in its own
collection (dump-things: worldmap collection + portfolio collection +
`bridges`), carrying the key it was made on and its confidence — the same
discipline as `annex_incapable_assumed` and `direction: inferred`. Nodes are
**never merged**: the Instrument "DataLad" and the distribution
`github.com/datalad/datalad` remain two nodes in two collections, each
rendered by its own lens. Merging would force one schema to absorb the
other and make every wrong heuristic join destructive.

### Portals, not cross-lens arrows

A node with bridges into another collection gets a **portal badge**
(`⤳ deployment ×3` on the Instrument; `⤳ portfolio` on the clone). The
badge is the navigation: activating it opens the other lens *focused on the
bridged nodes*, with the origin pushed onto a breadcrumb trail. Cross-lens
edges are never drawn as arrows in either pane — the two layouts don't share
a coordinate space, and a line between them would be geometry theatre.

This is deliberately the website's own navigation pattern (click Instrument →
instrument page → its relations), generalized: a lens's `primary_action` says
whether activation navigates a website, opens an inspector, or pivots panes.

## Panes and navigation

* **One store, N panes.** Each pane = one lens instance with its own
  visible-set, collapse state, and layout. Two panes may show the same
  collection under different lenses (deployment vs. a pure annex-flow view).
* **Pivot, don't overlay.** The portal action either *switches* the single
  pane (mobile, small screens) or opens a second pane beside it; selection
  is linked — selecting a bridged node in one pane co-highlights its bridge
  targets in the other.
* **One exploration history across panes.** A pivot is an undoable step like
  an expand; undo after a pivot returns to the previous pane state. (World
  time stays separate, per the data-movement spec's rule: two timelines,
  two controls.)
* **Named perspectives graduate.** Save-view already persists a visible-set
  and layout; a perspective becomes `(lens, visible-set, layout, focus)` —
  which finally gives the 💭 "perspectives" ledger row its concrete form.
* **Type filters join the toolbar.** The checkbox legend in the group
  explorer (Dataset / Person / …) is a lens's `type_filters` rendered as
  toggles — the worldmap should have the same for its own types; it
  currently cannot hide, say, all special remotes at once.

## What NOT to build

* **Not one mega-graph.** Rendering both collections in one force layout is
  the hairball the portfolio explorer already brushes against at ~300 nodes,
  and it destroys the worldmap's geometric containment.
* **Not silent URL-based deduplication.** Bridges are explicit, confident,
  inspectable records; a heuristic that quietly merges two nodes cannot be
  audited or undone.
* **Not a second viewer.** The lens descriptor must be data consumed by the
  existing viewer; if the portfolio lens needs a fork of the code, the
  abstraction has failed.

## Implementation plan

Revised from "cheapest first" to **schema first**, for a load-bearing reason:
a lens classifies *relations by name* (this property is geometry, that one an
arrow, that one a highlight). Until the deployment model is formalized, those
names are ad-hoc strings in one crawler's JSON — nothing a second lens, a
validator, or another tool can reference. The schema is what turns the lens
from viewer configuration into a portable document.

The phases are strictly ordered 1 → 2 → 3; 4 and 5 build on 3; the
data-movement and `actor` work proceeds in parallel and feeds phases 4–6.
Every phase lands with its e2e extension and DESIGN.md ledger rows — a phase
without a test that would catch its regression is not landed.

### Phase 1 — formalize the deployment model in the concepts.datalad.org framework

Finish what
[distribution-modeling-and-repo-identity](./distribution-modeling-and-repo-identity.md)
and [vocabulary-for-clones-and-remotes](./vocabulary-for-clones-and-remotes.md)
drafted, as a LinkML module (working name `things-deployment`):

* `Distribution is_a Thing` with the orthogonal slots (`vcs`, `layout`,
  `annex_mode`, `packaging`, …) — the crawler's field names already mirror
  this draft, which is no accident and makes the mapping near-mechanical.
* Every worldmap edge kind becomes a **`Property`**, and an observed edge a
  **`Statement`** qualified via `characterized_by`: remote name, tracking
  state, `annex-ignore`, subdataset `path`, `not-initialized`, observation
  time, evidence/assumption markers. The qualified-statement machinery is
  exactly what the crawl's per-edge facts need; no property-graph escape
  hatch.
* `subdataset` and host containment as specializations of the relations
  mixin's `part_of`; `same_as` reserved for bridges (phase 5).
* Outward `exact_mappings`/`related_mappings` to ForgeFed, DOAP, dcat — link
  out, import nothing, per the vocabulary document's conclusion.

Deliverables: schema under `issue-1/schema/` (drafted here; upstreamed to
datalad-concepts only after phase 3 proves it drives a real UI); a
`worldmap-export` converter emitting schema-conformant records from
`worldmap.json` (the crawler's native format stays — the viewer must not
notice this phase); `linkml validate` plus an export → validate → reimport
round-trip in the e2e suite.

### Phase 2 — formalize the lens itself

`LensDefinition` is also a LinkML class — a lens is a *thing*, storable and
shareable in the same store as the data:

* slots: `collection`, `containment` (ordered property URIs that become
  geometry), `edge_classes` (property URI → structural | route | affinity),
  `type_filters`, `badges`, `scopes`, `primary_action`, `layout`.
* every reference is a **URI into a named schema** — the reason phase 1
  precedes this — and a lens linter checks each one resolves, and that every
  relation in the collection is classified (the default class for an
  unlisted relation is an explicit slot, not an accident).
* the same property may be classed differently by different lenses:
  `part_of` is structural in the deployment lens; a portfolio lens may
  render `Project part_of` as geometry or leave it affinity. That freedom is
  the point.

Deliverables: the class; `deployment.lens.yaml` transcribing today's
hardcoded viewer behaviour; `portfolio.lens.yaml` written against
demo-research-information; the linter.

### Phase 3 — the viewer consumes the lens (zero visible change)

Replace the viewer's hardcoded walkable set, edge styling, badge grouping and
containment logic with lens-driven equivalents served at `/api/lens/{id}`.
The gate is severe and cheap to enforce: **the unchanged e2e suite must stay
green** — the deployment lens must reproduce today's behaviour exactly, on
the fixture and all conformance scenarios. If the portfolio lens later needs
a code fork, this phase failed.

### Phase 4 — second collection, portfolio lens, real data

Load an export of the CON research-group graph (the orinoco/dump-things data
behind psychoinformatics.de) as a second collection; render it under the
portfolio lens: force layout, `navigate` action, the type-filter legend.
Decision point here, not before: whether `app.py` grows multi-collection
support or is replaced by dump-things-service (the data is already in its
shape; try it, keep `app.py` as the fallback). The e2e walk generalizes per
lens: which invariants apply is derived from the lens (collapse/containment
checks only where `containment` is non-empty), so the portfolio collection
gets its own conformance run rather than a copy of the suite.

### Phase 5 — bridges and portals

`Bridge` as a schema class: subject, object, key kind (dataset id, canonical
URL, host, DOI, person), confidence, evidence — the same discipline as
`annex_incapable_assumed` and `direction: inferred`. A generator computes
bridges over the strong keys only; portal badges render them; activating a
portal pivots the pane to the other lens focused on the bridged nodes,
breadcrumb pushed, the pivot a step in the one exploration history. e2e: the
fixture gains a miniature portfolio collection naming the fixture's github
repository as an Instrument — invariants: the portal badge appears, the
pivot lands focused on the bridged node, undo returns to the origin pane.

### Phase 6 — comfort and scale

Side-by-side panes with linked selection; affinity co-highlighting in the
worldmap; person-key bridges once `actor` lands; perspectives
(`lens + visible-set + layout + focus`) stored as things and shared like any
other record. Order within this phase by demand, not by plan.

### What stays true throughout

* The crawler's native JSON remains the emission format; schema records are
  an export of it, not a replacement, until well after phase 4.
* Nodes are never merged across collections; bridges are explicit records.
* No second viewer. One codebase, N lens documents.
* A phase is done when the e2e suite tests it — the suite, not the demo, is
  the definition of done.
