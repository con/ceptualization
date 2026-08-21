# Semantic / ontology layer for the git worldmap

Scope: issues [#1](https://github.com/con/ceptualization/issues/1), [#4](https://github.com/con/ceptualization/issues/4),
[#5](https://github.com/con/ceptualization/issues/5), [#6](https://github.com/con/ceptualization/issues/6).

Evidence date: **2026-08-21**. Everything below was checked by cloning the repos and reading the source,
or by fetching the raw file, unless marked `[UNVERIFIED]`.
Local clones used for this report live in the session scratchpad
(`quay`, `ontosphere`, `dlconcepts`, `forgefed`, `doap`, `Git2PROV`, `spdx3`).

---

## TL;DR — verdict on quay and ontosphere

1. **QUAY is a real, well-built OWL ontology — but it is not a language for *this* graph.** It has **zero**
   terms for repository, clone, remote, branch, commit, fork, host, or annex UUID
   (`grep -c 'Repository' src/ontology/quay-edit.owl` → **0**; `grep -ci 'annex'` → **0**).
2. QUAY models **how you fetch bytes** (protocol / auth / operation / delivery / coverage / SLA / encryption),
   not **who has a copy and how the copies are wired together**. Our worldmap is 90% topology and identity,
   which is exactly QUAY's blind spot.
3. QUAY's 14 git-annex "patterns" are ABox examples of *remote types* — each special remote flavour rendered as
   one `dcat:Distribution`. They describe the **species**, never the **individuals**. Useful as a controlled
   vocabulary for one node attribute; useless as the graph model.
4. **QUAY is 4 days old.** First commit `2026-08-17 12:28`, 31 commits, one human author, one tag `v0.0.1`
   (2026-08-18). Its own design doc puts "provenance tracking" **out of scope**. Betting the data model on it is
   an over-engineering trap with a bus factor of 1.
5. **Verdict on quay: (d)→(b). Irrelevant as "the language"; genuinely usable as a small imported vocabulary**
   for the special-remote *flavour* axis (`quay:S3Protocol`, `quay:SshKeyAuthentication`, `quay:GpgEncryption`, …)
   — and even there it lacks git-annex's own crucial distinctions (exporttree / importtree / chunking / trust).
6. **Ontosphere is a serious piece of software** — Apache-2.0, v1.7.3, 961 commits since 2025-09-10, React 19 +
   Reactodia canvas + N3.js + Comunica SPARQL + SHACL + Konclude OWL 2 DL in WASM + a 43-tool MCP server,
   100% client-side, live demo, Zenodo DOI.
7. **But it is a generic RDF/OWL *ontology editor*, not a domain app.** No persistence (graph lives in memory;
   `localStorage` holds only settings), fixed named-graph partitions, generic node cards — no badges for
   bare-vs-worktree, no error highlighting for duplicate annex UUIDs, no "aheadness", and it can't ssh anywhere.
8. **Verdict on ontosphere: (b) — usable with effort, but as a free dev-time *inspector*, not as the product.**
   Export `worldmap.ttl`, open `https://thhanke.github.io/ontosphere/?rdfUrl=<raw github url>`, eyeball it.
   That is a genuinely nice zero-cost win. Building con/ceptualization *on top of* it means inheriting a
   one-developer 65 kLOC app, LGPL transitive deps, and a COOP/COEP hosting requirement.
9. **The vocabulary that actually fits is ForgeFed** (`https://forgefed.org/ns#`): `Repository`, `Branch`,
   `Commit`, `Push`, `cloneUri`, `forkedFrom`, `forks`, `mirrors`/`mirroredFrom`. It covers the forge half of
   issue #6 out of the box. It does **not** cover git-annex.
10. **Recommendation: define our own small model in LinkML** (the same tooling `concepts.datalad.org` uses),
    map its terms onto ForgeFed / DOAP / PROV-O / schema.org / QUAY via `exact_mappings`, and **store the
    worldmap as plain canonical JSON**. Ship RDF as a *generated export*, not as the runtime substrate.
    Do not put a triple store in the browser for a graph of a few hundred nodes.

---

# Part A — deep dive

## A.1 QUAY (https://github.com/ThHanke/quay)

### What it is

> "# QUAY: Qualified Usage, Access and Yield
> A DCAT Profile for Data Access, Storage and Authorization Metadata."
> — `README.md`, lines 1–3

| Fact | Value | Evidence |
|---|---|---|
| Kind | OWL 2 ontology (TBox) + SHACL shapes + ABox example patterns. **Not** software. | repo layout |
| Namespace | `https://w3id.org/quay/` | `README.md`, `project-odk.yaml` |
| Ontology IRI | `https://w3id.org/quay/quay.owl` | `README.md` |
| Edit format | OWL Functional Syntax, `src/ontology/quay-edit.owl` (40 KB) | `project-odk.yaml: edit_format: owl` |
| Build system | **ODK** — INCATools [Ontology Development Kit](https://github.com/INCATools/ontology-development-kit) (the OBO-Foundry toolchain: ROBOT, SLME import modules, ID ranges, QC SPARQL) | `src/ontology/Makefile` (27 KB), `run.sh`, `.github/workflows/qc.yml` |
| Imports | DCAT 3 (`w3.org/ns/dcat3.ttl`), Dublin Core Terms, ODRL 2.2 — as SLME modules | `imports.txt`, `project-odk.yaml` |
| Release artefacts | `quay.owl` / `quay.ttl` / `quay.json` (+ `-base`, `-full`) | `src/ontology/` |
| License | **CC-BY-4.0** (`LICENSE` = Creative Commons Attribution 4.0) | `LICENSE` line 1, `project-odk.yaml` |
| Live resolution | `https://w3id.org/quay/` — `[UNVERIFIED]`, w3id.org is blocked by this session's egress proxy. The repo carries `w3id/.htaccess` with rewrite rules, so a w3id PR was at least prepared. |
| Docs site | GitHub Pages branch `gh-pages` exists | `git branch -a` |

### Data model — what it actually contains

Counted directly from `src/ontology/quay-edit.owl`:

- **65 `quay:` classes**, **13 object properties**, **8 datatype properties** = 86 declared entities.
  (The README says "71 OWL entities" — a minor internal inconsistency, not important.)

Classes, verbatim:

```
AccessDescription YieldDescription
Protocol:        BitTorrentProtocol FtpProtocol GitProtocol HookProtocol HttpProtocol IpfsProtocol
                 LocalFilesystemProtocol RcloneProtocol RsyncProtocol S3Protocol SshProtocol WebDavProtocol
AuthenticationScheme: ApiKeyAuthentication AwsCredentialAuthentication BasicAuthentication GpgKeyAuthentication
                 NoAuthentication OAuth2Authentication SshKeyAuthentication
Operation:       ReadOperation WriteOperation DeleteOperation ListOperation ReplicateOperation
DeliveryMode:    BulkDelivery EventDrivenDelivery PaginatedDelivery PeerToPeerDelivery StreamingDelivery
                 SynchronousDelivery
TemporalQuality: Archived RealTime Snapshot Versioned
Coverage:        CompleteCoverage IncrementalCoverage SampleCoverage SubsetCoverage
ServiceQuality:  BestEffort Distributed HighAvailability SingleHost
VerificationMethod: ContentAddressing DigitalSignature HashVerification PieceVerification NoVerification
EncryptionAlgorithm: Aes128Encryption Aes256Encryption GpgEncryption NoEncryption SshEncryption
                 Tls12Encryption Tls13Encryption
```

Object properties: `accessDescription authenticationScheme coverage deliveryMode encryptionAtRest
encryptionInTransit protocol serviceQuality storageJurisdiction supportedOperation temporalQuality
verificationMethod yieldDescription`

Datatype properties: `costDescription quotaLimit rateLimit recoveryPointObjective recoveryTimeObjective
replicationFactor retentionPeriod uptimePercentage`

Real logical axioms are present, e.g.:

```
SubClassOf(:AccessDescription ObjectSomeValuesFrom(:authenticationScheme :AuthenticationScheme))
SubClassOf(:AccessDescription ObjectExactCardinality(1 :protocol :Protocol))
DisjointClasses(:AccessDescription :AuthenticationScheme :Coverage :DeliveryMode :EncryptionAlgorithm
                :Operation :Protocol :ServiceQuality :TemporalQuality :VerificationMethod :YieldDescription)
```

Plus SHACL shapes mirroring the OWL restrictions (`src/shacl/quay-shapes.ttl`), and ISO 704
genus-differentia definitions on `obo:IAO_0000115`. This is competent ontology engineering.

### The git-annex patterns — read them closely

23 ABox examples: 14 git-annex remotes + 9 generic. Here is the **entire** `git` pattern
(`src/patterns/git-annex-remotes/git/shape-data.ttl`), the one most relevant to us:

```turtle
ex:git-dataset a dcat:Dataset ; dcterms:title "Version-Controlled Research Data" .

ex:git-distribution a dcat:Distribution ;
    dcat:accessURL <ssh://git@gitlab.example.org/research/data.git> ;
    quay:accessDescription ex:git-access ;
    quay:yieldDescription ex:git-yield ;
    quay:encryptionInTransit [ a quay:SshEncryption ] ;
    spdx:checksum [ a spdx:Checksum ; spdx:algorithm spdx:checksumAlgorithm_sha256 ] .

ex:git-access a quay:AccessDescription ;
    quay:protocol [ a quay:GitProtocol ] ;
    quay:authenticationScheme [ a quay:SshKeyAuthentication ] ;
    quay:supportedOperation [ a quay:ReadOperation ] , [ a quay:WriteOperation ] ,
                            [ a quay:DeleteOperation ] , [ a quay:ReplicateOperation ] .

ex:git-yield a quay:YieldDescription ;
    quay:deliveryMode [ a quay:BulkDelivery ] ; quay:temporalQuality [ a quay:Versioned ] ;
    quay:coverage [ a quay:CompleteCoverage ] ; quay:serviceQuality [ a quay:BestEffort ] ;
    quay:verificationMethod [ a quay:HashVerification ] .
```

**Note what is absent**: no annex UUID, no remote *name*, no second repository, no edge to anything. There is
exactly one dataset and one distribution. The pattern describes "what a git remote is like", not "clone X on
host Y calls clone Z `rolando-exchange`". Every one of the 14 patterns has this shape.

The design doc is explicit (`docs/brainstorms/quay-ontology-design-requirements.md`):

> "Git-annex special remotes serve as **validation use cases** because they already deal with the same domain
> … without a formal ontology."
> "**Not git-annex-specific:** git-annex is validation material."
> "**Out of scope for this draft:** SHACL shapes, full ODRL policy examples, **provenance tracking**, API documentation."

### Maturity / risk

| Signal | Value |
|---|---|
| First commit | `2026-08-17 12:28:02 +0000` — **4 days before this report** |
| Total commits | 31 (20 + 2 by Thomas Hanke, 17 by GitHub Actions bots) |
| Human contributors | **1** (Thomas Hanke, Fraunhofer IWM) |
| Tags | `v0.0.1` only, released `2026-08-18` |
| Known users | none found |
| Whole TBox authored in | ~5 hours on 2026-08-17 (`17:02 → 18:05` commit window) |

**Blunt verdict on quay: (d) irrelevant as "the language for the graph", sliding to (b) as an optional imported vocabulary.**

Concretely, what QUAY *can* do for issue #1's bullet
"*distinguish special remote: encrypted or not / keystore vs exporttree / importtree*":
it gives you `quay:GpgEncryption` vs `quay:NoEncryption` and `quay:S3Protocol` vs `quay:RsyncProtocol`, so about
**one of those three distinctions**. It has no `exporttree`, `importtree`, `chunk`, `versioning`, `autoenable`,
or trust-level (`trusted`/`semitrusted`/`untrusted`/`dead`) terms — all of which come straight out of
`git annex info --json` and are exactly what the renderer needs to badge. We would have to define those ourselves
anyway. Adding QUAY buys us a controlled URI for `protocol` and `encryption` and costs us an OWL import,
an ODK-shaped upstream, and a dependency on a 4-day-old v0.0.1 with a bus factor of 1.

**If we go RDF at all**: cite QUAY class IRIs as `exact_mappings` on our own enum values. Do not `owl:imports` it,
and do not model our nodes as `dcat:Distribution`.

---

## A.2 Ontosphere (https://github.com/ThHanke/ontosphere)

### What it is

> "Browser-based RDF knowledge-graph editor with client-side OWL 2 DL reasoning, reasoner-verified repair,
> and a Model Context Protocol server for AI agents." — `README.md`

> "All computation runs entirely client-side in the browser against an in-memory RDF store backed by
> Web Workers — no backend required." — `CITATION.cff` abstract

| Fact | Value | Evidence |
|---|---|---|
| Kind | Single-page **application** (not a library) | `package.json`, `index.html`, `vite.config.ts` |
| License | **Apache-2.0** | `LICENSE`, `package.json` |
| Version | `1.7.2` in `package.json`, tag `v1.7.3` is latest | `git tag` |
| Size | **65 236 lines** of `.ts`/`.tsx` under `src/` | `wc -l` |
| Live demo | https://thhanke.github.io/ontosphere/ — **yes**, and QUAY links to it from every pattern | `README.md`, `package.json: homepage` |
| DOI | `10.5281/zenodo.19605270` (concept DOI) | `CITATION.cff` |
| Paper | `ontosphere-iswc2026-paper.pdf` in-repo; badge says "ISWC 2026"; last commits say "adapt for DMKG 2026 workshop submission". Whether either was *accepted* is `[UNVERIFIED]`. | `git log`, `README.md` |
| npm | **not published** (`registry.npmjs.org/ontosphere` → `{"error":"Not found"}`) | curl |

### Stack (from `package.json`, verified versions)

- **UI**: React 19.2, TypeScript 5.9, Vite 7, Tailwind 4, Radix UI / shadcn, zustand 5, react-router 7.
- **Canvas**: `@reactodia/workspace` 0.34.1 — the diagramming engine (descendant of Ontodia).
  **License: LGPL-2.1-or-later** (verified via npm registry).
- **RDF core**: `n3` 1.26 (in-memory store, the source of truth), `rdf-parse` 4, `@rdfjs/data-model` 2,
  `rdf-canonize` 5 (W3C RDFC-1.0 canonical N-Quads + SHA-256 content hash).
- **Query**: `@comunica/query-sparql-rdfjs` 5.2 — SPARQL over the in-memory store, in a Web Worker
  (`vite-plugin-worker-comunica.ts`).
- **Validation**: `shacl-engine` 1.1 (rdf-ext).
- **Reasoning**: `rdf-reasoner-konclude` ^0.6.9 — Konclude OWL 2 DL tableau reasoner compiled to WASM.
  **License: LGPL-3.0-or-later**.
- **Layout / clustering**: `dagre`, `elkjs`, `ngraph.louvain`, `ngraph.slpa`, `ml-kmeans`.
- **Agent surface**: MCP server exposed via `navigator.modelContext`, manifest at `/.well-known/mcp.json`,
  **43 tools** across 9 categories (`loadRdf`, `addNode`, `addTriple`, `expandNode`, `queryGraph`,
  `runReasoning`, `explainDiagnostics`, `validateGraph`, `revertAgentBatch`, `exportGraph`, …).

### How data gets in and out

- **In**: `?rdfUrl=` (Turtle / N-Triples / N3 / RDF-XML / JSON-LD, or a SPARQL endpoint, or a Fuseki dataset root),
  `?ontologies=` / `?ontology=`, `?shaclShapes=`, `?apiKey=` + `?apiKeyHeader=`, and automatic `owl:imports`
  discovery (`?loadImports=false` to disable).
- **Out**: export Turtle / RDF-XML / JSON-LD for one graph, or **N-Quads / TriG preserving the named-graph
  partition** so a dataset round-trips.

### Named graphs — a limitation that matters for us

The store uses **fixed** graph URNs, not arbitrary per-source graphs
(counted occurrences across `src/`):

```
urn:vg:data (206)  urn:vg:ontologies (104)  urn:vg:inferred (82)  urn:vg:workflows (37)
urn:vg:shapes (18)  urn:vg:scratch (9)  urn:vg:provenance (5)  urn:vg:inferredTypes (5)
```

So "one named graph per discovery event / per host we ssh'd into" — the natural home for issue #1's
incremental-discovery provenance — is **not** a supported partitioning. There is a `urn:vg:provenance` graph,
but it is for PROV-O records of *agent edits made in the app*, with diff and one-click batch reversal.
Useful, but it tracks "the MCP agent added this triple", not "I learned this by ssh-ing into typhon at 14:02".

### Persistence

There is essentially none for the graph. `localStorage` is used only for settings/theme and one relay guard key
(`src/utils/stateStorage.ts` wraps `window.localStorage` for the zustand settings store; the only literal key
found in the codebase is `relay-annotation-guard-s`). Reload the tab and the graph is gone unless you re-fetch
`?rdfUrl=` or re-import an exported file. For issue #1's "save/reload the worldmap", the workflow would be
*manual export → commit → reopen with `?rdfUrl=raw.githubusercontent.com/...`*. That works — QUAY does exactly
this — but it is not "the app persists your worldmap".

### Maturity / risk

| Signal | Value |
|---|---|
| First commit | 2025-09-10 |
| Last commit | **2026-07-23** (~1 month stale as of 2026-08-21) |
| Commits | 961 |
| Contributors | Thomas Hanke 1575, `POTUSAITEJA` 30 → effectively **1.2 developers** |
| Tags | 16, `v1.0.0` … `v1.7.3` |
| Tests | vitest unit tests + Playwright e2e + benchmarks — genuinely present |
| Deployment constraint | needs **COOP/COEP cross-origin isolation** headers or the WASM reasoner silently degrades |
| Perf (their own numbers) | LUBM+data 100 850 triples → 1.4 s WASM classify; Roberts family (SROIQ, 3 866 triples) → 30 s. Our worldmap is ~10²–10³ triples, so irrelevant either way — and we don't need a DL reasoner. |

### Blunt verdict on ontosphere

**(b) usable with effort — but only in one specific role.**

**Use it for**: a free, zero-integration *inspector* during development. Emit `worldmap.ttl`, push it to a
branch, and open
`https://thhanke.github.io/ontosphere/?rdfUrl=https://raw.githubusercontent.com/con/ceptualization/main/worldmap.ttl`.
You get pan/zoom, layout, clustering, SPARQL, and SHACL for free, today, with no code. That is a real win and
costs nothing — but it only pays off *if* we serialize to RDF.

**Do not use it as the product**, because every distinguishing requirement of issues #1/#4/#5/#6 is outside its model:

| Requirement | Ontosphere |
|---|---|
| Walk clones over ssh, run `git annex info --json` | impossible — browser tab, no backend |
| Discover forks via GitHub Insights→Network, registry.datalad.org (#6) | no such notion; `expandNode` expands *annotation cards*, not the world |
| Badge bare-vs-worktree, annex-vs-plain, exporttree/importtree | generic RDF node cards; would require forking the renderer |
| Highlight **errors** (duplicate annex UUID, dead remotes) | SHACL violations render as generic badges — closest available, but wrong idiom |
| "Aheadness" numbers on edges (#5) | no edge-weight/label concept beyond predicate IRI |
| Persist the worldmap | export/import only |
| Per-observation provenance | fixed named graphs; PROV-O is for in-app agent edits |
| Licensing | app is Apache-2.0, but bundles LGPL-2.1 (`@reactodia/workspace`) and LGPL-3.0 (`rdf-reasoner-konclude`). For a bundled webapp the LGPL relinking obligation is legally murky. If con/ceptualization ships a permissive artifact, this needs a lawyer's five minutes — or just don't vendor it. |

If we want the *canvas* rather than the *app*, the reusable piece is
**`@reactodia/workspace`** (LGPL-2.1-or-later) directly, or a permissive alternative
(Cytoscape.js MIT, vis-network Apache-2.0/MIT, D3 ISC, Sigma.js MIT, ELK.js EPL).

---

# Part B — existing vocabularies for repositories, clones, and their relations

## B.1 Survey table

Legend for **Fit**: ✅ directly reusable · 🟡 partial / one axis only · ❌ wrong domain.

| Vocabulary | URL / namespace | Covers | RDF? | Fit for our node/edge types | Verdict |
|---|---|---|---|---|---|
| **ForgeFed** | `https://forgefed.org/ns#` · spec at github.com/forgefed/forgefed (mirror of codeberg.org/ForgeFed/ForgeFed) | ActivityPub extension for software forges | Yes — JSON-LD context + AS2 extension | **Classes**: `Repository`, `Branch`, `Commit`, `Push`, `Ticket`, `TicketDependency`. **Properties**: `cloneUri`, `forkedFrom`, `forks`, `mirrors`, `mirroredBy`, `mirrorsTo`, `mirroredFrom`, `hash`, `ref`, `committedBy`, `committed`, `filesAdded/Modified/Removed`, `earlyItems`, `previousVersions`, `currentVersion` (all verified verbatim in `context.jsonld`) | ✅ **best available**. Covers repo identity, clone URI, fork/mirror edges, branches, commits, pushes. Zero git-annex coverage. Spec activity: last commit 2026-05-03; "Spec: Pull Mirrors" merged 2025-08-21; Forgejo is the main implementer. Adopt `forge:Repository`, `forge:cloneUri`, `forge:forkedFrom`, `forge:mirroredFrom`, `forge:Branch`, `forge:Commit`. |
| **DOAP** | `http://usefulinc.com/ns/doap#` · github.com/ewilderj/doap | project↔repository descriptions | Yes (RDFS/OWL) | **Classes**: `Project`, `Version`, `Specification`, `Repository`, `GitRepository`, `GitBranch`, `SVNRepository`, `HgRepository`, `BKRepository`, `CVSRepository`, `ArchRepository`, `BazaarBranch`, `DarcsRepository`. **Properties**: `repository`, `repositoryOf`, `location` (domain `doap:Repository`), `browse`, `anon-root`, `module`, `maintainer`, `developer`, `bug-database`, `download-page`, `programming-language`, … | 🟡 Gives us `doap:GitRepository` and `doap:location` cleanly. But `doap:Repository` is *the project's canonical repo*, one per project — no clone multiplicity, no remote naming, no per-clone identity. Last commit 2024-06-10; venerable, stable, low-churn. Cite `doap:GitRepository` as a mapping; don't build on it. |
| **PROV-O** | `http://www.w3.org/ns/prov#` (W3C Rec 2013) | provenance: Entity / Activity / Agent, `wasDerivedFrom`, `wasGeneratedBy`, `wasAttributedTo`, `wasInformedBy`, `specializationOf`, qualified Generation/Usage/Derivation | Yes | ✅ for the **meta**-layer: "clone C's state was observed by activity A run by agent G at time T". Also the right idiom for `Clone --wasDerivedFrom--> Clone` (a clone genuinely *is* derived from its origin). | ✅ adopt for observations & derivation. Do **not** try to model git topology in PROV — see git2PROV below. |
| **git2PROV** | github.com/mmlab/Git2PROV; paper: De Nies et al., *Git2PROV: Exposing Version Control System Content as W3C PROV*, ISWC 2013 Posters & Demos | converts a git repo's **commit history** to PROV | Yes (PROV-N/PROV-O/JSON) | ❌ wrong granularity. It maps commits→`prov:Activity`, file states→`prov:Entity`, authors→`prov:Agent`, with `wasGeneratedBy`/`used`/`wasDerivedFrom`/`wasInformedBy`/`wasAssociatedWith`/`wasAttributedTo` (verified in `lib/git2provConverter.js`). We care about **clones and remotes**, which it does not model at all. | ❌ **and it is dead**: last commit **2021-03-13**, version `0.1.2`, GPL-3.0; `git2prov.org` does not resolve (DNS `ENOTFOUND` from this session — could be egress, but combined with the 2021 freeze, treat the hosted service as gone). Cite the paper for the idea; do not depend on it. |
| **schema.org** | `https://schema.org/` | `SoftwareSourceCode` with `codeRepository`, `programmingLanguage`, `runtimePlatform`, `targetProduct`; `SoftwareApplication`; `Dataset`/`DataDownload`/`distribution` | Yes (RDFa/JSON-LD) | 🟡 `schema:codeRepository` is a single URL literal on a source-code entity. `schema:Dataset` + `distribution` is what `metalad_core` already emits. No clone/remote/fork terms. (Direct fetch of schema.org blocked by egress; terms confirmed via the CodeMeta context, which maps `codeRepository`, `downloadUrl`, `hasPart`, `distribution`, `identifier`, `version` to `schema:`.) | 🟡 use `schema:codeRepository`/`schema:Dataset` as mappings for interop with metalad output. Not a model. |
| **CodeMeta** | `https://w3id.org/codemeta/terms/` · github.com/codemeta/codemeta | software-metadata crosswalk over schema.org | Yes (JSON-LD context, 83 terms verified) | Terms beyond schema.org: `codeRepository`, `continuousIntegration`, `buildInstructions`, `issueTracker`, `readme`, `developmentStatus`, `referencePublication`, `hasSourceCode`, `isSourceCodeOf`, `maintainer`, `funding`, `embargoEndDate`, `softwareSuggestions`. | ❌ for topology (one repo URL per software project); ✅ if we ever want to say *what software a repo contains*. Not our problem. |
| **SPDX 3.0** | `https://spdx.org/rdf/3.0.1/spdx-model.ttl` · github.com/spdx/spdx-3-model | SBOM; profiles: Core, Software, Licensing, Security, Dataset, AI, Build, Hardware, Operations, Service, SupplyChain, Lite, FunctionalSafety, Extension (verified: `ls model/`) | Yes — RDF/OWL/SHACL | Software profile properties: `downloadLocation`, `homePage`, `packageUrl`, `packageVersion`, `sourceInfo`, `contentIdentifier`/`Type`/`Value`, `artifactSize`, `byteRange`, `primaryPurpose`. Core `RelationshipType` enum has ~90 values incl. `ancestorOf`, `descendantOf`, `copiedTo`, `contains`, `generates`, `hasDistributionArtifact`, `hasVariant`, `availableFrom`, `locatedAt`, `hasHost`. | 🟡 The *relationship-type-as-enum* design is a good pattern to steal. `spdx:Checksum` / `spdx:algorithm` is worth reusing for annex key hashes (QUAY already does this). But SPDX has no clone/remote/fork model and its Build profile is CI provenance, not clone topology. Heavyweight. |
| **Software Heritage / SWHID** | `swh:1:<type>:<hash>` — `snp` snapshot, `rev` revision, `dir`, `cnt`, `rel`; qualifiers `origin=`, `visit=`, `anchor=`, `path=`, `lines=` | intrinsic, content-addressed identifiers over a deduplicated Merkle DAG of all archived source code | SWHIDs are URIs; there is a documented data model. A *normative* RDF ontology: `[UNVERIFIED]` — I could not verify one exists (softwareheritage.org and docs.softwareheritage.org are blocked by this session's egress). SWHIDs *are* referenced from SPDX 3.0 as an external identifier type. | ✅ **for identity, not for topology.** `swh:1:snp:` (a snapshot = "all branches/releases of an origin at a visit") is conceptually *exactly* the aheadness snapshot of issue #5, and `origin=` qualifiers name clone URLs. | Adopt SWHIDs as **optional stable identifiers** on `Commit`/`Snapshot` nodes when a repo is archived in SWH. Do not depend on an SWH ontology existing. |
| **ActivityPub / ActivityStreams 2.0** | `https://www.w3.org/ns/activitystreams#` (W3C Rec) | social activities; ForgeFed's base | Yes (JSON-LD) | Only relevant as ForgeFed's substrate (`as:Create`, `as:Follow`, actors, collections). | ❌ on its own. |
| **DCAT 3 / DCAT-AP** | `http://www.w3.org/ns/dcat#` | catalogs: `Dataset`, `Distribution`, `DataService`, `accessURL`, `downloadURL` | Yes | 🟡 `dcat:Distribution` is a plausible superclass for "a place you can get the bytes" — and it is what QUAY, `metalad_core`, and datalad-concepts all lean on. But a clone is not a distribution: it's a peer with its own identity, history, and outbound edges. | 🟡 map, don't model. |
| **DataLad Concepts** | https://concepts.datalad.org/ · **source: github.com/psychoinformatics-de/datalad-concepts** | see §B.2 | LinkML → JSON-LD context + OWL TTL + SHACL TTL | See §B.2 | ✅ **adopt the *method*, not (currently) the terms.** |
| **datalad-metalad `metalad_core`** | github.com/datalad/datalad-metalad `datalad_metalad/extractors/core.py` | see §B.3 | JSON-LD | See §B.3 | ✅ **adopt as the primary *collector* output format.** |
| **OSLC Configuration Management 1.0** | `docs.oasis-open-projects.org/oslc-op/config/v1.0/` — OASIS Standard, 2023-08-28; vocab `config-vocab.ttl`, shapes `config-shapes.ttl` | versioned resources & configurations across ALM/PLM tools | Yes (RDF vocab + resource shapes) | ❌ Domain is "concept resource / version resource / configuration / change set" in requirements-management tools (DOORS, Jazz). Not git, not clones. | ❌ irrelevant. |
| **Backstage software catalog** | backstage.io | `Component`, `API`, `Resource`, `System`, `Domain`, `Group`, `User` entities in YAML, `spec.dependsOn`/`ownerOf` relations | No (YAML + its own schema) | ❌ It has `metadata.annotations.'backstage.io/source-location'` — one URL. Service-ownership model, not clone topology. | ❌ irrelevant, but its **YAML entity + typed relations + "one file per entity in git"** shape is a decent ergonomic precedent. |
| **CycloneDX** | cyclonedx.org | SBOM with `dependencies`, `compositions`, `pedigree` (ancestors/descendants/variants/commits!), `externalReferences` type `vcs` | JSON/XML primary; an RDF/OWL rendering `[UNVERIFIED]` | 🟡 `pedigree.commits` and `pedigree.ancestors` are the closest thing in SBOM-land to "this artifact came from that clone at that commit". | ❌ for us — SBOM lifecycle, not clone federation. |
| **Dublin Core / DCMI Terms** | `http://purl.org/dc/terms/` | `title`, `description`, `identifier`, `created`, `modified`, `isVersionOf`, `hasPart`, `source` | Yes | ✅ boring and useful for labels/timestamps. | ✅ use for the obvious literals. |
| **DataCite / RDA** | datacite.org schema 4.x | DOI metadata, `relatedIdentifier` with `IsVersionOf`/`IsDerivedFrom`/`IsSupplementTo` | XML primary; RDF mappings exist | ❌ citation metadata; wrong granularity. | ❌ irrelevant. |
| **"git-rdf" / gitrdf-style projects** | — | converting git objects to RDF triples | — | Searched; nothing maintained and canonical surfaced beyond git2PROV. Marking `[UNVERIFIED]` that any actively-maintained git→RDF vocabulary exists. | ❌ do not cite as if it exists. |
| **git-annex `map`** | https://git-annex.branchable.com/git-annex-map/ | graphviz of annex remotes | No | Already the de-facto baseline — issue #1 pastes its output. Open todo: [`map: add --json`](https://git-annex.branchable.com/todo/map__58___add_--json/). | ✅ **the closest existing *implementation*.** Its node/edge vocabulary (uuid-keyed nodes, host clusters, remote-name-labelled edges) is a de-facto model worth formalizing — that is literally what our schema should be. |
| **QUAY** | `https://w3id.org/quay/` | protocol/auth/operation/delivery/coverage/SLA/encryption of a `dcat:Distribution` | Yes (OWL + SHACL) | 🟡 one attribute axis only (§A.1) | 🟡 optional `exact_mappings` target. |

## B.2 DataLad Concepts (https://concepts.datalad.org/) — evaluated in depth

`concepts.datalad.org` itself is blocked by this session's egress proxy, so I evaluated
**github.com/psychoinformatics-de/datalad-concepts** (the source; README: *"This toolkit provides generic
components for metadata-driven workflows … See https://concepts.datalad.org for more information."*).

- **Language: LinkML.** Every schema module is a LinkML YAML that generates, per module:
  `unreleased.context.jsonld`, `unreleased.yaml`, `unreleased.static.yaml`, `unreleased.owl.ttl`,
  `unreleased.shacl.ttl` (list quoted verbatim from `src/things-distributions/unreleased.yaml`).
  **This is the single most important finding of Part B**: the DataLad ecosystem's answer to
  "OWL or SHACL or JSON-LD?" is **"LinkML, and generate all three."**
- **License**: MIT (toolkit); schema modules carry `license: CC-BY-4.0`.
- **Activity**: last commit 2026-08-18 (three days before this report) — *actively maintained*, by Michael Hanke
  with contributions from Stephan Heunis. 32 open issues.
- **Funding**: DFG TRR 379 (Q02), DFG SFB 1451 (INF), MKW-NRW KP22-106A.
- **Module layout** (`src/`): `things`, `things-data`, `things-distributions`, `things-files`,
  `things-properties`, `things-prov`, `things-publications`, `things-resources`, `things-rules`,
  `things-social`, `things-study`; a parallel `flat*` family; `*-mixin` modules
  (`prov-mixin`, `versions-mixin`, `spatial-mixin`, `temporal-mixin`, `relations-mixin`, `files-mixin`,
  `quantities-mixin`, …); `identifiers`; `types`; plus `demo-*` instantiations.
- **Classes defined** (union across modules): `Thing`, `Entity`, `Agent`, `Activity`, `Person`, `Organization`,
  `Project`, `Grant`, `Study`, `Subject`, `Instrument`, `Dataset`, `Distribution`, `NamedDistributionPart`,
  `DataItem`, `File`, `NamedFilePart`, `Document`, `Publication`, `Convention`, `Rule`, `Statement`, `Property`,
  `AttributeSpecification`, `ValueSpecification`, `Annotation`, `AnnotationTag`, `Checksum`, `Identifier`,
  `IssuedIdentifier`, `ComputedIdentifier`, `DOI`, `ORCID`, `ISSN`, `EmailAddress`, and the full PROV set
  (`Association`, `Attribution`, `Delegation`, `Derivation`, `Generation`, `Invalidation`, `Usage`, `Quotation`,
  `Communication`, `Influence`, `Start`, `End`, `*Mixin`).
- **Prefixes it aligns to**: `dcat`, `dcterms`, `fabio`, `foaf`, `obo`, `skos`, `spdx`, `sio`, `prov`, `pav`,
  `linkml`, `eunal`, `isil`, `dash`.

**Does it cover clones / remotes / annex UUIDs? No.**
`grep -rin 'repository|remote|clone|branch|commit|git' src --include=*.yaml` returns **zero** hits outside the
word "digital"; there is no `uuid` type in `src/identifiers/` or `src/types/`. It is a domain-*neutral*
PROV/DCAT/Dublin-Core-aligned metadata skeleton. Issue #1's phrasing — *"would align with effort @mih has on
formalizing datalad datasets … but without all gory details"* — is exactly right: we would **align** to
`dlthings:Thing`/`Entity`/`Distribution`/`Checksum`/`Agent`/`Activity`, and define the git/annex layer ourselves.

**Verdict: adopt LinkML and the mixin/multi-target-generation methodology; align our classes to
DataLad Concepts via `is_a`/`mixins`/`exact_mappings`; expect to author 100% of the git-specific terms.**
There is also a natural collaboration hook here — a `dlthings`-aligned `git-topology` module is a plausible
upstream contribution rather than a fork.

Adjacent, worth knowing about: **`psychoinformatics-de/shacl-vue`** (Vue, auto-builds a metadata-entry UI from
SHACL + OWL — a live example of "SHACL as UI spec" in a browser), **`shacl-tulip`**, and
**`dump-things-service`**. If we do define SHACL shapes, a form UI comes nearly free from that stack.

## B.3 `metalad_core` (datalad-metalad `datalad_metalad/extractors/core.py`, 453 lines)

Read directly. It emits JSON-LD (`'@context': default_context`) with a `@graph`, and it **already collects
most of what issue #1's walker needs from a *local* clone**:

- dataset-level: `identifier` (datalad dataset UUID), `version` (`0-<count>-g<sha>`), `dateCreated`,
  `dateModified`, `contributors`, `hasPart` (files + subdatasets), `contentbytesize`, `@id` = refcommit sha.
- subdatasets: `{"@type": "Dataset", "@id": "datalad:<gitshasum>", "identifier": "datalad:<gitmodule datalad-id>"}`.
- **remotes** (config `datalad.metadata.datalad-core.report-remotes`), lines 151–200:

```python
for r in remote_names:
    info = {'name': r}
    url = ds.config.get('remote.{}.url'.format(r), None)
    if url is not None: url = ri2url(dsn.RI(url))
    if url: info['url'] = url
    annex_uuid = ds.config.get('remote.{}.annex-uuid'.format(r), None)
    if annex_uuid is not None:
        info['@id'] = 'datalad:{}'.format(annex_uuid)
        known_uuids[annex_uuid] = info
    ...
# then, from `git annex info`:
for cat in ('trusted repositories', 'semitrusted repositories', 'untrusted repositories'):
    for r in info[cat]:
        if r['uuid'] not in known_uuids:
            distributions.append({'@id': r['uuid']})
meta['distribution'] = sorted(distributions, key=lambda x: x.get('@id', x.get('url', None)))
```

**This is the worldmap's edge list, already implemented.** `remote.<name>.url` + `remote.<name>.annex-uuid`
is precisely the (per-clone remote *name*, target URL, target annex UUID) triple that issue #1's mermaid
diagram encodes by hand, and the trust categories give us the trusted/semitrusted/untrusted axis QUAY lacks.

**Gaps vs. issue #1**: it flattens remotes into a `distribution` *list* (loses the fact that a remote is a
*named edge*, keeping the name only as an opaque `name` field); it does not record `annex.uuid` of the
*local* clone as a first-class node id; it has no bare-vs-worktree flag; no special-remote type/config
(exporttree/importtree/chunk/encryption); no aheadness; no host modeling; and it cannot ssh anywhere
— exactly the abstraction gap issue #1 calls out.

**Verdict: use `metalad_core` (or a slimmed re-implementation of those ~50 lines) as the per-clone collector,
and define our own envelope for host/edge/observation/diagnostic on top.**

## B.4 LinkML as the schema language

- `https://linkml.io` — could not be fetched (egress); evaluated through its *use* in datalad-concepts, which
  is stronger evidence anyway.
- What it buys us, all from one YAML source: **JSON Schema** (validate the on-disk worldmap),
  **Pydantic dataclasses** (the Python walker), **TypeScript interfaces** (the browser renderer),
  **JSON-LD context** (free RDF interop), **OWL TTL** and **SHACL TTL** (for anyone who wants reasoning or
  shape validation), plus generated docs. `datalad-concepts`' Makefile targets prove this pipeline works.
- Ecosystem fit: **the user's own DANDI ecosystem is LinkML-native** (`dandi-schema`), and so is
  `concepts.datalad.org`. Choosing LinkML means the schema is legible to both neighbouring projects.
- Costs: LinkML's generators are uneven (datalad-concepts ships `patches/` and a `tools/patch_linkml` script
  because *"this work require a patched linkml installation"* — a real, documented friction). The YAML is
  verbose. `mixins` + `slot_usage` semantics take a day to learn.
- Alternative considered: hand-written JSON Schema + a hand-written JSON-LD context. Cheaper on day 1,
  but you then maintain the Python types, the TS types, the JSON Schema, and the context by hand, and they drift.

**Verdict: LinkML, with the caveat that we pin its version and expect one patch-shaped afternoon.**

---

# Part C — practical semantic-stack assessment

## C.1 If we went RDF: in-browser stores and query engines

Versions verified against `registry.npmjs.org` on 2026-08-21.

| Tool | Latest | License | Browser? | What it gives | Note for us |
|---|---|---|---|---|---|
| **N3.js** (`n3`) | 2.2.5 (2026-08-19) | MIT | yes | streaming Turtle/TriG/N-Triples/N-Quads parser+writer, in-memory `Store` with quad indexing | **The only RDF dependency we'd actually need.** ~100 KB. This is what Ontosphere uses as its source of truth. |
| **Oxigraph** (`oxigraph`) | 0.5.9 (2026-06-18) | MIT OR Apache-2.0 | yes (WASM) | full **SPARQL 1.1 Query + Update**; parses Turtle/TriG/N-Triples/N-Quads/RDF-XML/JSON-LD | README: *"a work in progress and currently offers a **simple in-memory store**"*, needs a WASM-aware bundler (Vite/webpack) and `WeakRef` + reference types. No browser persistence — the persistent store is the Rust/Node side only. Great as an optional "SPARQL console" tab. |
| **quadstore** | 15.4.1 (2025-10-20) | MIT | yes, over `level`/IndexedDB backends | persistent RDF store with SPARQL via Comunica | The one option that gives **durable** browser storage of quads. Real ongoing complexity (backend adapters, index tuning) for a graph of a few hundred nodes. |
| **Comunica** (`@comunica/query-sparql`) | 5.3.0 (2026-07-10) | MIT | yes | SPARQL over heterogeneous sources incl. **federated** endpoints and plain RDF files over HTTP | The genuinely interesting capability: federate over `worldmap.ttl` files published by *different* labs. Speculative for now; noted for later. |
| **rdf-ext / `@rdfjs/*`** | `@rdfjs/data-model` 2.1.2 | MIT | yes | RDF/JS interfaces & dataset utilities | Only if we're already RDF-native. |
| **shacl-engine** | 1.1.2 (2026-06-30) | MIT | yes | SHACL validation in-browser | Would let us ship "worldmap health check" as shapes. Attractive **if** we're RDF. |
| **rdf-canonize** | 5.0.0 (2025-11-20) | BSD-3 | yes | W3C RDFC-1.0 canonical N-Quads + content hash | Deterministic graph identity/diffing. Nice, but only meaningful in RDF. |
| **HDT** | — | — | — | compressed immutable triple archives | ❌ Built for billion-triple read-only archives. Our worldmap is *mutable and tiny*. Actively harmful fit. |
| **kuzu-wasm** | 0.11.3 (2025-10-10) | MIT | yes (WASM) | embedded **property-graph** DB with Cypher | Honestly a *better conceptual match* than RDF: our data is a labelled property graph (edges with names, counts, timestamps). But it's a WASM DB for ≤10³ nodes — overkill. |
| **DuckDB-wasm** (`@duckdb/duckdb-wasm`) | 1.33.1-dev57.0 (2026-06-22) | MIT | yes (WASM) | SQL/OLAP over Parquet/Arrow in-browser | Overkill; latest published tag is a `-dev` prerelease. |

## C.2 Provenance of the knowledge itself

This is the *sharpest* modelling requirement in issue #1 and it deserves a decision, not a technology.
The worldmap is **incrementally discovered, partial, and stale**: "I learned that clone `b14a3911…` has a remote
named `rolando-exchange` by reading `~/datasets/1076_spacetop/.git/config` on lena at 14:02"; a fact from a
GitHub API call last week may now be wrong; two hosts may report contradicting annex UUIDs (which issue #1
wants flagged as an **error**, not silently merged).

Three ways to carry that:

1. **RDF-star / quoted triples.** *Status*: RDF 1.2 Concepts + Semantics reached **Candidate Recommendation**
   with implementation comments due 5 May 2026; SPARQL 1.2 documents are still Working Drafts (W3C RDF & SPARQL
   WG). So: standardising *now*, but the JS tooling is uneven and the syntax is unfamiliar.
   **Verdict: too early, and it buys elegance, not capability.**
2. **Named graph per observation** (`urn:worldmap:obs:<ulid>` with a PROV-O `prov:Activity` describing it).
   Standard, works in every quad store, and is the classic answer. But note Ontosphere's fixed partitions —
   if we ever want to *view* in Ontosphere, per-observation graphs get flattened anyway.
3. **A first-class `Observation` record.** Explicit objects: `{subject, predicate, value, source, method,
   observed_at, agent, confidence}`. Ugly to a semanticist. But it is **identical in JSON and in RDF**,
   it is diff-friendly, it needs no RDF-star, it survives round-tripping through any format, and — decisively —
   it lets the *renderer* trivially answer "why do you think this?" and "these two observations disagree →
   render an error badge", which is precisely issue #1's requirement.

**Recommendation: option 3.** Model observations as data, not as syntax. If we later emit RDF, each
`Observation` becomes a named graph plus a `prov:Activity` for free — option 3 is a *superset* of option 2's
information, expressed portably.

## C.3 Serialization for git storage — which formats actually merge?

| Format | Diffable | Mergeable | Human-readable | Verdict |
|---|---|---|---|---|
| **Turtle** | poor | **bad** | best | Nesting, blank nodes, prefix reordering, and writer-dependent grouping mean one added fact can rewrite a whole block. Generated-artifact only, never hand-edited, never merged. |
| **N-Quads / N-Triples** | **excellent** | **good** | poor | One fact per line, no nesting. `sort`ed N-Quads gives clean line-wise diffs and git's default merge driver behaves well. Blank-node labels are the only hazard — use IRIs everywhere, or canonicalize with `rdf-canonize`. |
| **JSON-LD** | fair | fair | good | Merges as well as the JSON below it, i.e. depends entirely on key ordering and array stability. |
| **Canonical JSON** (sorted keys, 2-space indent, one entity per file) | **excellent** | **excellent** | **good** | Deterministic writer + one file per clone/host ⇒ two people discovering two different clones produce two new files and zero conflicts. |
| YAML | good | good | best | Same properties as JSON but with more ways to be non-deterministic. Fine for hand-authored seeds. |

**Recommendation: canonical JSON, sharded** — `worldmap/clones/<id>.json`, `worldmap/hosts/<fqdn>.json`,
`worldmap/observations/<date>-<ulid>.json`. Generate `worldmap.ttl` and `worldmap.nq` as **build artifacts**
for the Ontosphere/SPARQL path. Never merge Turtle.

## C.4 Honest cost/benefit: RDF vs. plain typed JSON

**The case FOR RDF (steelmanned):**

- **Global identifiers are already native to the domain.** Annex UUIDs, datalad dataset UUIDs, clone URLs,
  SWHIDs, and `rad` IDs are *all* globally unique identifiers. This is unusually good RDF material.
- **Third-party term reuse is free**: `forge:forkedFrom`, `doap:GitRepository`, `prov:wasDerivedFrom`,
  `spdx:Checksum` cost one prefix declaration each.
- **Merging partial knowledge from many sources is RDF's actual core competency**, and issue #6's "discover
  more clones from GitHub / registry.datalad.org and fold them in" is exactly that shape.
- **Free tooling today**: publish `worldmap.ttl` and Ontosphere renders it, SHACL validates it, SPARQL queries
  it, Comunica could federate across labs' worldmaps — with zero code written by us.
- **The schema is data**, so third parties can extend it without patching our code (issue #1 explicitly wants
  "plugins to extend it").

**The case AGAINST RDF (also steelmanned):**

- **Scale is trivial.** A big worldmap is maybe 500 clones, 2 000 edges. Every performance argument for a
  triple store evaporates. A `Map` is faster than any of these.
- **Our edges carry data.** `remote(name="rolando-exchange", url=…, annex_uuid=…, ahead=17 commits, ping=8ms,
  shared_bytes=4.2e11)` is a **property-graph edge**. In RDF every one of those becomes a reified node or an
  RDF-star annotation. That is the single biggest impedance mismatch, and it hits the *core* of issues #1 and #5.
- **Contradiction is a first-class requirement here, and RDF is monotonic.** RDF says "two clones with the
  same annex UUID ⇒ they are the same thing" — under OWL with an InverseFunctionalProperty it would literally
  `owl:sameAs`-merge them. Issue #1 wants that case rendered as a **loud error**. The formalism's default
  behaviour is the opposite of the product requirement.
- **Developer cost.** Anyone can contribute to `{"clones": [...]}`. Contributing to a Turtle file with a SHACL
  shape and an ODK-built OWL import requires a specialist. For an open-source tool aimed partly at *git newbies*,
  the semantic stack is a contributor filter.
- **Debuggability.** `jq` and `git diff` on canonical JSON versus SPARQL against a WASM store. No contest.
- **The whole RDF benefit is available *anyway*** via a JSON-LD context — which is ~80 lines of JSON.

### Recommendation

**Build on plain typed JSON. Buy the RDF option with a JSON-LD context. Do not buy the RDF runtime.**

Concretely:

1. **Model in LinkML** (one `git-worldmap.yaml`). Generate JSON Schema, Pydantic, TypeScript, JSON-LD context,
   and — for free, for the sceptics — OWL + SHACL.
2. **Give every slot a `slot_uri` / `exact_mappings`** pointing at ForgeFed, DOAP, PROV-O, schema.org,
   DataLad Concepts, and (for the special-remote flavour enum only) QUAY. This costs an afternoon and makes the
   worldmap RDF-interoperable *by construction*, with no RDF at runtime.
3. **Store as canonical sharded JSON in git.** Ship `worldmap.ttl` / `.nq` as generated artifacts.
4. **Runtime: plain objects + a tiny graph index.** No triple store. If a "SPARQL" power-user tab is ever
   wanted, add Oxigraph-WASM behind a lazy import — it parses our generated Turtle with no other changes.
5. **Provenance: explicit `Observation` records** (§C.2 option 3), not RDF-star, not per-observation graphs.
6. **Ontosphere: use it now, as a free dev-time inspector**, via `?rdfUrl=` against the generated `worldmap.ttl`.
   Revisit embedding only if the generic RDF canvas turns out to be enough — it almost certainly won't be.
7. **QUAY: cite, don't import.** Map our `special_remote_protocol` / `encryption` enums onto QUAY IRIs.
   Revisit in 12 months if QUAY gains users, a v1.0, and a second maintainer.

---

# Part D — draft node/edge type model for the git worldmap

Expressed neutrally (entity → properties; relations as typed edges) so it can be rendered as LinkML,
JSON Schema, or OWL. `→` = reference to another entity. Every entity carries `id` (a stable URI/CURIE),
`labels[]`, and `observations[] →Observation`.

## D.1 Identity — the one decision everything else depends on

Three different things get conflated by naive models. Keep them separate:

- **`Clone`** — a *location*. Identified by (host, path) or by URL. Two directories are two Clones.
- **`AnnexRepo`** — an *annex identity*, the `annex.uuid`. Normally 1:1 with a Clone.
  **When it is not, that is issue #1's headline error** ("multiple instances with the same annex uuid").
  Modelling it as a separate node makes the error a *graph pattern* (`AnnexRepo` with ≥2 inbound
  `hasAnnexIdentity`) instead of a special case in code.
- **`Dataset`** — the *logical* dataset, identified by the datalad dataset UUID (or `rad` ID, or fork-network
  root), shared across all its clones. This is what makes "the same dataset over there" renderable.

## D.2 Entity types

```
Host                      a machine or service endpoint
  fqdn, aliases[], kind ∈ {workstation, server, hpc, forge, cloud-storage, unknown}
  reachable_via[] ∈ {local, ssh, https, s3, ...}, ssh_user, os, git_version, git_annex_version
  is_forge → Forge?, geo?, notes

Forge                     a hosting portal (subtype/role of Host)
  kind ∈ {github, gitlab, gitea, forgejo, bitbucket, openneuro, radicle, ria-store, other}
  base_url, api_base_url, supports_fork_network: bool

Clone                     THE core node — one working tree or bare repo at one location
  → host, path, canonical_url, urls[] (all protocol variants; normalize per giturlparse)
  layout ∈ {worktree, bare, ria-store-entry, submodule-worktree}
  is_annex: bool, → annex_identity AnnexRepo?, → dataset Dataset?
  annex_description (git-annex's own free-text label), annex_version, annex_repo_version
  default_branch, → refs[] Ref, → worktrees[] Worktree
  rad_id?, rad_node_id?, swhid?           # radicle (issue #1), Software Heritage
  first_seen, last_seen, status ∈ {ok, unreachable, permission-denied, gone}

AnnexRepo                 an annex identity (a uuid), possibly realised by >1 Clone (= error)
  uuid, trust ∈ {trusted, semitrusted, untrusted, dead}   # as recorded by the observing clone
  is_special_remote: bool, → special_remote SpecialRemote?

Dataset                   the logical dataset shared across clones
  datalad_dataset_id (uuid), name, → subdataset_of Dataset?, external_ids[] (DOI, SWHID, rad)

SpecialRemote             a non-git annex remote
  name, type ∈ {S3, rsync, webdav, directory, rclone, bittorrent, ipfs, hook, web, borg,
                git-lfs, gcrypt, glacier, adb, ddar, tahoe, external, ...}
  encryption ∈ {none, shared, hybrid, pubkey, sharedpubkey}, chunk?, autoenable: bool
  exporttree: bool, importtree: bool, versioning: bool, config{} (raw remote.log fields)
  # ---- optional RDF alignment on this entity only ----
  quay_protocol → quay:{S3,Rsync,WebDav,LocalFilesystem,Rclone,BitTorrent,Ipfs,Http,Hook,Git}Protocol
  quay_auth     → quay:{AwsCredential,SshKey,GpgKey,Basic,ApiKey,OAuth2,No}Authentication
  quay_encryption → quay:{Gpg,Aes256,Aes128,No}Encryption

Ref                       a branch/tag observed in a clone
  → clone, name, kind ∈ {branch, tag, remote-tracking, annex-branch}, sha, is_head, updated_at

Worktree                  a linked worktree (issue #5)
  → clone (the parent), path, → checked_out_ref Ref, is_locked, is_prunable

Observation               HOW we know something (see §C.2 — first-class, not RDF-star)
  → about (any entity or edge id), method ∈ {local-fs, ssh, git-ls-remote, git-annex-info,
      github-api, gitlab-api, registry.datalad.org, manual, imported-worldmap}
  → agent Agent, → from_host Host?, observed_at, tool_versions{}, raw_ref? (path to raw JSON blob)
  confidence ∈ {asserted, inferred, stale}

Diagnostic                errors & warnings — a first-class node so the renderer can badge them
  severity ∈ {error, warning, info}
  code ∈ {duplicate-annex-uuid, dead-remote, unreachable-host, url-mismatch,
          annex-uuid-mismatch, orphan-remote, no-annex-here, subdataset-not-installed,
          conflicting-observations}
  → affects[] (entity or edge ids), message, → raised_by Observation

Agent                     person or automation that made an observation
  kind ∈ {person, bot}, name, email?, orcid?, forge_handle?

Measurement               sensed link properties (issue #1's "additional properties")
  → edge, kind ∈ {ping-rtt-ms, bandwidth-bps, shared-content-bytes, unique-content-bytes}
  value, unit, measured_at, → measured_by Observation
```

## D.3 Relation (edge) types

Edges carry data, so each is a first-class object with `id`, `→ observations[]`.

```
hostedOn         Clone → Host                       (containment; renders as the graphviz cluster)
hasAnnexIdentity Clone → AnnexRepo                  ≥2 inbound on one AnnexRepo ⇒ Diagnostic(duplicate-annex-uuid)
instanceOf       Clone → Dataset                    all clones of the same datalad dataset UUID
hasRemote        Clone → Clone | AnnexRepo | SpecialRemote     ★ THE central edge
    name                     per-clone remote name — the thing issue #1 exists to visualise
    url_as_configured, fetch_url, push_url, url_normalized
    recorded_annex_uuid      remote.<name>.annex-uuid, may disagree with the target's actual uuid
    annex_ignore, is_dead, is_export_remote, tracking_branch
    resolution ∈ {resolved-to-clone, resolved-to-uuid-only, unresolved, dangling}
    ahead{ commits: int, branches: [str], behind_commits: int, measured_at }   # issue #5
hasSpecialRemote Clone → SpecialRemote              from remote.log / `git annex info --json`
subdatasetOf     Clone → Clone                      path, gitmodule_datalad_id, pinned_sha, installed: bool   # issue #4
forkedFrom       Clone|Dataset → Clone|Dataset      from forge API (GitHub Insights→Network)                  # issue #6
upstreamOf       inverse of forkedFrom
mirrorOf         Clone → Clone                      declared mirror/pull-mirror
derivedFrom      Clone → Clone                      generic "was cloned from" when no remote survives
hasWorktree      Clone → Worktree
sameAs           Clone → Clone                      operator-asserted identity (two URLs, one repo)
observedBy       any → Observation
raises           any → Diagnostic
```

Rendering hints (kept in the model so renderers stay dumb): `layout` → node shape (bare = cylinder,
worktree = box, special remote = folder); `is_annex` → badge; `encryption`/`exporttree`/`importtree` → badges;
`Diagnostic.severity` → node/edge colour; `hasRemote.ahead.commits` → edge label + thickness;
`hostedOn` → subgraph cluster; clones with `ahead.commits == 0` → greyed out (issue #6, verbatim).

## D.4 Term alignment (what each of our slots maps to, for the generated JSON-LD context)

| Our term | `exact_mappings` |
|---|---|
| `Clone` | `forge:Repository`, `doap:GitRepository`, `dlthings:Distribution` (broad) |
| `Clone.canonical_url` | `forge:cloneUri`, `doap:location`, `schema:codeRepository` |
| `Dataset` | `dcat:Dataset`, `schema:Dataset`, `dlthings:Thing` |
| `Ref` | `forge:Branch` (kind=branch) |
| `Ref.sha` | `forge:hash`; `Ref.name` → `forge:ref` |
| `forkedFrom` | `forge:forkedFrom` (inverse `forge:forks`) |
| `mirrorOf` | `forge:mirroredFrom` / `forge:mirrors` |
| `derivedFrom` | `prov:wasDerivedFrom`, `spdx:descendantOf` |
| `subdatasetOf` | `dcterms:isPartOf`, `dlthings:is_part_of` (inverse `dcterms:hasPart`) |
| `Observation` | `prov:Activity` (+ `prov:wasAttributedTo` → `Agent` = `prov:Agent`) |
| `Observation.observed_at` | `prov:endedAtTime` |
| `Host` | `schema:ComputerLanguage`✗ — no good match; define ours, `broad_mappings: prov:Location` |
| `SpecialRemote.quay_*` | `quay:Protocol` / `quay:AuthenticationScheme` / `quay:EncryptionAlgorithm` subclasses |
| checksums (annex keys) | `spdx:Checksum`, `spdx:algorithm` |

Everything without a mapping is ours to define — which is, correctly, most of the git-annex-specific surface.

## D.5 Smallest useful next step

`git annex map` already emits the graph in graphviz form and has an open todo for
[`--json`](https://git-annex.branchable.com/todo/map__58___add_--json/). The single highest-leverage move for
this project is to define `Clone` / `AnnexRepo` / `hasRemote` / `Observation` in LinkML, write the walker to
emit that JSON from `git config` + `git annex info --json` + `metalad_core`, and only *then* argue about RDF.
The vocabulary alignment above ensures that argument stays cheap whenever it happens.
