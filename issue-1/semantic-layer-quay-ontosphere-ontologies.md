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
