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

## Staged plan, cheapest first

1. **Extract the lens descriptor** from the viewer's hardcoded constants
   (edge classes, badge groups, containment kind, layout). No behaviour
   change; the deployment lens becomes data.
2. **Type filters in the toolbar** — small, useful immediately in the
   worldmap, and exercises the descriptor.
3. **Second lens, real data:** load an export of the CON research-group
   graph (orinoco/dump-things already serve this shape) as a second
   collection with a `portfolio` lens — force layout, navigate action.
   This *is* the two-collections test already in the TODO, now with a
   concrete UI meaning.
4. **Bridge records + portal badges** on the strongest keys only (dataset
   id, canonical URL, host name). Pivot = switch pane, push breadcrumb.
5. **Affinity co-highlighting** in the worldmap (selection lights up
   same_as/shared-history peers), replacing nothing, reusing the group
   explorer's best interaction.
6. Later: linked side-by-side panes; person-key bridges once `actor` lands;
   perspective sharing (a perspective is small JSON — trivially a "thing"
   in the store, shareable like a saved view).
