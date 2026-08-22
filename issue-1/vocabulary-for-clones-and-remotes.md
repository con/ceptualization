# What vocabulary exists for clones, remotes and submodules -- and what we must author

Fifth follow-up, answering three questions directly:

1. What ontology or controlled vocabulary already represents clones, submodules
   and remotes for a git graph?
2. Should we extend `concepts.datalad.org` and link out to the few existing
   vocabularies that have minimal coverage?
3. Is a W3C working group producing a schema.org extension for this?

(Reading "rehires" as **remotes**; if a different concept was meant, say so and
I will fold it in.)

## Short answers

1. **Nothing covers it.** Every candidate models one of three other things: the
   *project* (DOAP, CodeMeta), the *content* (SWHID, SPDX, schema.org), or the
   *forge social layer* (ForgeFed). The **deployment topology** -- which copies
   exist, where, under what locally-chosen name they know each other -- is
   modelled by none of them. The closest terms in any standard vocabulary are
   ForgeFed's `mirroredFrom` / `forkedFrom` and its `cloneUri` property.
2. **Yes -- extend datalad-concepts, and link out via mappings rather than
   imports.** The machinery is already in use there. Details in section 4.
3. **No.** Verified below.

## 1. Verification

Read from source, not from search summaries:

| Source | What I checked | Result |
| --- | --- | --- |
| `schemaorg/schemaorg`, release **18.0** | every `rdfs:Class` matching repositor/clone/remote/branch/fork/commit | **zero matches**; `schema:codeRepository` has `rangeIncludes: schema:URL` |
| `forgefed/forgefed` `1d78dce` (2026-05-03) | `context.jsonld`, all 41 terms | active; classes and properties listed below |
| `sealuzh/onts-seon` `195a20b` (**2013-01-23**) | Clone/Branch/Commit term semantics | abandoned; **"Clone" means *code clone*** |
| `psychoinformatics-de/datalad-concepts` `cb6c791` | git/annex/VCS terms | zero classes (established in an earlier document) |

The schema.org result is the sharpest: **`codeRepository` is a bare URL, not an
entity.** schema.org models a repository as a *link on a thing*, never as a
thing with its own identity, let alone one that can have remotes. Anything
built on schema.org alone cannot express "these two URLs are the same
repository", which is the first question our graph must answer.

The SEON result is a trap worth naming: it looks like a version-control
ontology and is cited as one, but `clones.owl` defines *"A class of artifacts
that are duplicates of each other"* -- duplicated **code fragments**. Its
`history.owl` does have `Version` and `Branch` (*"a separate development
stream"*), but they are file-version-centric in the CVS/SVN sense, and the
project has been untouched for 13 years. Do not build on it.

## 2. The layered landscape

The useful split is **identifier schemes** (settled, adopt as-is) versus
**vocabularies** (fragmentary, map to).

### Identifier schemes -- adopt, do not reinvent

| Scheme | Status | Identifies | Use for |
| --- | --- | --- | --- |
| **SWHID** | **ISO/IEC 18670:2025**, published 2025-04-23 `[web]` | content, directory, revision, release, **snapshot** | commits and, via `snp`, *the full set of branches of a repo at a moment* |
| **purl** (Package URL) | top-level property in **SPDX 3.0.1** `[web]` | packages, with `vcs_url` and `repository_url` qualifiers | canonical cross-ecosystem naming of a hosted repo |
| **git-annex UUID** | git-annex's own | an annex repository *instance* | the identity of a clone that has an annex |
| **DataLad dataset UUID** | DataLad's own | a dataset across all its clones | the abstract dataset |
| ORCID / DOI / ROR | established | people / papers / organisations | the common nodes shared with other collections |

SWHID matters more than I expected. It is now an international standard, it is
intrinsic (computable from the objects, verifiable without a registry), and its
`snp` (snapshot) object is explicitly *"the full status of a version control
system, with all its development branches"* `[web]`. That is very nearly the
"state of this clone right now" primitive that issue #5's ahead/behind
reasoning needs -- two clones are in the same state iff their snapshot SWHIDs
match, computable locally on both sides with no network. **Recommend adopting
SWHID for commit and clone-state identity.**

Note the boundary though: SWHID identifies *content and state*, never
*location*. `swh:1:snp:...` says nothing about which host holds it or what it
calls its peers. Software Heritage's separate notion of an "origin" (a URL
where content was found) is the location half, and it is not part of the
identifier standard.

### Vocabularies -- coverage against what we need

Rows are the entities and relations this project needs; columns are whether any
existing vocabulary supplies a term.

| We need | Best existing term | Where | Adequate? |
| --- | --- | --- | --- |
| Repository as an entity | `forgefed:Repository` | ForgeFed | yes |
| Clone URL | `forgefed:cloneUri` | ForgeFed | yes |
| Fork-of | `forgefed:forkedFrom`, `forks` | ForgeFed | yes |
| Mirror-of | `forgefed:mirroredFrom`, `mirrors`, `mirroredBy`, `mirrorsTo` | ForgeFed | **closest thing to clone-of that exists** |
| Branch | `forgefed:Branch`, `ref` | ForgeFed | partial (no per-clone state) |
| Commit | `forgefed:Commit` + `hash`; SWHID `rev` | ForgeFed / SWH | yes |
| Project | `doap:Project`, CodeMeta | DOAP | yes, but assumes one repo per project |
| Package identity | `purl`, SPDX `packageUrl` | SPDX 3.0 | yes for published packages |
| Provenance of a fact | PROV-O (`prov-mixin`) | already in datalad-concepts | yes |
| Access/transport/auth of a distribution | QUAY | quay | partially (assessed earlier: types not instances) |
| **Named remote** (`origin`, `rolando-exchange`) | — | — | **nothing** |
| **Host / machine a clone sits on** | — | — | **nothing** |
| **Bare vs. worktree** | — | — | **nothing** |
| **Submodule containment** | — | — | **nothing** (`part_of` in datalad-concepts is generic) |
| **Worktree** (linked, `git worktree`) | — | — | **nothing** |
| **git-annex special remote** and its flavours | — | — | **nothing** |
| **Trust level** (trusted/semitrusted/untrusted/dead) | — | — | **nothing** |
| **Ahead/behind between two clones** | — | — | **nothing** |
| **Content availability** (which clone has which key) | — | — | **nothing** |

## 3. Why the gap exists (and why it will not close on its own)

This is not an oversight anyone is about to fix. Existing vocabularies target
knowledge that is **global, stable and publishable**: a project, a release, a
commit hash, a fork relationship a forge can assert. Our graph is the opposite
on all three axes -- **local, mutable, and vantage-point-relative**.

The named remote makes it concrete. `remote.rolando-exchange.url` is:

* **asymmetric** -- the other side may not know this repo at all;
* **locally chosen** -- the same peer is `origin` here and `typhon` there,
  which is the exact confusion issue #1 was written to visualise;
* **a property of neither endpoint alone** -- it is an edge with its own data;
* **private** -- it lives in one clone's config and is not published anywhere.

No standards body will mint a term for a name that only one machine uses. That
is *our* domain, and authoring it is correct rather than a failure to search
hard enough.

The same argument covers host, bare-vs-worktree, trust level and ahead/behind:
each is a statement about a *particular copy as seen from somewhere*, which is
why the observation/vantage layer and the vocabulary have to be designed
together.

## 4. Recommendation: extend datalad-concepts, map outward, import nothing

**Yes to your instinct, with one refinement: link by *mapping*, not by
`owl:imports`.**

LinkML already supports `exact_mappings`, `close_mappings`, `narrow_mappings`,
`broad_mappings` and `related_mappings`, and datalad-concepts already uses
`exact_mappings` (e.g. `Thing` → `schema:Thing`, `Statement` → `rdf:Statement`,
`Distribution` → `dcat:Distribution`). So the pattern is established in the
codebase; a `things-vcs` module just follows it.

Why mappings rather than imports:

* **Imports drag in axioms you did not vet.** The earlier documents already hit
  this: an OWL reasoner over imported axioms would happily `sameAs`-merge two
  clones sharing an annex UUID, which issue #1 wants rendered as a **loud
  error**. Mappings assert correspondence without importing entailments.
* **Coverage is fragmentary anyway.** You would be importing ForgeFed for four
  terms, DOAP for one, SPDX for an identifier property. The cost of five
  imports exceeds the benefit of five annotations.
* **Mappings survive the vocabularies dying.** SEON and git2PROV both died. A
  mapping to a dead vocabulary is a harmless annotation; an import is a broken
  build.
* **You keep the ability to be stricter than the mapped term.** `mirroredFrom`
  is close to clone-of but not identical (a mirror is maintained; a clone may
  be abandoned), so it belongs as `close_mappings`, not `exact_mappings` -- a
  distinction imports cannot express.

### Sketch of `things-vcs`

Neutral form; renders to LinkML, JSON Schema and OWL/SHACL through the existing
toolchain.

```yaml
classes:
  Repository:            # the abstract thing many clones are copies of
    is_a: Thing
    exact_mappings: [forgefed:Repository]
    close_mappings:  [doap:GitRepository, schema:SoftwareSourceCode]

  Clone:                 # ONE copy, at ONE location -- the node in the worldmap
    is_a: Distribution   # a Clone is a manifestation of a Repository
    slots: [clone_of, on_host, layout, vcs_state, has_annex]
    close_mappings: [forgefed:Repository]   # ForgeFed conflates the two

  AnnexRepo:             # identity carried by annex.uuid, distinct from Clone
    is_a: Thing
  Host:
    is_a: Thing
  Worktree:
    is_a: Thing
  SpecialRemote:
    is_a: Thing
    related_mappings: [quay:...]            # transport/auth axis only

slots:
  has_remote:            # THE core edge -- a Statement subtype, data-carrying
    range: RemoteLink
    close_mappings: [forgefed:mirroredFrom]
  clone_of:
    range: Repository
    close_mappings: [forgefed:forkedFrom, forgefed:mirroredFrom]
  vcs_state:
    description: snapshot identity of all refs
    exact_mappings: [swhid:snp]

classes:
  RemoteLink:            # qualified edge: dlthings:Statement + characterized_by
    is_a: Statement
    slots: [remote_name, target, recorded_uuid, resolution_status,
            ahead_commits, behind_commits, observed_at, via]
```

The two modelling decisions that matter, both established earlier in this
directory: **`Clone` (a location) is separate from `AnnexRepo` (a UUID identity)
is separate from `Repository`/`Dataset` (the abstract thing)** -- which turns
duplicate-annex-UUID from special-case code into a graph pattern; and
**`RemoteLink` is a first-class reified statement**, because `dlthings:Statement`
plus `characterized_by` gives data-carrying edges without leaving the model.

### Controlled vocabularies (the "controlled dictionary" half)

These should be **LinkML enums whose permissible values are taken verbatim from
git-annex and git**, because those tools *are* the authority here. Do not invent
synonyms:

| Enum | Values | Source of truth |
| --- | --- | --- |
| `TrustLevel` | trusted, semitrusted, untrusted, dead | git-annex `trust.log` |
| `CloneLayout` | worktree, bare, submodule, linked-worktree | git |
| `SpecialRemoteKind` | directory, rsync, S3, webdav, adb, gcrypt, git-lfs, hook, external, … | git-annex special-remote docs |
| `ExportMode` | keystore, exporttree, importtree | git-annex |
| `EncryptionMode` | none, shared, hybrid, pubkey, sharedpubkey | git-annex `encryption=` |
| `ResolutionStatus` | resolved, unreachable, auth-required, url-only, dead | ours |
| `Transport` | file, ssh, https, git, rsync, s3, … | ours; map to QUAY protocol terms |

Only the last two are genuinely ours. Everything else should carry
`exact_mappings` to the git-annex documentation URL for the term, so the
provenance of the vocabulary is explicit and a reader can check it.

## 5. On the W3C / schema.org question

**There is no W3C working group or community group producing a repository
vocabulary, and no schema.org extension for it.** `[web]` for the negative;
what I could confirm:

* **ForgeFed** is an ActivityPub extension developed *outside* the W3C
  community-group structure, funded through NLnet's NGI Zero Entrust `[web]`.
  It builds on the W3C ActivityPub Recommendation but is not itself on a W3C
  track. Its repo is active (head commit 2026-05-03) and its vocabulary is the
  best available -- but it is a *federation protocol* vocabulary: it describes
  what forges say to each other about repositories, not how copies of a
  repository relate on disk.
* **schema.org** has an active Community Group and an extension mechanism, but
  release 18.0 contains no repository class, and `codeRepository` remains a URL
  property. Nothing suggests a proposal in flight.
* **SPDX 3.0** is the most active standards effort in the neighbourhood, but
  its centre of gravity is SBOM: packages, licences, relationships, builds. Its
  contribution to us is `packageUrl`/purl as an identifier, not a topology
  vocabulary.

If you wanted to push upstream, the realistic target is **ForgeFed**, whose
`mirrors`/`mirroredFrom` family is the only place a "this repo is a copy of
that repo" relation already lives. A proposal to add a *named, directional
remote* term there would be in scope for a federation protocol. That is worth
doing only after the model has been used in anger -- proposing vocabulary
before you have run it is how vocabularies acquire terms nobody uses.

## 6. Recommendation, in order

1. **Adopt identifiers, author relations.** SWHID (incl. `snp` for clone state),
   purl, annex UUID, dataset UUID, ORCID/DOI/ROR. Author `Clone`, `Host`,
   `RemoteLink`, `SpecialRemote`, `Worktree` yourselves.
2. **Propose `things-vcs` to datalad-concepts as an issue first**, citing the
   three identifier namespaces already minted there
   (`ns/gitsha/`, `ns/dataset-uuid/`, `ns/annex-key/`) and the `example.org`
   `git-commit` type as the unfinished edge. It is their model; the extension
   should be theirs or explicitly blessed by them.
3. **Map, never import.** `exact_mappings` where terms coincide,
   `close_mappings` for ForgeFed's mirror family, `related_mappings` for QUAY's
   transport axis.
4. **Take enum values verbatim from git-annex**, with mappings to its docs.
5. **Defer any standards engagement** until the model has run against the
   spacetop dataset from issue #1 and the CON research-group collection.

The honest summary: roughly **20% of what we need already exists** (identifiers,
project metadata, fork/mirror relations, provenance), and it is worth wiring up
carefully. The other 80% -- the topology of copies, their local names, their
hosts, their trust and their divergence -- has no prior art because it is
nobody else's problem yet. That is the contribution, and it should be authored
deliberately rather than bolted onto a vocabulary that was built to answer a
different question.

## 7. Open questions

1. Does Software Heritage publish an RDF/OWL rendering of its data model
   (origins, snapshots, visits), or only the SWHID syntax plus a REST API? If
   the former, `Origin` may cover part of our `Clone`. `[UNVERIFIED]`
2. Wikidata has repository-related properties (e.g. source-code-repository URL)
   that could serve as a mapping target for well-known projects.
   `[UNVERIFIED — not checked]`
3. Is there value in emitting SPDX 3.0 alongside our own model, so a worldmap
   can answer SBOM-shaped questions? Probably not for v1.
4. Should `Clone` be `is_a: Distribution` (reusing the dcat-aligned class, as
   the `XYZDistribution` git-commit example hints) or a sibling? This is the
   one structural choice I would want the datalad-concepts maintainers to make.
