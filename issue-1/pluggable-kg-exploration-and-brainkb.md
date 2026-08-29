# Pluggable knowledge-graph exploration, and where BrainKB sits

Third follow-up in this directory. The architecture from the earlier documents
is now fixed: a **local knowledge graph extended by dynamic exploration**, with
**pluggable expansion elements** (git remotes; external research-group graphs;
later, other knowledge bases) and **multiple views over one graph** (remotes vs.
people/groups vs. ...).

This document asks two things. First: what existing systems already implement
that shape, and what should be borrowed. Second, as specifically asked: how
much does [BrainKB](https://brainkb.org/) -- which builds graphs of *evidence
toward research facts* -- align on pluggable architecture, interactive
exploration, and updates to graph elements? It also assesses the
**dump-things-service** suggestion raised mid-research.

## How this was verified

`brainkb.org`, `docs.brainkb.org`, `hub.psychoinformatics.de` and
`concepts.datalad.org` are egress-blocked here. GitHub clone works, so the
primary sources were read directly:

| Source | Commit / state |
| --- | --- |
| `sensein/BrainKB` | `83d137d`, 2026-07-23 |
| `sensein/brainkb-ui` | `4239b10`, 2026-05-04 |
| `christian-monch/dump-things-server` | `0c88352`, 2026-01-29 (mirror; upstream moved to `hub.psychoinformatics.de/datalink/dump-things-server`) |
| `con/dump-research-info` | `397b560`, 2026-08-07 |

Anything sourced only from search results is marked `[web]`, and anything I
could not confirm at all is marked `[UNVERIFIED]`. The BrainKB paper itself
(Chhetri et al., *BrainKB: A large-scale knowledge graph Infrastructure for
Neuroscience*) I saw only as a search result, not in full. `[web]`

## 1. dump-things-service: yes for the store, no for the traversal

This is the right instinct and it slots straight into the design, but it solves
one half of the problem cleanly and does not touch the other half at all.

**What it is** (from the README): a service storing records in **collections**,
each collection bound to a **LinkML schema**. It explicitly *"supports schemas
that are based on Datalad's `Thing` schema"* and assumes stored records are
subclasses of `Thing` inheriting `pid` and `schema_type`. So it is purpose-built
for exactly the model reviewed in the previous document.

What it gives, and it is a lot of unglamorous work already done:

* **Backends**: `record_dir` (YAML tree, per the `dump-things-storage-v0`
  layout), `sqlite`, and `+stl` ("schema-type-layer") variants of each. The
  YAML-tree backend is git-friendly by construction; the SQLite one is the
  queryable one.
* **Incoming vs. curated areas** per collection, with curation as an explicit,
  out-of-band step. That is a genuinely good fit for crawled data: machine
  output lands in *incoming*, a human promotes it.
* **Token-based authz** with per-collection read/write permissions, a
  **submitter ID**, and token-specific **zones** within the incoming area, so
  several crawlers can write without colliding. Backends for auth are
  `config` or **Forgejo** -- resolving user, org-team membership and repo
  access against a Forgejo instance. In an ecosystem already running
  forgejo-aneksajo, that is close to free multi-user support.
* **Validation on write**, plus a dedicated `POST /<collection>/validate/record/<class>`
  that validates without storing.
* **Serves both JSON and Turtle** (`format=ttl`), so the RDF export path for
  Ontosphere/SPARQL costs nothing extra.
* `pip install dump-things-service`; FastAPI; `/docs` gives the OpenAPI surface.

**Where it stops.** The retrieval API is, in full:

| Endpoint | Yields |
| --- | --- |
| `GET /<collection>/record?pid=<pid>` | one record by identifier |
| `GET /<collection>/records/<class>` | all records of a class (and subclasses) |
| `GET /<collection>/records/p/<class>` | the same, paginated (`page`, `size`) |
| `GET /<collection>/records/` | all readable records |
| `POST /<collection>/record/<class>` | store |
| `POST /<collection>/validate/record/<class>` | validate only |
| `DELETE /<collection>/record?pid=<pid>` | remove from incoming |

Filtering is the `matching` parameter, which is a **substring match with `%`
wildcards against the JSON string representation** of the record, honoured by
the SQLite backends and *ignored* by `record_dir`. There is no SPARQL endpoint and no
traversal, and -- as far as *this API* goes -- no way to ask "what links to
this `pid`?".

> **Superseded in part.** `query-things` implements both link directions
> client-side, including a recursive backward filter and cross-collection pid
> resolution. See
> [repo-embedded-things-and-collections.md](./repo-embedded-things-and-collections.md)
> section 1. What remains missing is an *index*, not the semantics.

That matters because expansion is a backward query. Records point outward:
`XYZProject.associated_with -> person`, `Clone.hasRemote -> clone`. Expanding a
*person* node means finding every record that references them, which over this
API is "fetch all records of every class and scan" -- fine for the 1,038-node
CON graph, wrong as a primitive.

**Verdict: adopt as the record store and write/validate/authz layer; do not
expect it to be the query engine.** Put a derived index in front of it -- the
`.worldmap/cache.sqlite` from the architecture document, now recast as a
forward/backward adjacency index built by walking `GET /<collection>/records/`
once and maintained incrementally. Two consequences worth stating plainly:
the index is a cache, never a source of truth, so it can be deleted and
rebuilt; and a `GET /<collection>/backlinks?pid=` endpoint would be a small,
obviously-useful upstream contribution that removes the need for clients to
hold the whole collection.

`con/dump-research-info` shows the intended workflow already running: records
gathered per source into `data/<source>/<Class>.json`, validated against
`demo-research-information` through the service's REST API, committed to git,
and dumped to a server instance. That is the batch half of the "expander =
source adapter" idea from the previous document, already built.

## 2. BrainKB: strong on evidence and ingestion, weak on exactly what we need

### What it actually is

A microservice platform (`sensein/BrainKB`), part of the BRAIN Initiative Cell
Atlas Network (BICAN) knowledgebase effort. `[web]` for the BICAN framing; the
services below are read from the repo:

| Component | Role |
| --- | --- |
| `query_service` | FastAPI; SPARQL query **and ingestion** |
| `oxigraph` | the triple store (SPARQL over HTTP, port 7878) |
| `ml_service` | FastAPI; **StructSense** multi-agent NER/structured extraction, and **SynthScholar**, a PRISMA-guided literature-review pipeline (search → screening → appraisal → synthesis) with SSE progress and markdown/JSON/RDF export |
| `APItokenmanager` | Django; JWT users, scopes, per-endpoint permissions |
| `usermanagement_service`, `chat_service`, `ollama` | accounts, LLM chat, local models |
| Postgres + pgAdmin | relational side |

Notably the README still documents a `graphdb` component while the tree
contains `oxigraph` and the code references it far more often (94 mentions vs.
16), i.e. a migration from GraphDB to **Oxigraph** looks done or nearly so.
Oxigraph is the same engine the semantic-layer document floated for our RDF
path, which is a mild independent endorsement.

The **Evidence Assertion Ontology** -- a model for types and relationships of
evidence and assertions, so that claims carry structured provenance rather than
sitting as unstructured statements -- is the conceptual heart of the project.
`[web]`; it is **not** in the main repo (no match for `evidence.?assertion`
anywhere in the tree) and I could not locate its own repository. `[UNVERIFIED]`

### Alignment on the three axes asked about

**Pluggable architecture — weak/absent.** There is no connector, plugin, or
adapter interface anywhere. Extension means adding a microservice to
`docker-compose.unified.yml`. Ingestion is a service endpoint you push RDF at,
not a registry of typed sources that a UI can enumerate and invoke. Nothing
resembles Maltego transforms or Translator knowledge providers.

**Interactive exploration — much weaker than the framing suggests.** The UI
(`sensein/brainkb-ui`, Next.js 14 + React 18) has exactly one graph component,
`src/app/components/playground/GraphVisualization.tsx`, 764 lines of **d3
force-directed** rendering with zoom, drag, hover tooltips and click. Reading
`src/app/playground/page.tsx`, its data comes from `parseTriplesFile` /
`extractTriplesFromPDF` over an **uploaded file** -- and `onNodeClick` selects a
node, it does not expand. So the graph view is a **submission preview and
validation aid for a file you are contributing**, not an explorer of the live
triple store. The live KG is reached through SPARQL and card/detail pages, not
through a navigable graph.

**Updates to graph elements — genuinely strong, and the best part to learn
from.** Contribution is first-class: researchers submit assertions with
supporting evidence from publications `[web]`; the query service does ingestion
as well as querying; JWT scopes and RBAC gate who may write (a `user-rbac`
branch was merged as recently as 2026-07); and the ML service will *extract*
candidate structured knowledge from literature for a human to approve. That
pipeline -- machine proposes, human curates, store records with provenance --
is the same shape as dump-things' incoming/curated split, arrived at
independently.

**Per-model views — present, but hand-authored.** `brainkb-ui` carries
`src/config/yaml/*.yaml` files such as `celltaxon_card.yaml`,
`LA_card.yaml`, `libraryaliquot-detail.yaml`: per-entity-type card and detail
layouts as configuration. That is precisely the "tune the view per model" idea
-- but written by hand per class, rather than derived from the schema the way
shacl-vue derives forms from SHACL. Worth noting as the fallback design if
schema-derived views prove too rigid.

### So: how much does it align?

| Requirement | BrainKB | Notes |
| --- | --- | --- |
| Pluggable expansion sources | ✗ | microservices, no adapter interface |
| Click-to-expand exploration | ✗ | d3 graph is over an uploaded file; click = select |
| Persisted, resumable view | ✗ | no evidence of saved workspaces |
| Updates / contributions to the graph | ✓✓ | ingestion, RBAC, LLM-assisted extraction |
| Evidence & provenance modelling | ✓✓ | the project's entire premise |
| Per-model views | ✓ | hand-written YAML cards per class |
| Multi-user auth | ✓✓ | JWT scopes, RBAC |

**Judgement.** BrainKB is not a system to build on and not a competitor; it is a
*sibling with the opposite emphasis*. We are strong where it is weak
(exploration, pluggable acquisition) and it is strong where we have barely
started (evidence semantics, contribution workflow, multi-user trust). The
alignment worth pursuing is at the **model** level, not the code level: if our
observations were expressible in something compatible with an
evidence/assertion vocabulary, then "yarik's laptop has a remote named
`rolando-exchange` pointing at UUID 407…, observed 2026-08-22 via ssh from
typhon" and "gene X is associated with disease Y, per PMID Z" are the same
shape of statement -- a claim, its evidence, and its provenance. That is a real
and cheap alignment, and it argues for not inventing a bespoke observation
record without first checking it against the prior art in section 4.

The most concrete near-term action: find and read the Evidence Assertion
Ontology before finalising the observation model.

## 3. The pluggable-expansion landscape

### NCATS Biomedical Data Translator -- the reference architecture

This is the most developed answer to "pluggable knowledge sources" in
existence, and it is worth studying even though the domain is unrelated. `[web]`
Its structure:

* **Knowledge Providers (KPs)** -- services each specialising in one or a few
  kinds of knowledge, exposing a standard API over their own data.
* **Autonomous Relay Agents (ARAs)** -- reasoning agents that choose which KPs
  to ask, then organise, rank and merge results.
* **Autonomous Relay System (ARS)** -- the broker tying them together.
* **TRAPI** (`NCATSTranslator/ReasonerAPI`) -- a standard HTTP API for posing
  graph queries and returning answers.
* **Biolink Model** -- the shared semantic layer of entity and relation types,
  with mappings to other ontologies and ranked preferred identifier types.

Three lessons transfer directly:

1. **Pluggability requires a query contract, not just a plugin hook.** TRAPI is
   what makes a KP swappable. Our equivalent is a typed expansion request:
   *given this node of type T, follow relation R, return nodes and
   observations*. Design that contract before writing the second expander.
2. **The shared semantic layer is the hard part**, and Biolink's investment in
   *identifier preference and mapping* is telling -- most of the pain is
   deciding when two identifiers denote the same thing. Our version is URL
   canonicalisation, annex UUIDs and `same_as`, and it will be similarly
   central.
3. **Separating "who has knowledge" from "who decides what to ask"** (KP vs.
   ARA) is what our design calls expanders vs. the exploration UI. Keeping that
   boundary means a crawl policy can later be automated without touching any
   expander.

Also from that world: **Knowledge Beacons**, an earlier web-service workflow
for harvesting distributed biomedical knowledge behind a uniform API `[web]`
-- same idea, older, largely superseded, but evidence the pattern recurs.

### Others, briefly

* **Comunica** -- a modular, configurable SPARQL engine that federates over
  heterogeneous sources (endpoints, files, TPF). If the store ever speaks RDF,
  Comunica makes "query across my worldmap *and* another group's published
  graph" a configuration change rather than a feature. Already a dependency of
  ontosphere, so the ecosystem knows it.
* **Maltego / OpenCTI / SpiderFoot / Recon-ng** -- covered in
  [architecture-persistence-and-prior-art.md](./architecture-persistence-and-prior-art.md);
  the transform/connector model remains the closest UX analogue.
* **MCP as an expander transport** -- worth considering, not adopting yet. An
  expander is "a typed capability with a schema, invoked on demand, returning
  structured data", which is what an MCP tool is. The upside is that expanders
  become reusable by agents as well as by the UI; the downside is a protocol
  dependency for what is otherwise a Python entry point. Revisit once the
  in-process interface has stabilised.

## 4. Evidence, assertions, and our "observation" record

The previous documents proposed observations carrying `t_observed`, `by`, `via`
and `status`. That is a re-derivation of a well-trodden pattern, and it should
be aligned rather than invented.

**Nanopublications** are the closest fit. `[web]` A nanopublication is the
smallest publishable unit of information, in RDF, with three named graphs:

* the **assertion** -- the claim itself;
* the **provenance** -- of that assertion (how it was arrived at);
* the **publication info** -- provenance of the nanopublication as an object
  (who published it, when).

That three-way split maps onto our problem almost exactly: the assertion is
"clone A has remote R pointing at B"; the provenance is "observed via ssh from
host V by probe P"; the publication info is "recorded by this crawl run at time
T". The two-level provenance distinction -- of the claim vs. of the record of
the claim -- is one my earlier proposal collapsed, and it is the distinction
that lets you say "this fact was true when observed, and here is separately who
observed it".

There is also a decentralised network with a registry and SPARQL access, and
active tooling (an ESWC 2025 tutorial, `nanopub.net` guidelines). `[web]`
Whether to *publish* nanopublications is a separate question from whether to
*model like* them; I would model like them and defer publishing.

Adjacent, worth checking before finalising: **PROV-O** (already in
datalad-concepts as `prov-mixin`), **SEPIO** (Scientific Evidence and
Provenance Information Ontology) `[UNVERIFIED — not checked directly]`, **CiTO**
for typed citation links, **Wikidata's** references-and-qualifiers model as the
most battle-tested editable-KG-with-provenance in existence, and **RDF-star**
(noting from the semantic-layer document that RDF 1.2 only reached CR in 2026,
so it is early).

## 5. Declarative, model-driven UI platforms

For "different views of the same graph, tuned per model", four reference points:

| Platform | License | Model-driven UI | Editing | Graph exploration | Verdict |
| --- | --- | --- | --- | --- | --- |
| **metaphactory** | commercial (~$52.9k/yr `[web]`) | declarative UI templating, knowledge-pattern-based authoring | yes | yes | the most complete realisation of this idea; unaffordable, but the best design reference |
| **LinkedDataHub** (AtomGraph) | **Apache-2.0** | *"applications and documents are defined as data"*; XSLT/ontology-driven, fully overridable | RDFa-aware editor, SPARQL | not confirmed | genuinely open, genuinely declarative; Java/XSLT stack is a poor fit for this ecosystem |
| **shacl-vue** | MIT | forms/viewers generated from SHACL+DASH | yes | none | already in the ecosystem; the editing half of our problem, solved |
| **Reactodia / ontosphere** | LGPL / Apache-2.0 | generic RDF canvas | limited | yes | the exploration half, generic-only; assessed in the previous document |

The pattern across all four: **the model drives the UI**, and the difference is
only how much of the UI is derived versus configured. metaphactory and
LinkedDataHub prove the ceiling is high. shacl-vue proves the approach works in
*this* ecosystem, on *these* schemas. Nobody in the table does model-driven
*graph exploration* -- which remains the gap, and is why the `graph:`
annotation proposal from the previous document is the right shape.

One term worth stealing: Neo4j Bloom calls its per-audience configurations
**"perspectives"** `[web]` -- a named bundle of which types are visible, how
they are styled, and which relationships matter. "Perspective" is a better
public name than "view profile" for what issue #1 (remotes) and the research
group graph (people) each need.

## 6. Synthesis

The pieces the ecosystem already has, and the one it does not:

```
  records + schema + validation + authz  →  dump-things-service        ✓ exists
  model → forms/editing                  →  shacl-vue                  ✓ exists
  model → static site                    →  orinoco                    ✓ exists
  model → RDF/OWL/SHACL                  →  datalad-concepts (LinkML)   ✓ exists
  evidence/assertion semantics           →  nanopub pattern, BrainKB EAO ~ borrow
  pluggable acquisition contract         →  TRAPI/Maltego as reference  ✗ build
  model → GRAPH EXPLORATION + expansion  →  nothing                     ✗ build
  backward index ("what points here?")   →  nothing                     ✗ build
```

Two things to build, one contract to design, and everything else adopted. That
is a much smaller project than it looked three documents ago.

**Recommended shape:**

1. **Store**: dump-things-service, `record_dir` backend for git-friendliness,
   with a locally derived SQLite adjacency index for traversal. Incoming area
   for crawler output, curated area after review.
2. **Model**: datalad-concepts + a proposed `things-vcs` module + an
   observation record modelled on the nanopublication three-way split.
3. **Expansion**: a typed contract -- `(node_type, relation) -> [nodes,
   observations]` -- with expanders registered against it. Git remotes, ssh
   probes, forge APIs, and *loading another group's dump-things collection* are
   all the same interface.
4. **Views**: `graph:` annotations in the model, bundled into named
   **perspectives** ("remotes", "people", "provenance").
5. **UI**: Cytoscape.js explorer talking to the local daemon; shacl-vue reused
   for the record-editing panel rather than reimplemented.

**The strongest cross-check available**, and it is cheap: the CON research-group
graph and the git worldmap should be **two collections in one
dump-things-service, explored by one UI under two perspectives**. If that works,
the pluggability claim is proven on genuinely different data with no external
dependencies. If it does not, the design is wrong and it is far better to learn
that on 1,038 local records than after building ssh crawling.

## 7. Open questions

1. Where is the BrainKB Evidence Assertion Ontology published, and is it
   LinkML, OWL, or SHACL? It should be read before our observation model is
   fixed.
2. Would upstream accept a `backlinks`/`referencing` endpoint on
   dump-things-service, or is client-side indexing the expected pattern?
3. Does the `record_dir` backend's on-disk layout
   (`concepts.datalad.org/dump-things-storage-v0/`) diff and merge well enough
   to be the canonical git-stored form? Unverified -- the spec page is blocked
   here.
4. Is `orinoco/query-things` (still unread, hub blocked) already the traversal
   layer this document says is missing? This remains the single most important
   unknown across all three follow-ups.
5. Should the worldmap ever *publish* nanopublications, or only borrow their
   structure?
