# A generic graph explorer, and what datalad-concepts already gives us

Follow-up to the five research tracks in this directory, prompted by the
reframing: *we need a generic system for exploring graphs, with the ability to
expand along a particular relationship (e.g. ssh into a remote and query
there), refresh as things change, and tune the visualization per target model
(repos vs. people).*

Two concrete target graphs:

* the git/git-annex clone worldmap of issues #1/#4/#5/#6;
* research-group information, as published at
  `https://con.github.io/test-orinoco-downstream-website/explore/`, with the
  ability to load and view other groups' graphs (e.g.
  `https://www.psychoinformatics.de/`).

## How this was verified

`concepts.datalad.org`, `con.github.io` and `www.psychoinformatics.de` are all
blocked by this sandbox's egress proxy, as is `hub.psychoinformatics.de`.
Anonymous `git clone` from github.com works, so everything below was read from
source:

| Source | Commit / state read |
| --- | --- |
| `psychoinformatics-de/datalad-concepts` | `cb6c791`, 2026-08-18 |
| `con/test-orinoco-downstream-website` | `7e66d15`, 2026-08-19 |
| `psychoinformatics-de/shacl-vue` | `5eda1be`, 2026-01-15 |

**Not verified:** anything about `www.psychoinformatics.de` itself, and the
contents of `hub.psychoinformatics.de/orinoco/{tools,query-things}` and
`hub.psychoinformatics.de/datalink/shacl-vue` (where shacl-vue development has
moved). Statements about those are marked `[UNVERIFIED]` and should be checked
before being relied on.

## 1. concepts.datalad.org is already a generic graph model

This is the central finding, and it is better news than the earlier research
suggested. The earlier track concluded "datalad-concepts contains no
git/annex/clone terms, so we author the git layer ourselves". True, but it
undersold what *is* there. The `things` module is not a domain schema at all --
it is a **generic, reifiable property-graph model**:

| Class | Role |
| --- | --- |
| `Thing` | the basic identifiable node: `pid`, `relations`, `attributes`, `identifiers`, `characterized_by` |
| `Property` | `is_a: Thing`; a node used as a predicate (`rdf:Property`) |
| `Statement` | `predicate` (a `Property`) + `object` (a `Thing`) -- a **qualified, typed edge** |
| `AttributeSpecification` | a qualified attribute with no identifier of its own |
| `Annotation` / `AnnotationTag` | OWL-style tag/value pairs |
| `Identifier` | `notation` + scheme, so one node can carry many identifiers |
| `ValueSpecification` | value + unit |

Two properties of this model matter enormously for what you're describing.

**Edges are first-class and can carry data.** `Thing.relations` is explicitly
documented as *"unqualified (and symmetric), and should be further
characterized via a `Statement`"*. A `Statement` binds a predicate to an
object, and `Statement.characterized_by` is documented as *"Make statements
about statement, also known as reification"*, citing the reified-statement
pattern. That is precisely the capability my earlier synthesis claimed RDF
lacked when I argued for a property graph. **I was wrong to frame it as
RDF-vs-property-graph** -- `dlthings:Statement` + `characterized_by` gives
data-carrying edges inside an RDF-compatible model. The per-clone remote name,
`ahead.commits`, ping distance and shared-content-size all fit as
characterizations of a statement, not as awkward side tables.

**The generic relation vocabulary is already the right shape.** From
`relations-mixin`: `part_of`, `parts`, `same_as`, `version_of`, `depends_on`,
`conforms_to`, `roles`, `about`, `kind`. `part_of`/`parts` gives subdataset
containment (issue #4) for free; `same_as` is how you say two discovered URLs
are one repo; `version_of` is close to what a clone-of relation needs.

The real-world encoding is visible in the orinoco records, e.g.
`metadata/records/XYZProject/datalad.yaml`:

```yaml
pid: xyzrins:projects/datalad
schema_type: xyzri:XYZProject
part_of: [xyzrins:.]
associated_with:
  - object: xyzrins:persons/michael-hanke
    roles: [marcrel:led]
    schema_type: dlthings:Association
attributes:
  - predicate: foaf:homepage
    value: https://datalad.org
    schema_type: dlthings:AttributeSpecification
```

Every node is one YAML file, typed by `schema_type`, addressed by `pid`, with
qualified edges carrying roles. **This is already the storage format for a
generic graph explorer.** The git worldmap would be more record types over the
same substrate, not a different system.

### 1a. Where the model layers sit

```
LinkML source (datalad-concepts/src/*/unreleased.yaml)
  -> JSON-LD context + OWL + SHACL shapes  (generated)
       -> shacl-vue        : model-driven FORMS and record views
       -> orinoco          : model-driven STATIC SITE (Hugo)
       -> [ MISSING ]      : model-driven GRAPH EXPLORATION
```

36 modules, split as `things-*` (the real vocabulary), `*-mixin` (slot
bundles), `flat-*` (flattened variants), and `demo-*` (worked profiles).
`demo-rse-group` (36 classes) and `demo-research-information` (33) are the
research-group profiles: `XYZPerson`, `XYZOrganization`, `XYZProject`,
`XYZGrant`, `XYZPublication`, `XYZDataset`, `XYZDistribution`, `ORCID`, plus a
full PROV layer (`XYZAttribution`, `XYZAssociation`, `XYZDelegation`,
`XYZDerivation`, `XYZGeneration`, `XYZUsage`, `XYZStart`, `XYZEnd`,
`XYZInfluence`). Licence MIT; funded in part by DFG TRR 379.

## 2. What datalad-concepts is missing

### 2a. Nothing about version control exists

Grepped across all of `src/`:

| Term | Files matching |
| --- | --- |
| `Repository` | 0 |
| `Clone` | 0 |
| `Remote` | 0 |
| `Branch` | 0 |
| `Worktree`, `Submodule`, `Sibling`, `VersionControl` | 0 |
| `Commit` | 2 (**examples only**) |
| `annex` | 2 (**examples only**) |

The only trace of git/annex in the entire repository is in
`src/demo-research-assets/unreleased/examples/XYZDistribution-02-attributes.yaml`:

```yaml
kind: https://example.org/ns/git-commit
table_221.csv: https://concepts.datalad.org/ns/annex-key/MD5E-s11263--1549566fb97afa879dc9446edcf2015f.csv
```

So the *pattern* -- a git commit as a `Distribution` whose named parts are
annex keys -- has been sketched, and a `concepts.datalad.org/ns/annex-key/`
namespace has been reserved. But `kind` points at `example.org`, and there is
no class, no slot, and no shape. **A `things-vcs` module is the missing piece,
and the project has clearly anticipated it.**

Concretely, the gaps against issues #1/#4/#5/#6:

* no `Clone` (a location) distinct from an annex-UUID identity distinct from a
  dataset identity -- the split that turns "two clones share an annex UUID"
  into a detectable graph pattern rather than special-case code;
* no `Remote` as a qualified edge carrying the **per-clone remote name**, which
  is the actual pain point in issue #1;
* no `SpecialRemote` with its flavours (encrypted, exporttree, importtree,
  keystore, trust level);
* no `Host` -- and there is no notion of a *vantage point* anywhere in the
  model, which matters because reachability is not a property of a host but of
  a (host, observer) pair;
* no ahead/behind or any quantity attached to a relation over time (issue #5);
* no `Worktree`.

`things-distributions` has exactly one class, `Distribution` (`is_a: Thing`,
one slot `distribution_of`, mapped to `dcat:Distribution`) -- far too thin to
carry any of this.

### 2b. There is no *observation* or staleness layer

`prov-mixin`/`things-prov` (20 classes) model provenance of the *described
world*: who generated a dataset, what activity used what. They do not model
provenance of the *description* -- "I learned this fact at time T, from
vantage V, by running probe P, and it may now be stale."

For a static publication site that gap is invisible: the site is rebuilt, so
the records are current by construction. For an incrementally expanded,
refreshable worldmap it is fatal. This is the same conclusion the architecture
track reached independently (observations, `t_observed`, `by`, `via`), and it
is the single most important thing to add if datalad-concepts is adopted as
the model layer.

Note that `pav:` was added to `research-information` on 2026-08-18 (the most
recent commit read). PAV is the Provenance, Authoring and Versioning vocabulary
and covers some of this ground (`pav:retrievedFrom`, `pav:lastRefreshedOn`,
`pav:createdOn`) -- worth checking whether it is intended to serve this role
before proposing anything new. `[UNVERIFIED — I could not read the rendered docs]`

## 3. What the existing explore view does, and its three gaps

`custom/editorial/explore.md` embeds a `#sigma-container` and loads
`/graph.js`, a Vite bundle whose imports are **sigma.js + graphology +
graphology-layout-forceatlas2**. It reads a committed, precomputed
`site/framework/static/graph.json`: **1038 nodes, 2148 edges**.

The node and edge shapes are, verbatim:

```json
{"id": "isil:DE-Juel1", "label": "FZJ-ZB", "type": "organization", "size": 1, "url": null}
{"id": "e0", "source": "isil:DE-Juel1", "target": "xyzrins:organizations/fzj"}
```

Node type distribution: publication 846, person 56, organization 46, project
26, instrument 25, topic 19, dataset 15, objective 5.

The page itself states the design: *"Select a node to inspect its connections,
then select it again to visit the corresponding page. The graph is generated
from the committed CON projection. The deployed static site does not query a
changing metadata service."*

Three gaps, in order of importance:

**1. Edges are untyped.** Every one of the 2148 edges is `{id, source,
target}`. No predicate, no role, no direction semantics. Yet the source records
*do* carry that information -- `associated_with` with `roles: [marcrel:led]`,
`part_of`, `attributes` with predicates. **The projection to `graph.json`
discards the edge semantics the records already have.** This is the blocking
gap for your core requirement: you cannot "expand along a particular
relationship" when the graph does not know what its relationships are. It is
also the cheapest to fix -- the information is present upstream; only the
projection step throws it away.

**2. No expansion, and no refresh.** The whole graph ships as one file, laid
out client-side by forceAtlas2. There is no notion of a frontier, an unexpanded
node, or a re-fetch. At 1038 nodes it works; at worldmap scale with remote
probes it cannot.

**3. No persisted view.** No `localStorage`, no saved layout, no shareable
expansion state. Interaction is `enterNode` hover plus click-through to a page.

A fourth, more subtle point: sigma.js has no compound-node model, so the
`cluster_<host>` grouping issue #1 depends on, and the nested subdatasets of
issue #4, cannot be drawn in the current stack. That is consistent with the
earlier recommendation of Cytoscape.js, and it means the explore view's
renderer is not reusable for the git case even though its *data pipeline* is.

## 4. Per-model tuning already exists -- for forms, not for graphs

`shacl-vue` (MIT, VueJS 3 + Vuetify + Vite, RDF/JS + n3, `shacl-tulip`)
describes itself as *"an automatic builder that you just have to feed with a
model of your data... No need to build custom forms for data entry... no need
to create a catalog application that renders all the entered data."* It is
driven by SHACL and the W3C DASH form vocabulary. It has **no graph
visualisation dependency at all** (no cytoscape, sigma, graphology, d3-force;
mermaid is present only for docs).

And datalad-concepts already carries the presentation hints that drive it, as
LinkML annotations: **151 `sh:` and 30 `dash:` annotations** across the modules,
e.g.

```yaml
annotations:
  dash:propertyRole: dash:KeyInfoRole
```

So the mechanism you are asking for -- *"depending on the target case,
visualization should be tuned for different models"* -- **already exists in
this ecosystem, expressed in the model itself, and is already used to
generate forms.** The missing step is a parallel set of annotations that drive
*graph* presentation rather than form presentation.

That is a much smaller and better-founded proposal than inventing a new
configuration system. Sketch:

```yaml
classes:
  Clone:
    annotations:
      graph:nodeShape: round-rectangle
      graph:groupBy: dlvcs:onHost          # -> compound parent
      graph:badge: dlvcs:aheadCommits
slots:
  hasRemote:
    annotations:
      graph:edgeLabel: dlvcs:remoteName
      graph:expandable: "true"             # offer as an expansion axis
      graph:expandCost: remote             # cheap/local vs expensive/remote
```

`graph:expandable` and `graph:expandCost` are the two that turn a static
renderer into an explorer, and they belong in the model because *which
relations are worth walking* is a modelling fact, not a UI preference.

## 5. What the generic system actually is

Putting it together, the architecture your reframing implies:

```
     ┌── record store (per-entity YAML/JSON-LD, pid + schema_type + qualified edges)
     │        + observation log (what was learned, when, from which vantage)
     │
     ├── model layer (LinkML -> SHACL/OWL/JSON-LD)
     │        + graph: annotations (node shape, grouping, badges, expandable relations)
     │
     ├── expanders: functions bound to (schema_type, relation) pairs
     │        git:  ls-remote | fetch git-annex branch | ssh probe | forge API
     │        rse:  ORCID | DOI/Crossref | Zotero | registry lookup
     │
     └── viewer: one explorer, per-model view profiles from the annotations
              expand along a chosen relation · refresh · save/load view
```

The insight worth stating plainly: **an "expander" and a "source adapter" are
the same thing viewed at different granularities.** orinoco already has
`source-adapters/` (the site carries a `zotero` adapter with a
`source/snapshot.json` and `candidates/XYZPublication.json`). A batch adapter
ingests many records ahead of time; an expander resolves one node's neighbours
on demand. If they share an interface, then the research-group graph becomes
incrementally explorable *and* the git worldmap becomes batch-publishable, from
one mechanism. I would make that shared interface the first design commitment.

Three properties fall out:

* **Expansion is typed.** "Expand along `hasRemote`" and "expand along
  `associated_with`" are the same operation with different bindings. This is
  Maltego's Entity/Transform model, which the prior-art track independently
  identified as the closest existing design.
* **Refresh is re-running an expander and appending observations.** Because
  observations are append-only and timestamped, refresh never destroys history,
  and "this edge was true last Tuesday" remains answerable. Staleness becomes a
  renderable property (a dimmed edge, a clock badge).
* **Loading another group's graph is loading another record set.** If
  psychoinformatics.de publishes records in the same shape, cross-group
  exploration is federation over `pid`s, and `same_as` is how you assert that
  their `XYZPerson` and yours are one person. Whether they do publish that way
  is the key unknown -- see below.

## 6. Recommendations

**Ranked, cheapest first.**

1. **Type the edges in the orinoco projection.** Emit `predicate` (and `roles`
   where present) on each edge of `graph.json`. The data already exists in the
   records; only the projection drops it. Nothing else on this list is possible
   without it, and it independently improves the existing explore view (filter
   by relation, colour by predicate). Smallest possible change, largest
   unlock.
2. **Propose a `things-vcs` module to datalad-concepts**, with `Clone`,
   `Host`, `Remote` (as a `Statement` subtype carrying the remote name),
   `SpecialRemote`, `Worktree`, and an `AnnexRepo` identity distinct from
   `Clone`. The `annex-key` namespace is already reserved and the
   commit-as-`Distribution` pattern already sketched in the examples, so this
   extends an anticipated direction rather than cutting against the grain.
   Raise it as an issue there first -- this is their model, and the
   `demo-research-assets` example suggests they have thought about it.
3. **Add an observation/vantage layer** (`t_observed`, `by`, `via`, `status`),
   after first checking whether the newly added `pav:` terms are meant to cover
   it.
4. **Add `graph:` annotations** alongside the existing `dash:` ones, and build
   the viewer to read them. This is what makes one explorer serve both repos
   and people.
5. **Build the explorer on Cytoscape.js**, not sigma.js -- compound nodes are
   required for host clustering and subdataset nesting, and sigma has no
   model for them. The existing explore view can keep sigma for its static
   whole-graph overview; they serve different jobs.

**A cheap early experiment.** The orinoco site's `consumer-contract.json`
declares a record catalogue at `edit/data/record-sources.json` whose fields
include `rdf_turtle` per record. If that holds, the CON graph is already
available as RDF per node -- which means an expander-driven explorer could be
prototyped against the *research-group* graph, where all data is local and
free, before any ssh or git probing is written. Get the interaction model right
on the easy graph, then point it at the hard one.

## 7. Open questions

1. Does `www.psychoinformatics.de` publish orinoco-shaped records or a
   `graph.json`? If yes, "load another group's graph" is nearly free. If it is
   a hand-built site, this becomes a scraping problem and the federation story
   changes completely. I could not check -- egress blocked.
2. What is `hub.psychoinformatics.de/orinoco/query-things`? The name suggests
   it may already be the query layer this design needs. Likewise issue #8 in
   `orinoco/tools`, *"Thoughts/ideas on the general datalink application
   landscape"*, is very likely to overlap with sections 4-5 above and should be
   read before proposing anything.
3. Is `dlthings:Statement` + `characterized_by` performant enough as the edge
   representation at worldmap scale, or is it a serialization format that gets
   indexed into something else at load time? (I would expect the latter.)
4. Does the `pav:` addition of 2026-08-18 already cover observation
   provenance?
5. Should the git worldmap records live in the *same* store as the group
   records? They interconnect naturally -- an `XYZProject` has clones, a
   `XYZPerson` maintains them -- and keeping one store is what makes "the same
   explorer, different view profile" real rather than aspirational.
