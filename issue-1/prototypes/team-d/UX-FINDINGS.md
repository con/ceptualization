# UX findings — team D

Written after driving the running app with Playwright across all three
fixtures, in both themes, plus the three `file://` exports. Every number here
was measured; where I am guessing I say so. This document exists to record what
is *wrong*, so the good news is compressed into one paragraph at the end.

Environment: Chromium via Playwright 1.62.1, viewport 1600×1000 or 1680×1000,
software WebGL (SwiftShader), DPR stated wherever it matters. Cytoscape draws
on 2-D canvas here, not WebGL.

---

## 1. The headline feature is carried by the fallback, not by fcose

The design says leaves are placed by fcose inside fixed container bounds. They
mostly are not.

Across the three scenarios' 17 expansions there are **20 tier-2 runs**. Of
those:

| tier-2 outcome | runs |
| --- | --- |
| `grid` — the container's children have no edges among them, so fcose is skipped outright | **12** |
| `grid-after-fcose-overlapped(n)` — fcose ran, its result could not be made overlap-free inside the box, the slot grid replaced it | **6** |
| `fcose` — the force-directed result survived | **2** |

The worst case is the one that matters most: `h:github` receiving 60 forks.
fcose placed them, clamping into the box produced **247 overlapping pairs**, and
the grid replaced the whole thing. Before I added the fallback, the app
rendered 191 overlapping node pairs in s3 and 2 in s1 — visible in an earlier
screenshot as `d:upstream` sitting on top of a dozen forks.

The reason is structural, not a tuning problem. A force layout wants to expand
until its forces balance; a container box is a hard rectangle sized to a slot
grid. Clamping a force result into a rectangle piles nodes against the walls,
which is exactly where overlaps come from. **fcose is the wrong tool for tier
2.** The right tool is a packing algorithm with sticky slot assignment. fcose
earns its keep only for the small, genuinely-connected case (`h:smaug` and
`h:discovery` in s1, two nodes each with an edge between them) — 2 runs out of
20.

I built what the mandate asked for and it is the weakest part of the system.

## 2. Node text is illegible at fit zoom, and I chose to leave it that way

At the app's own fit-to-everything zoom the numbers are:

| | s1 (zoom 0.577) | s2 (zoom 0.451) | s3 (zoom 0.558) |
| --- | --- | --- | --- |
| labelled edge text | **13.0 px** | (none labelled) | **13.0 px** |
| plain node text | **6.92 px** | **6.76 px** | ~6.9 px |
| node text on a finding node (`⇄ 2 names`, duplicate UUID) | 7.5 px | — | 7.5 px |

Team A measured 4.3–5.1 px for their edge labels and called it below
legibility. Our *node* labels are at 6.8 px, which is barely better. Only the
labelled edges are legible.

This was a deliberate trade and I stand by it, but it is a real cost: at fit
zoom you can read the *relations* and not the *repository paths*. I tried
compensating node font size the same way (`11 / zoom`) and it was worse — a
three-line path at 17 px overflows a 76 px-tall box and collides with the
neighbour, which an intermediate build did visibly. There are two honest fixes
I did not build: give finding nodes a larger box (the leaf-size hook exists,
`measureBoxes(ids, childrenOf, leafSize)`, and is unused), or draw the badge as
a separate anchored element instead of as part of the node label.

The "reading zoom" button (floor 0.8, ≈10 px node text) is the workaround, and
at that zoom **81 % of the s3 map is on screen** — the map is 2061×1076 model
px against a 1675×1250 viewport. So the workaround costs you a fifth of the
picture.

## 3. A container is unclickable except for its title band

Containers are ordinary nodes drawn behind their children. Their children cover
the middle of the box. The only place a click reaches the container is the
48 px title band at the top — everywhere else you select a child instead.

I found this by trying to double-click `d:ria` at its centre to collapse it:
nothing happened, because the centre of the RIA store is occupied by
`sub-020`. Clicking the title band works and opens the inspector with a
"collapse container" button. The sidebar's per-container `open/collapsed`
toggle is the only discoverable affordance, and it lists containers by raw id
(`d:ria`, `h:github`) rather than by label.

Double-click-to-collapse is therefore effectively undiscoverable. It should be
a visible control in the container's title band — the affordance nobody can
find is the one drawn where the click already lands.

## 4. Aggregation only happens when you collapse, so the expanded map is still a hairball

s2 fully expanded draws **83 edges for 46 nodes**, and 40 of those edges are
the identical `origin` fan from the 40 RIA repositories to the superdataset.
Collapsing the RIA store folds them (86 → 7), but if you want to *see* the
per-subject repositories you also see 40 parallel edges landing on one node.

`collapse.js:aggregate` already merges by `(source, target, relation)`; it just
never fires while expanded, because each of those 40 edges has a distinct
source. The fix is to aggregate on the *box* the source lives in even when the
box is open — draw one thick bundled `origin ×40` edge from the RIA box to the
superdataset, with the individual edges available on selection. That is what
the "one bundled edge per (source-group, target-group, relation)" instruction
actually asks for, and I implemented only half of it.

Related and smaller: selecting an aggregated edge shows nothing about its
members. The data is on the element (`members` is an array of the folded edge
ids) and there is no UI for it.

## 5. The "N not reachable from here" number is right and reads wrong

On the s1 seed the panel says **8** — and it is correct: from `d:lena`, walking
only relation edges, you cannot reach any of the eight other hosts, because a
host has no relation edges at all. It has `contains`.

A user reads "8 nodes not reachable" and thinks something is broken. The panel
does explain it on the next three lines (`reachable if contains counts: 24/24`,
`only reachable via contains: 8`, `unreachable even then: 0`), but the big
orange number is the thing you see and it is the least informative of the four.

The number that would actually help is **"nodes in components you cannot reach
at all"** — 0 for s1 and s2, **4** for s3 after the fork expansion. That is the
number that means "you are missing something", and it is currently the third
line in small type. I got the information architecture right and the visual
hierarchy backwards.

The *affordance* works, though: in s3 the panel lists `d:proj-a`
(`con/project-alpha`, 4 nodes) with a `reveal` button, clicking it materialises
that root, and expanding from there reaches the `identity-ambiguous` finding
that no team could reach by clicking from the seed. See
`screenshots/s3-04-unreachable-affordance.png` and `s3-05`, `s3-06`.

## 6. The expand buttons lie about how much work is left

The inspector lists relations as `fork_of:in 60`, `contains:in 1`,
`remote:in 1`. Those are *total* counts from the store, not the number of nodes
that are still off the map. After you have expanded `fork_of:in`, the button
still says `60` and only gains a `done` class that dims it slightly. There is
no "58 new / 2 already here" anywhere, which is precisely the number you want
before clicking something that will add 60 nodes to your picture.

Team A and team C both built a preview-before-add for s3. I did not, and the
result is that `d:upstream|fork_of:in` is a 60-node cliff with no warning: one
click takes the map from 4 nodes to 64, grows the `h:github` box from 210×76 to
1686×1072, and drops the fit zoom from 1.6 to 0.56.

## 7. There is no way to remove anything

Once a node is on the map it stays. There is no hide, no undo, no "collapse
this branch back". Collapse hides *children of a container*, which is not the
same thing: you cannot un-reveal the 60 forks except by reloading the scenario
and starting again. For an exploration tool whose main risk is over-expansion
(see #6), that is the wrong end of the asymmetry.

## 8. Small things, measured

* **Reload drift is not zero.** Save → reload moves nodes by up to **0.462 px**
  (median 0.006). Team B measured 0 px. The cause is ours: the view file
  rounds coordinates to integers and a container's centre is reconstructed from
  a rounded box, so a leaf can land half a pixel off.
* **Cold first paint is 324–354 ms** (median of 5 fresh browser contexts, two
  separate runs), against team A's 311 ms. We ship a 1.38 MB worker bundle
  they do not.
* **Slack is visible as whitespace.** `h:github` gets a 64-slot tier laid out
  as 7×10 for its 61 children (1686×1072 px); `d:ria` gets a 48-slot tier as
  6×8 for its 40 (1450×868 px). The empty slots are what makes the next
  expansion free, and they look like a bug.
* **The toast is developer-facing.** It says `+40 nodes · containers moved
  684.83 px max · leaves 0 px max`. That is a metric readout, not a message to
  a user, and it is on screen in most of the screenshots.
* **`d:ria` inside `h:ria` is a double box.** A host that contains exactly one
  store draws two nearly-identical nested rectangles. It is correct and it
  looks redundant; the two should be merged visually when a container has a
  single container child.
* **DPR 2 costs roughly 1.2–1.7×** on the 68-node reveal: longest frame
  100.0–116.6 ms at DPR 1 against 133.3–333.2 ms at DPR 2 across repeat runs
  (s2: 116.6–133.4 against 149.9–200.0). Team C warned about ±40 % run to run
  and I see the same spread, so treat these as ordering, not magnitude.

---

## What actually works

The two-tier claim holds, measured. Across 17 expansions on three fixtures:
every leaf inside the container being expanded moved **0.00 px**; every
container other than the one that grew moved **0.00 px on 16 of 17** (97 px on
the one where a host grew downward into two neighbours); there are **0
containment violations and 0 overlapping node pairs** in the final state of all
three scenarios; a collapse→expand round trip restores all 50 (s2) and 68 (s3)
nodes to **0.000 px**; two saves of the same state produce a **byte-identical**
file and one expansion changes **14–16 lines of 190**; collapse cuts s2 from 86
edges to 7 and s3 from 66 to 3; the whole layout runs in a worker and the
68-node reveal's longest frame is **100–117 ms** instead of team A's 417 ms; and at
the app's own fit zoom the map says `rolando-exchange ▼12` and
`spacetop-rolando-exchange ▲12` on two edges into the same node, at **13.0
rendered px**, with no inspector open — which is the sentence issue #1 was
opened to make visible.
