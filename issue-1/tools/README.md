# Testing the prototypes against a real repository

The bake-off prototypes ship with three synthetic
[scenarios](../scenarios/README.md). **Nothing in the bake-off ever crawled a
real repository** — `worldmap-crawl.py` closes that gap.

## Quick start

```bash
# 1. crawl a real repo (offline, no git-annex needed, no ssh)
issue-1/tools/worldmap-crawl.py ~/proj/myrepo -o /tmp/wm/myrepo

# 2. point Team D's prototype at the crawl output and run it
cd issue-1/prototypes/team-d
WORLDMAP_DIR=/tmp/wm ./run.sh          # then pick "myrepo" from the dropdown
```

Any directory under `WORLDMAP_DIR` containing a `worldmap.json` becomes a
selectable scenario, so crawl as many repos as you like into one directory.
The dropdown is populated from `GET /api/scenarios`, and the server re-scans
on each request — a new crawl shows up on reload, without a restart.

## What the crawler reads

Everything below is plain `git`. **`git-annex` and `datalad` do not need to be
installed**, which is the point of finding 2 in the
[synthesis](../README.md): most of the map is readable without them.

| Source | Gives |
| --- | --- |
| `git config --get-regexp '^remote\..*\.url'` | remotes **and their per-clone names** — the core edges of issue #1 |
| `git config --get-regexp '^branch\..*\.(remote\|merge)'` | upstream tracking, for the identity signals |
| `git rev-list --left-right --count HEAD...<remote-ref>` | ahead/behind, from local refs, **no network** |
| `git cat-file -p git-annex:uuid.log` | every clone the annex knows about, incl. ones never visited |
| `git cat-file -p git-annex:remote.log` | special remotes with type / exporttree / encryption |
| `git cat-file -p git-annex:trust.log` | trust levels, so dead remotes can be flagged |
| `git cat-file -p HEAD:.datalad/config` | the DataLad dataset id (works on bare repos too) |
| `git worktree list --porcelain` | linked worktrees and their branches |
| `git config -f .gitmodules` | submodules, rendered as containment |

Options: `--depth N` follows local (`file://` or path) remotes N hops, so a
directory of sibling clones becomes a connected graph; `--ls-remote` allows
**one** network round trip per unresolved remote (~0.4 s each) and marks
non-answering ones unreachable.

## Worked example — the annex-branch shortcut, measured

A shallow clone of `dandi/dandi-bib` knows almost nothing:

```
$ worldmap-crawl.py dandi-bib -o /tmp/wm/dandi-bib
  4 nodes (1 probed), 1 edges, 2 hosts
```

Fetch just the `git-annex` branch — one command, **1.27 s**, no ssh, no
credentials:

```
$ git -C dandi-bib fetch --depth 1 --filter=blob:none origin \
      '+refs/heads/git-annex:refs/heads/git-annex'
$ worldmap-crawl.py dandi-bib -o /tmp/wm/dandi-bib
  28 nodes (1 probed), 24 edges, 3 hosts
```

**23 clones discovered from one branch fetch.** Expanding the seed in the
prototype returns 27 nodes / 49 edges in one probe. That is the research claim
reproduced on real data rather than on a fixture.

## What it does *not* do

* **No ssh.** Remote hosts are drawn as nodes but never contacted. The
  security design in the [synthesis](../README.md) is unimplemented.
* **No forge APIs** — fork networks (issue #6) are not discovered.
* **No identity resolution.** `same_as`, containment and merge-base scoring
  from
  [distribution-modeling-and-repo-identity.md](../distribution-modeling-and-repo-identity.md)
  are not computed; clones are distinct nodes unless the annex branch links
  them.
* **No persistence into the repo.** Output is a standalone JSON file, not the
  `.git/orinoco/` + `orinoco` branch design from
  [repo-embedded-things-and-collections.md](../repo-embedded-things-and-collections.md).
* Findings are limited to duplicate annex UUID, dead remotes, unreachable
  remotes, and behind-ness.

It is a fixture generator that happens to read real repositories — enough to
try the prototypes on your own data, not a walker.

## Trying the other prototypes

Teams A, B and C hardcode the three scenario names in both server and client,
so they need the same two-line change made to Team D
(`server/app.py` scenario discovery, `web/src/main.js` dropdown from
`/api/scenarios`). Only Team D has been wired up.
