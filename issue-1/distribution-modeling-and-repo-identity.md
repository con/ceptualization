# Distribution as the class, and the identity problem for pure git

Sixth follow-up, on two design decisions:

1. `Distribution` is the right superclass, with "is it git?" as a **feature**
   rather than a subclass -- since a distribution could equally be a RIA
   archive with git bundled inside. LinkML lacks multiple inheritance, so the
   forms need expressing through a multivalued slot.
2. **Pure git has no repository identity.** DataLad stores a UUID in
   `.datalad/config`, so DataLad datasets are tractable; plain git needs a
   heuristic over shared history, and no content-based immutable id seems
   possible because several repos can descend from the same template commit.

This resolves open question 4 of
[vocabulary-for-clones-and-remotes.md](./vocabulary-for-clones-and-remotes.md).

## 1. One correction: LinkML does have mixins

Single inheritance via `is_a`, yes -- but LinkML also supports **`mixins:`**,
and datalad-concepts uses them heavily: **50 `mixins:` usages** across the
modules, with `mixin: true` classes declared in `prov-mixin` and `things-prov`.
`Thing` itself is composed this way (`mixins: [ThingMixin]`).

So multiple inheritance-ish composition *is* available. **The conclusion is
still right, for a different reason.** Mixins compose at the *schema* level:
using them here would mean minting a class per combination --
`BareGitDistribution`, `BareGitAnnexDistribution`,
`RiaStoreDistribution`, `AnnexedWorktreeDistribution`, and so on. The
variability is at the *instance* level: what any particular copy on disk
happens to be. That is data, not schema, and it belongs in slots.

Rule of thumb worth writing down: **use a mixin when the variation changes
which slots exist; use a slot when it changes the value of a slot that always
exists.** Everything on this axis is the latter.

## 2. Don't use one feature bag -- use a few orthogonal axes

The tempting move is a single multivalued `features` slot holding
`[git, annex, bare]`. I would push back on that: a flat bag loses which
*axis* each value belongs to, so nothing can validate that a distribution has
exactly one layout, and the UI cannot ask "group these nodes by layout"
without a hardcoded list of which tokens are layouts.

Better: a small set of slots, one per orthogonal question, most of them
single-valued enums:

```yaml
classes:
  Distribution:                       # unchanged, is_a Thing, dcat:Distribution
    slots: [vcs, layout, annex_mode, packaging, parts, distribution_of]

slots:
  vcs:                                # single-valued
    range: VersionControlSystem       # git | hg | svn | none
  layout:                             # single-valued -- how the bytes are arranged
    range: DistributionLayout         # worktree | bare | ria-store | bundle |
                                      # archive | export-tree | working-copy
  annex_mode:                         # single-valued
    range: AnnexMode                  # none | keystore | exporttree | importtree
  packaging:                          # MULTIvalued -- genuinely a set
    range: PackagingFeature           # compressed | encrypted | chunked | 7z-ria | ...
  parts:                              # already in relations-mixin
    multivalued: true                 # a RIA store CONTAINS git repos
```

Two things fall out of this that a feature bag would have obscured.

**A RIA archive is not a git distribution with a flag -- it is a distribution
that *contains* distributions.** `layout: ria-store` plus `parts` pointing at
the git repositories inside it. That reuses `parts`/`part_of` from
`relations-mixin`, gives the nesting for free, and means the explorer can
expand *into* a RIA store the same way it expands into a submodule. A
`git-bundle` file is the same shape with `layout: bundle`.

**`vcs: none` is a legitimate value**, and it is what makes the model cover
git-annex special remotes that hold content with no git at all (an S3 bucket in
exporttree mode, a directory remote). Those are Distributions too, and they
belong in the graph -- issue #1 explicitly wants special remotes drawn.

So: `Distribution` stays the class; `Clone` becomes a *role* a Distribution
plays rather than a subclass. Concretely I would not mint `Clone` at all --
a clone is `Distribution` with `vcs: git` and a `distribution_of` pointing at
the `Repository`/`Dataset`. That is simpler than the sketch in the previous
document and I think it is the better answer to open question 4.

## 3. Repository identity: verified, and worse than it looks

You are right, and it is worth being precise about *why*, because it
determines what the model must store.

### The template problem, measured

I built the exact case: template `T` with 3 commits; `A` and `B` both cloned
from `T` and then developed independently (siblings, never clones of each
other); `C` a true clone of `A`, one commit behind.

```
root commits:
  T: 391aa54…    A: 391aa54…    B: 391aa54…    C: 391aa54…
```

**All four share one root commit.** So the root commit -- the most obvious
candidate for an intrinsic repository id -- cannot tell a genuine clone from
two unrelated projects that started from the same template. Confirmed, not
assumed.

What *does* discriminate is where the merge-base sits and how much each side
has diverged from it:

| Pair | merge-base | A-only | B/C-only | Jaccard | Containment |
| --- | --- | --- | --- | --- | --- |
| A vs B (template siblings) | `77ecb3d` = template tip | 8 | 5 | **0.19** | 0.19 |
| A vs C (true clone) | `1448fe3` = a commit of A's own | 1 | 0 | **0.91** | **1.00** |

Clean separation. Two refinements on the "80% of commits the same" intuition:

* **Use containment, not Jaccard.** `shared / min(|A|,|B|)` rather than
  `shared / |A ∪ B|`. Jaccard punishes a small young clone of a large old repo;
  containment correctly reports 1.00 for "C is entirely inside A", which is the
  common real case (a clone that is simply behind).
* **Where the merge-base sits matters more than the ratio.** If the merge-base
  *equals* one side's tip, that side is a strict ancestor -- same repo, one
  behind, no heuristic needed. Only when both sides have unique commits does a
  threshold enter at all.

### Why no content-based immutable id can exist

The failure is symmetric, and that symmetry is the actual proof:

* **False merge.** Template siblings share an identical history prefix. Any id
  derived from early content merges them. Demonstrated above.
* **False split.** `git filter-repo`, a rebase, or a `commit --amend` rewrites
  every SHA downstream. The repository is unambiguously "the same" to its
  users, and every content-derived id changes. Squashed imports and
  `git-annex`'s own history rewriting do this routinely.

No function of the content can be stable under (2) while discriminating under
(1), because the two demands are contradictory: (1) needs the id to depend on
*late, divergent* content, (2) needs it not to depend on content at all.

**Therefore identity must be extrinsic -- assigned, not computed.** Which is
precisely what git-annex and DataLad do, and it retroactively justifies their
design. SWHID does not contradict this: it is intrinsic *by intent*, and it
identifies **state**, never a repository. `swh:1:snp:` answers "are these two
copies currently identical?", which is a different and easier question.

### The evidence ladder

Verified from `dandi/dandi-bib`, which is a real DataLad dataset:

```
$ git cat-file -p HEAD:.datalad/config
[datalad "dataset"]
	id = 5771a77d-4995-4700-9e12-43b08fc4f143
```

`.datalad/config` is tracked in the default branch, so the id travels with
every clone and is readable **without cloning** (`git cat-file` after a blobless
fetch, or the forge's raw file API). That makes it the strongest and cheapest
signal available.

One caveat worth recording, because it is the same trap as the template
problem: the dataset id lives *in the tree*. `datalad create` mints a fresh one,
but a repository created by copying a template that already contained
`.datalad/config` will carry the template's id. So even the UUID is evidence,
not proof -- and a duplicate dataset id across genuinely different datasets is
another **error to render loudly**, exactly like duplicate annex UUIDs.

Ranked, with cost:

| Signal | What it identifies | Cost | Strength |
| --- | --- | --- | --- |
| DataLad dataset id (`.datalad/config`) | the dataset across all clones | ~1 blobless fetch, or raw-file API | strongest; watch for template copies |
| Forge numeric repo id (GitHub/Gitea) + `parent`/`source` | a forge-hosted repo, stable across renames | 1 API call | strong for hosted repos only |
| annex UUID | **this clone**, not the repository | free from the annex branch | identifies the *copy*; duplicates = error |
| Shared ref SHAs from `ls-remote` | shared history exists | **0.44 s**, no fetch | cheap positive evidence; no discrimination |
| merge-base + containment | degree of relatedness | commit graph both sides (~1.08 s / 6.8 MB, measured earlier) | the real discriminator |
| `git patch-id` overlap | same *work* after history rewriting | expensive | the antidote to false splits |
| root commit set | shared ancestry | cheap once graphs are local | **not sufficient alone** -- demonstrated |

### Model it as claims over objective relations

The reframing that makes this tractable: **"are these the same repository?" is
not a question the crawler should answer.** It should record what is objectively
true and let identity be an assertion:

*Objective, computed, stored as observations:*
`shares_root_commits`, `merge_base` (the SHA itself), `ahead`/`behind`,
`containment`, `shared_ref_shas`, `declared_dataset_id`, `declared_annex_uuid`.

*Asserted, with provenance and confidence:*
`same_repository_as` / `same_dataset_as`, carrying who or what asserted it,
on what evidence, and when.

This is the same rule already established for co-reference across collections:
**never merge silently.** The UI surfaces "these two look like the same
repository (containment 0.97, shared dataset id)" as a suggestion; confirming it
writes a record. A heuristic that silently merges two nodes destroys
information the user cannot recover; one that suggests costs a click.

It also makes the template case *representable* rather than merely survivable.
`A` and `B` genuinely do share ancestry -- that is a true and interesting fact
about the world, and the right rendering is a thin "shares history" edge back to
the template, not a merged node and not nothing.

### Suggested defaults

Deliberately conservative, and all overridable:

* merge-base == one side's tip → **strict ancestor**, no suggestion needed,
  draw as ahead/behind.
* matching dataset id or forge parent → **suggest same**, high confidence.
* containment ≥ 0.9 **and** no conflicting declared ids → suggest same.
* 0.1 < containment < 0.9 → draw `shares_history_with`, suggest nothing.
* containment ≤ 0.1 but shared root → draw `shares_history_with`, tag
  *template-derived*.
* two clones declaring the same annex UUID but differing content → **error**,
  as issue #1 requires.

## 4. What changes in the model

```yaml
# Distribution absorbs what the previous document called Clone
Distribution:
  is_a: Thing
  exact_mappings: [dcat:Distribution]
  slots:
    - distribution_of     # -> Repository / Dataset (the abstract thing)
    - vcs                 # git | hg | svn | none
    - layout              # worktree | bare | ria-store | bundle | archive | ...
    - annex_mode          # none | keystore | exporttree | importtree
    - packaging           # multivalued
    - on_host
    - parts               # nesting: RIA -> git repos, superdataset -> subdatasets
    - has_remote          # -> RemoteLink (the reified, data-carrying edge)
    - vcs_state           # swhid:snp -- "are these currently identical?"
    - declared_ids        # dataset id, annex uuid, forge id -- as observations
```

`Clone` disappears as a class and survives as a *perspective*: the "remotes"
view shows Distributions with `vcs: git`; a "storage" view could show all
Distributions including S3 special remotes and RIA stores. Which is the
per-model view idea doing real work rather than being decorative.

## 5. Open questions

1. Is `layout` genuinely single-valued? A RIA store contains bare repos --
   modelled as `parts`, so yes -- but a `git bundle` inside a RIA store inside
   a tarball is three levels of nesting and I have not checked that any of the
   tooling produces that.
2. Should `vcs_state` (the snapshot SWHID) be stored per observation rather
   than on the Distribution? It is time-varying, so probably per observation --
   which makes it an aheadness primitive rather than an attribute.
3. Does anything in the DataLad ecosystem already detect duplicate dataset ids
   (the template-copy trap)? If `datalad` warns about this, its rule is the one
   to adopt.
4. `git patch-id` for the false-split case: worth implementing at all, or is
   rewritten history rare enough to leave as a manual `same_repository_as`
   assertion?
