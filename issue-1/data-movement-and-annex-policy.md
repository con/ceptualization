# Automated routes, annex policy, and the movement of data

Specification. **Nothing here is built.** Status of each part is marked below;
the parts have very different costs and very different truth values, which is
the main thing this document is trying to keep straight.

## The request

Three related asks, in the order they were made:

1. Annotate which remote connections are **automated** — driven by `git annex
   sync`, a cron job, a CI workflow — rather than by a person typing.
2. More generally: **deduce and visualise the movement of data**.
3. Fold in the standard **git-annex groups** (`backup`, `archive`, `client`,
   …) as extracted metadata, available later for visualisation.

## Why this matters: a map we are already drawing wrong

`dandi-bib` is the repository the crawler's annex path was first demonstrated
on — "1.27 s fetch → 23 clones on `dandi-bib`, no ssh, no credentials", which
is in the ledger as a ✅. Fetching its `git-annex` branch again and reading it
with plain git:

| | |
|---|---|
| UUIDs in `uuid.log` | **25** |
| described as `runner@runnervm…:~/work/dandi-bib/dandi-bib` | **24** |
| UUIDs actually holding ≥ 1 key | **1** |
| author of the last `git-annex` branch commit | `github-actions[bot]` |

So the map draws **25 clones where there is one repository and one automated
process**. Twenty-four are ephemeral GitHub Actions VMs that existed for a few
minutes each, and the map gives them the same weight, the same rectangle and
the same expandability as the repository on your laptop. Nobody looking at
that picture learns what is true, which is: *content lives in exactly one
place, and a bot puts it there.*

That is the case for this feature. It is not a new visualisation on top of a
correct map — the current map is **misleading on real data today**, and
automation is why.

## The three layers, which must not be conflated

The single most important design constraint: *policy*, *automation* and *flow*
are three different claims about the world, with three different confidences.
Drawing them as one arrow would be a lie.

| Layer | Question | Where it lives | Agreed by every clone? | Cost |
|---|---|---|---|---|
| **A. Policy** | Where *should* content be? | `git-annex` branch | **yes** — it is committed | free (plain git) |
| **B. Automation** | What moves it *without a person*? | local config, hooks, cron, CI | no — per machine | cheap but evidential |
| **C. Flow** | What *did* move, and when? | location logs in the `git-annex` branch | yes | expensive, O(keys) |

### A. Policy — declared, global, cheap

Everything here is committed to the `git-annex` branch, so **every clone
agrees**. That is a genuinely different property from `remote.<n>.annex-ignore`,
which §4a already notes clones disagree about: a policy badge needs no
"according to whom" qualifier, an `annex-ignore` badge does.

Read with `git cat-file -p git-annex:<file>` — the mechanism `annex_logs()`
already uses for `uuid.log`, `remote.log` and `trust.log`, so **git-annex need
not be installed**:

| File | Carries |
|---|---|
| `group.log` | uuid → the groups it is in |
| `preferred_content.log` | uuid → its `wanted` expression |
| `group_preferred_content.log` | group → its `groupwanted` expression |
| `required_content.log` | uuid → content it must not drop |
| `numcopies.log`, `mincopies.log` | repository-wide copy floor |
| `trust.log` | trusted / semitrusted / untrusted / **dead** (already read) |
| `remote.log` | special remote config, including `autoenable=true` |
| `export.log` | which tree is exported where |

Only `uuid.log` exists in `dandi-bib`, so **these filenames are expected, not
verified** — the parser must treat every one as optional and must not fail on
a branch that has none. Confirming them needs a repository that actually uses
groups.

The standard groups and what they mean for the picture:

| Group | Wants | Reads on the map as |
|---|---|---|
| `client` | everything except archived content | a working copy |
| `transfer` | content in transit; drops once it has landed | a relay, not a destination |
| `backup` | everything | a sink |
| `incrementalbackup` | everything not in another incremental backup | a sink, sharded |
| `archive` | one copy of content archived nowhere else | the end of the line |
| `smallarchive` | the same, but only under `archive/` | ditto, scoped |
| `source` | content originating here; drops once copied away | a **source** — where data enters |
| `manual` | only what it already has | inert |
| `public` | content marked public | a publication target |
| `unwanted` | nothing | draw this loudly |

`source` → `transfer` → `backup`/`archive` is a *shape*, and it is the shape
worth drawing: it says which way data is supposed to flow through this
network, from declared configuration alone, with no history replay and no
network access.

**Do not reimplement preferred-content expressions.** They are a real little
language (`standard`, `include=`, `exclude=`, `copies=`, `inallgroup=`,
`approxlackingcopies=`, `metadata=`, `and`/`or`/`not`) and a wrong evaluator is
worse than none. Record the expression verbatim as a string; when git-annex is
present and an answer is actually needed, ask it (`git annex find --want-get`,
`--want-drop`) rather than parsing. Unverified here — no git-annex in the
sandbox.

### B. Automation — inferred, per-clone, evidential

There is no field that says "this remote is automated". It has to be inferred,
and the inferences are of very unequal strength. So the record carries the
**evidence**, never a bare boolean — the same discipline already applied to
`annex_incapable_assumed`:

```json
"automation": [
  {"kind": "annex-sync",   "remote": "origin", "evidence": "config",
   "detail": "remote.origin.annex-sync unset (default: sync)", "strength": "weak"},
  {"kind": "export",       "remote": "public", "evidence": "config",
   "detail": "remote.public.annex-tracking-branch=master", "strength": "strong"},
  {"kind": "autoenable",   "remote": "s3",     "evidence": "remote.log",
   "detail": "autoenable=true", "strength": "strong"},
  {"kind": "ci",           "remote": null,     "evidence": ".github/workflows/update.yml",
   "detail": "runs `git annex copy --to origin`", "strength": "strong"},
  {"kind": "scheduled",    "remote": null,     "evidence": "crontab",
   "detail": "0 * * * * datalad update --merge", "strength": "strong"},
  {"kind": "bot-authored", "remote": null,     "evidence": "git log git-annex",
   "detail": "24/25 commits by github-actions[bot]", "strength": "strong"}
]
```

Sources, roughly by strength:

* **Strong, in-repo:** `remote.<n>.annex-tracking-branch` (a `sync` auto-exports
  here); `autoenable=true` in `remote.log` (a *fresh clone wires this route up
  by itself* — arguably the strongest automation signal there is, and it is
  global); `.git/hooks/post-receive|post-update` mentioning `annex sync|copy|
  push`; `.github/workflows/*` or `.gitlab-ci.yml` running annex/datalad
  commands.
* **Strong, out-of-repo:** a crontab, systemd timer or launchd job whose
  command line names this repository. Requires reading the host, so it is
  ssh-tier work and belongs behind the same lazy probe as the content diff.
* **Strong, historical:** the `git-annex` branch author. `github-actions[bot]`
  or `runner@runnervm…` in `uuid.log` is not a person. This one is **free and
  global** — it is already in the data the crawler fetches — and on `dandi-bib`
  it alone explains 24 of 25 nodes.
* **Weak:** `remote.<n>.annex-sync` unset. Sync is the default, so its absence
  says almost nothing; only an explicit `false` is informative, and that is
  evidence of *de-automation*.

The `bot-authored` signal is the cheapest thing in this entire document and
should be built first.

### C. Flow — observed, expensive, direction unrecorded

The location log is the record of what happened. Verified format, from a real
`git-annex` branch (`04b/22c/MD5E-s359--b7bf….json.log`):

```
1770062971s 1 60881e44-0a3b-4446-9c95-104683c0f52b
```

`<unixtime>s <1|0> <uuid>` — `1` present, `0` absent — appended over time, so
replaying every key's log yields, per UUID, a timestamped series of gains and
losses. Two further verified facts make this much cheaper than expected:

* **Size is in the key name.** `MD5E-s359--…` is 359 bytes. Summing the 84
  keys in `dandi-bib` gives 139,670,063 bytes with plain git and no `git annex
  info` — so flow can be **byte-weighted for free**. (Caveat: keys without a
  size, such as some `URL--` keys, must be counted separately as "unknown
  size", never as zero.)
* **Per-key metadata sits alongside** in `<key>.log.met`, as
  `<unixtime>s <field> +<value>`, which is where a `metadata=` preferred-content
  expression gets its answers and is the natural join point to the other
  collections (papers, people) in the dump-things design.

Four hard limits, each of which must be visible in the UI:

1. **Direction is never recorded.** The log says B has it now; it does not say
   it came from A. Direction is *inference*: if a key appeared at B at time T
   and was already at A, and A and B know each other as remotes, then A→B is
   plausible. With three candidates it is a guess. Aggregate honestly — a
   weighted edge labelled *"n keys appeared at B while present at A"*, never
   *"n keys transferred A→B"*.
2. **A location-log entry is a claim, not an observation.** It records what
   whoever ran the command believed. A repository that was reformatted still
   claims its content until someone runs `git annex fsck`. Dead repositories
   keep their entries.
3. **Timestamps come from the committing machine's clock.** Ordering across
   repositories is approximate; do not build anything that needs a total order.
4. **Replay is O(keys), not O(repositories).** Every key is a file in the
   branch. 85 keys in `dandi-bib` is nothing; a DANDI dandiset is millions.
   This must be opt-in and incremental — a "flow" perspective one asks for,
   like the relation panel's content diff, never part of the default crawl.

## Extraction: what lands in `worldmap.json`

Per node, all from the `git-annex` branch, all plain git:

```json
"annex_policy": {
  "groups": ["backup"],
  "wanted": "standard",
  "groupwanted": "include=*",
  "required": null,
  "numcopies": 2,
  "trust": "semitrusted"
},
"automation": [ … as above … ],
"actor": {"kind": "bot", "why": "uuid.log description matches runner@runnervm…"}
```

Per edge, the automation annotation and — only when a flow replay has been
run — the weight:

```json
"automated": {"strength": "strong", "kind": "export", "evidence": "config"},
"flow": {"keys": 84, "bytes": 139670063, "first": 1770062971, "last": 1787373166,
         "direction": "inferred", "confidence": "single-candidate"}
```

Keeping `flow` a separate object with its own `direction: inferred` field is
the schema-level expression of rule 33 below: a consumer cannot accidentally
read it as fact.

## Visualisation

Deliberately reusing machinery that exists rather than inventing a second one:

* **Groups become badges.** The badge spec already has an *Annex policy* group,
  a priority order and a cap of four. `backup`, `archive`, `source`, `client`,
  `transfer` are glyph-sized; `unwanted` and `dead` are the loud ones. Free,
  global, no new panel.
* **Automated routes are an edge style,** alongside the existing
  `trk-current` / `trk-none` styling — but style carries *strength*, not a
  binary, and the relation panel names the evidence. A dotted grey "weak,
  inferred from a default" must not look like a solid "there is a cron job".
* **Flow is edge weight plus a time scrubber** — and this is the first feature
  that genuinely justifies the *perspectives* idea sitting at 💭 in the
  ledger, because it is the same graph answering a different question.
* **Do not reuse the undo history for the time scrubber.** They are two
  different timelines — exploration time (what I clicked) versus world time
  (when data moved) — and merging them would break the one interaction with a
  clean 0.00 px guarantee. Two independent controls.

## Order of work, cheapest first

1. **`actor` from `uuid.log` + `git log git-annex`** — free, global, and on
   real data it is the difference between 25 clones and 1 repository with a
   bot. Start here.
2. **`annex_policy` from the branch** — plain git, same mechanism as
   `trust.log`, ~40 lines, needs a groups-using repository to test against.
3. **In-repo automation evidence** — config, hooks, CI files.
4. **Flow replay** — opt-in, incremental, byte-weighted from key names.
5. **Out-of-repo automation** (cron, systemd) — ssh-tier, behind a probe.

Steps 1–3 need no git-annex binary and no network, which means they are
testable in the e2e suite as it stands, given a fixture repository that has a
`git-annex` branch.
