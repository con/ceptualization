"""worldmap.json -> Graphviz DOT.

This is the server-side half of the round trip the README describes:

    worldmap.json  --(this module)-->  DOT  --(@hpcc-js/wasm, browser)-->  dot_json
                                                                             |
                                       cytoscape `preset` layout  <----------+

The DOT we emit deliberately mimics the shape `git annex map` already
produces (`subgraph cluster_<host> { ... }`), so that a future
`git annex map --json` / `--dot` integration can be dropped in at exactly
this seam with no change to the frontend.
"""

import re

_SAFE = re.compile(r"[^A-Za-z0-9_]")


def dot_id(node_id: str) -> str:
    """Graphviz-safe identifier. `d:lena` -> `d_lena`."""
    return _SAFE.sub("_", node_id)


def _q(s):
    return '"' + str(s).replace("\\", "\\\\").replace('"', '\\"') + '"'


# Node box sizes, in inches. Graphviz needs a real size to lay out around, and
# the frontend uses the *same* numbers when it converts dot_json points back to
# cytoscape pixels, so boxes and rendered nodes agree.
NODE_W = 2.6
NODE_H = 0.75
CONTAINER_W = 2.9
CONTAINER_H = 0.95


# When a container holds this many or more children (a RIA store with 40
# per-subject repos), a plain `dot` run stacks them in one 3500pt column.
# We chunk them into `rank=same` groups joined by invisible edges, which is
# the standard Graphviz way to grid a sibling set. See README, "gridding".
GRID_MIN = 10
GRID_ROWS = 8


def build_dot(worldmap, visible_ids=None, engine_hint="dot"):
    """Emit DOT for the (sub)graph of `visible_ids`.

    Containment (`parent`) becomes `subgraph cluster_*`, recursively:
    host -> clone, RIA store -> per-subject repo, superdataset -> subdataset.
    Relation edges (`kind`) become real DOT edges.
    """
    nodes = {n["id"]: n for n in worldmap["nodes"]}
    if visible_ids is None:
        visible = set(nodes)
    else:
        visible = set(visible_ids) & set(nodes)
        # a visible node drags in its whole containment chain
        for nid in list(visible):
            p = nodes[nid].get("parent")
            while p and p in nodes and p not in visible:
                visible.add(p)
                p = nodes[p].get("parent")

    children = {}
    roots = []
    for nid in sorted(visible):
        p = nodes[nid].get("parent")
        if p in visible:
            children.setdefault(p, []).append(nid)
        else:
            roots.append(nid)

    out = []
    out.append("digraph worldmap {")
    out.append(f'  // engine hint: {engine_hint}')
    out.append('  graph [rankdir=LR, compound=true, newrank=true, ranksep="1.0", nodesep="0.35", fontname="Helvetica"];')
    out.append('  node  [shape=box, style="rounded,filled", fontname="Helvetica", fontsize=11];')
    out.append('  edge  [fontname="Helvetica", fontsize=9];')

    gridded = set()

    def emit(nid, depth):
        pad = "  " * (depth + 1)
        n = nodes[nid]
        kids = sorted(children.get(nid, []))
        if kids:
            # a container: host, RIA store, superdataset with subdatasets
            out.append(f'{pad}subgraph cluster_{dot_id(nid)} {{')
            out.append(f'{pad}  id={_q("cluster:" + nid)};')
            out.append(f'{pad}  label={_q(n.get("label", nid))};')
            out.append(f'{pad}  labeljust="l"; labelloc="t"; style="rounded"; margin=24;')
            if n["type"] != "host":
                # the container is *also* a real node (a RIA store is a
                # distribution that contains distributions) -- keep it drawn.
                # The container is *also* a real node (a RIA store is a
                # distribution that contains distributions), and edges point at
                # it -- but in the rendered graph it is drawn as the compound
                # box itself, so here it only needs to be a routable anchor.
                out.append(
                    f'{pad}  {dot_id(nid)} [id={_q(nid)}, shape=point, '
                    f'width=0.12, height=0.12, label=""];'
                )
            leafy = [k for k in kids if not children.get(k)]
            if len(leafy) >= GRID_MIN and len(leafy) == len(kids):
                gridded.add(nid)
                chunks = [leafy[i:i + GRID_ROWS] for i in range(0, len(leafy), GRID_ROWS)]
                for ci, ch in enumerate(chunks):
                    out.append(f'{pad}  {{ rank=same; ' + " ".join(
                        f'{dot_id(k)} [id={_q(k)}, label={_q(nodes[k].get("label", k))}, '
                        f'gridpos="{ci},{ri}", '
                        f"width={NODE_W}, height={NODE_H}, fixedsize=true];" for ri, k in enumerate(ch)) + " }")
                for a, b in zip(chunks, chunks[1:]):
                    out.append(f'{pad}  {dot_id(a[0])} -> {dot_id(b[0])} [style=invis, weight=100];')
            else:
                for k in kids:
                    emit(k, depth + 1)
            out.append(f"{pad}}}")
        else:
            out.append(
                f'{pad}{dot_id(nid)} [id={_q(nid)}, label={_q(n.get("label", nid))}, '
                f"width={NODE_W}, height={NODE_H}, fixedsize=true];"
            )

    for r in roots:
        emit(r, 0)

    for e in sorted(worldmap["edges"], key=lambda e: e["id"]):
        # Containment is drawn by nesting; an edge that only restates the
        # `parent` relation is noise in both DOT and the rendered graph.
        if nodes.get(e["target"], {}).get("parent") == e["source"]:
            continue
        if e["source"] in visible and e["target"] in visible:
            label = e.get("remote_name") or ""
            attrs = [f'id={_q(e["id"])}', f'xlabel={_q(label)}' if label else None]
            if e["kind"] in ("part", "subdataset"):
                attrs.append("style=dashed")
            # Edges leaving a gridded cluster must not participate in ranking,
            # or they undo the grid we just built.
            if nodes[e["source"]].get("parent") in gridded or nodes[e["target"]].get("parent") in gridded:
                attrs.append("constraint=false")
            attrs = [a for a in attrs if a]
            out.append(f'  {dot_id(e["source"])} -> {dot_id(e["target"])} [{", ".join(attrs)}];')

    out.append("}")
    return "\n".join(out) + "\n"
