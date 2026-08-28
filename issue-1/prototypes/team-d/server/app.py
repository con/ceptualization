#!/usr/bin/env python3
"""Team D worldmap server -- stdlib http.server only (FastAPI is not installed here).

Forked from team-b/server/app.py (same repo, same licence). What team B already
solved is kept verbatim where possible: the probe-latency model, the canonical
view file, and the self-contained export. What is new here:

  * `contains` is a FIRST-CLASS WALKABLE RELATION, synthesised from `parent`
    and injected into the edge list, so it shows up in rel_counts and can be
    expanded along like any other relation. Team C had to synthesise it in the
    client or "a quarter of s3 is unreachable from the seed".
  * /api/roots returns EVERY component root (not only the ones the seed misses)
    and reports reachability twice: over relation edges only, and with
    `contains` allowed. The difference between the two numbers is the honest
    size of the "you cannot get there by clicking remotes" problem.
  * /api/reach answers the same question for an arbitrary visible set, which is
    what drives the always-on "N nodes not reachable from here" counter.
  * every node carries `child_count` / `descendant_count`, which the client's
    container tier uses to size a container box. It never uses them to place
    anything that has not been discovered.

Endpoints
---------
GET  /api/scenarios                 list of scenarios with metadata
GET  /api/seed/{scenario}           seed node + containment chain only
POST /api/expand                    {scenario,node_id,relation,known[]}
POST /api/materialize               {scenario,ids[]} -> those nodes/edges
POST /api/reach                     {scenario,visible[]} -> reachability report
GET  /api/roots/{scenario}          every component root + reachability summary
GET  /api/full/{scenario}           whole worldmap (debug)
GET  /api/view/{scenario}?name=x    load a saved view file
PUT  /api/view/{scenario}?name=x    save a view file (canonicalised here)
GET  /api/views/{scenario}          list saved view names
GET  /export/{scenario}?name=x      self-contained single-file interactive HTML
GET  /                              the Vite app (web/dist)
"""

import json
import mimetypes
import os
import subprocess
import random
import sys
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs, unquote

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SCENARIO_DIR = os.path.abspath(os.environ.get(
    "WORLDMAP_DIR", os.path.join(ROOT, "..", "..", "scenarios")))
VIEW_DIR = os.path.join(ROOT, "views")
DIST = os.path.join(ROOT, "web", "dist")
VIEWER_JS = os.path.join(ROOT, "web", "dist-viewer", "worldmap-viewer.iife.js")

def _discover():
    """Any directory holding a worldmap.json is a scenario.

    Lets `worldmap-crawl.py -o DIR/<name>` output be explored directly:
        WORLDMAP_DIR=/tmp/wm ./run.sh
    """
    try:
        found = sorted(d for d in os.listdir(SCENARIO_DIR)
                       if os.path.isfile(os.path.join(SCENARIO_DIR, d, "worldmap.json")))
    except OSError:
        found = []
    return found or ["s1-spacetop", "s2-babs-ria", "s3-forks"]


class _Scenarios(list):
    """Re-scan on every membership test, so a freshly crawled map shows up
    without restarting the server."""

    def __contains__(self, item):
        if list.__contains__(self, item):
            return True
        fresh = _discover()
        if item in fresh:
            self[:] = fresh
            return True
        return False

    def __iter__(self):
        self[:] = _discover()
        return list.__iter__(self)


SCENARIOS = _Scenarios(_discover())

# artificial probe latency, ms -- a real `git ls-remote` over ssh is worse.
PROBE_MIN_MS = 300
PROBE_MAX_MS = 900

# Relations you can walk. `contains` is in this list on purpose: it is the
# relation "this host/store/superdataset holds that repository", and it is the
# only way to reach 6 of s3's 68 nodes.
# Baseline vocabulary. The effective list is derived per worldmap in
# walkable_for(), so a crawler that emits a relation we have never seen
# (e.g. `annex_knows` from worldmap-crawl.py) is still expandable instead of
# being silently unreachable.
WALKABLE_BASE = ["remote", "subdataset", "part", "worktree_of", "fork_of",
                 "shares_history_with", "candidate_same_as", "same_annex_uuid",
                 "contains"]
WALKABLE = WALKABLE_BASE


def walkable_for(wm):
    """Every relation kind actually present, baseline first for stable order."""
    present = {e.get("kind") for e in wm.get("edges", []) if e.get("kind")}
    present.add("contains")
    return [k for k in WALKABLE_BASE if k in present] + \
           sorted(present - set(WALKABLE_BASE))

def tool_version():
    """`git describe --always --dirty` of the checkout this is running from,
    so a screenshot or a saved view names the exact code that produced it."""
    try:
        out = subprocess.run(
            ["git", "-C", ROOT, "describe", "--always", "--dirty", "--tags"],
            capture_output=True, text=True, timeout=5)
        v = out.stdout.strip()
        return v or "unknown"
    except Exception:
        return "unknown"


VERSION = tool_version()

_cache = {}


def worldmap(scenario):
    if scenario not in SCENARIOS:
        raise KeyError(scenario)
    if scenario in _cache:
        return _cache[scenario]
    with open(os.path.join(SCENARIO_DIR, scenario, "worldmap.json")) as f:
        wm = json.load(f)
    nodes = {n["id"]: n for n in wm["nodes"]}

    # ---- `contains` becomes a real edge, derived from `parent`.
    contains = []
    for n in wm["nodes"]:
        p = n.get("parent")
        if p and p in nodes:
            contains.append({
                "id": "ct:" + n["id"],
                "source": p,
                "target": n["id"],
                "kind": "contains",
                "remote_name": None,
                "derived": True,
                "observed_at": n.get("observed_at"),
            })
    wm["edges"] = list(wm["edges"]) + contains

    wm["_nodes"] = nodes
    inc = {}
    for e in wm["edges"]:
        inc.setdefault(e["source"], []).append(e)
        inc.setdefault(e["target"], []).append(e)
    wm["_incident"] = inc

    kids = {}
    for n in wm["nodes"]:
        p = n.get("parent")
        if p:
            kids.setdefault(p, []).append(n["id"])
    wm["_kids"] = kids

    def desc(nid):
        out = 0
        for k in kids.get(nid, ()):
            out += 1 + desc(k)
        return out

    wm["_child_count"] = {n["id"]: len(kids.get(n["id"], ())) for n in wm["nodes"]}
    wm["_desc_count"] = {n["id"]: desc(n["id"]) for n in wm["nodes"]}
    _cache[scenario] = wm
    return wm


def rel_counts(wm, node_id):
    """Counts keyed by `kind:direction`. Direction matters: `remote:out` from a
    superdataset is "the RIA store I push to" (one node), `remote:in` is "the 40
    per-subject repos that push to me". Team A's metrics use the same split, so
    ours are comparable to theirs."""
    c = {}
    for e in wm["_incident"].get(node_id, []):
        d = "out" if e["source"] == node_id else "in"
        k = e["kind"] + ":" + d
        c[k] = c.get(k, 0) + 1
    return c


def pack_node(wm, n):
    out = {k: v for k, v in n.items() if not k.startswith("_")}
    out["rel_counts"] = rel_counts(wm, n["id"])
    out["child_count"] = wm["_child_count"].get(n["id"], 0)
    out["descendant_count"] = wm["_desc_count"].get(n["id"], 0)
    return out


def ancestors(wm, node_id):
    chain = []
    p = wm["_nodes"][node_id].get("parent")
    seen = set()
    while p and p in wm["_nodes"] and p not in seen:
        seen.add(p)
        chain.append(p)
        p = wm["_nodes"][p].get("parent")
    return chain


def with_ancestors(wm, ids):
    out = set(ids)
    for nid in list(ids):
        out.update(ancestors(wm, nid))
    return out


def findings_for(wm, visible):
    """A finding fires only once every node it talks about is on screen: that is
    what makes s1's duplicate-UUID error a discovery rather than a banner."""
    return [f for f in wm.get("findings", []) if all(n in visible for n in f["nodes"])]


def edges_within(wm, visible):
    return [e for e in wm["edges"] if e["source"] in visible and e["target"] in visible]


# ------------------------------------------------------------- reachability

def _adj(wm, allow_contains):
    adj = {}
    for e in wm["edges"]:
        if e["kind"] == "contains" and not allow_contains:
            continue
        adj.setdefault(e["source"], set()).add(e["target"])
        adj.setdefault(e["target"], set()).add(e["source"])
    return adj


def _walk(adj, start):
    seen = set(start)
    stack = list(start)
    while stack:
        cur = stack.pop()
        for nb in adj.get(cur, ()):
            if nb not in seen:
                seen.add(nb)
                stack.append(nb)
    return seen


def components(wm, allow_contains=False):
    """Connected components over walkable relations. Hosts are included only
    when `contains` counts, because a host has no other kind of edge."""
    adj = _adj(wm, allow_contains)
    ids = [n["id"] for n in wm["nodes"]
           if allow_contains or n["type"] != "host"]
    seen, comps = set(), []
    for nid in ids:
        if nid in seen:
            continue
        comp = sorted(_walk(adj, [nid]) & set(ids))
        seen.update(comp)
        comps.append(comp)
    return comps


def _root_of(wm, comp):
    """The node a human would start from: highest relation degree, ties broken
    by seed-ness and then id, so the answer is stable across runs."""
    def score(c):
        n = wm["_nodes"][c]
        deg = len([e for e in wm["_incident"].get(c, []) if e["kind"] != "contains"])
        return (1 if n.get("is_seed") else 0, 1 if n.get("is_upstream") else 0, deg, c)
    return max(comp, key=score)


def roots_payload(scenario):
    wm = worldmap(scenario)
    seeds = [n["id"] for n in wm["nodes"] if n.get("is_seed")] or [wm["nodes"][0]["id"]]
    comps = components(wm, allow_contains=False)
    out = []
    for comp in comps:
        r = _root_of(wm, comp)
        out.append({
            "root": r,
            "label": wm["_nodes"][r].get("label", r),
            "type": wm["_nodes"][r]["type"],
            "size": len(comp),
            "members": comp,
            "has_seed": bool(set(seeds) & set(comp)),
        })
    out.sort(key=lambda c: (not c["has_seed"], -c["size"]))
    rel_only = _walk(_adj(wm, False), seeds)
    with_ct = _walk(_adj(wm, True), seeds)
    total = len(wm["nodes"])
    return {
        "scenario": scenario,
        "seeds": seeds,
        "roots": out,
        "total": total,
        "components_relations_only": len(comps),
        "components_with_contains": len(components(wm, allow_contains=True)),
        "reachable_relations_only": len(rel_only),
        "reachable_with_contains": len(with_ct),
        "unreachable_even_with_contains": total - len(with_ct),
        "needs_contains": len(with_ct - rel_only),
    }


def reach_payload(scenario, visible):
    """The always-on counter: given what is on the map right now, what can and
    cannot be reached by continuing to click."""
    wm = worldmap(scenario)
    vis = [v for v in visible if v in wm["_nodes"]] or \
          [n["id"] for n in wm["nodes"] if n.get("is_seed")]
    rel_only = _walk(_adj(wm, False), vis)
    with_ct = _walk(_adj(wm, True), vis)
    total = len(wm["nodes"])
    unreached_roots = []
    for c in roots_payload(scenario)["roots"]:
        if not (set(c["members"]) & set(vis)):
            unreached_roots.append({k: c[k] for k in ("root", "label", "size", "type")})
    return {
        "scenario": scenario,
        "total": total,
        "visible": len(set(vis)),
        "reachable_relations_only": len(rel_only),
        "reachable_with_contains": len(with_ct),
        "needs_contains": len(with_ct - rel_only),
        "unreachable": total - len(with_ct),
        "unreached_roots": unreached_roots,
    }


# ------------------------------------------------------------------ payloads

def seed_payload(scenario):
    wm = worldmap(scenario)
    seeds = [n["id"] for n in wm["nodes"] if n.get("is_seed")]
    if not seeds:
        seeds = [wm["nodes"][0]["id"]]
    visible = with_ancestors(wm, seeds)
    return {
        "scenario": scenario,
        "title": wm.get("title"),
        "subtitle": wm.get("subtitle"),
        "exercises": wm.get("exercises", []),
        "seeds": seeds,
        "nodes": [pack_node(wm, wm["_nodes"][i]) for i in sorted(visible)],
        "edges": edges_within(wm, visible),
        "findings": findings_for(wm, visible),
        "total": {"nodes": len(wm["nodes"]), "edges": len(wm["edges"])},
        "reach": reach_payload(scenario, sorted(visible)),
        "walkable": walkable_for(wm),
        "viewer_version": VERSION,
        "map_generator": wm.get("generator") or wm.get("generated_from"),
        "map_tool_version": wm.get("tool_version"),
    }


def expand(scenario, node_id, relation, known):
    wm = worldmap(scenario)
    if node_id not in wm["_nodes"]:
        raise KeyError(node_id)
    known = set(known)
    new_ids = set()
    kind, _, want_dir = (relation or "*").partition(":")
    for e in wm["_incident"].get(node_id, []):
        if kind not in ("*", "") and e["kind"] != kind:
            continue
        d = "out" if e["source"] == node_id else "in"
        if want_dir and d != want_dir:
            continue
        other = e["target"] if e["source"] == node_id else e["source"]
        if other not in known:
            new_ids.add(other)
    # a discovered clone drags in the host that holds it: you cannot see a
    # repository without learning where it lives.
    new_ids = with_ancestors(wm, new_ids) - known
    if node_id not in known:
        new_ids.add(node_id)
    visible = known | new_ids | {node_id}
    return {
        "scenario": scenario,
        "node_id": node_id,
        "relation": relation,
        "nodes": [pack_node(wm, wm["_nodes"][i]) for i in sorted(new_ids)],
        "edges": edges_within(wm, visible),
        "findings": findings_for(wm, visible),
        "visible_count": len(visible),
        "total": {"nodes": len(wm["nodes"]), "edges": len(wm["edges"])},
        "reach": reach_payload(scenario, sorted(visible)),
    }


def materialize(scenario, ids):
    wm = worldmap(scenario)
    if ids == "*" or ids == ["*"]:
        visible = set(wm["_nodes"])
    else:
        visible = with_ancestors(wm, [i for i in ids if i in wm["_nodes"]])
    return {
        "scenario": scenario,
        "title": wm.get("title"),
        "subtitle": wm.get("subtitle"),
        "exercises": wm.get("exercises", []),
        "seeds": [n["id"] for n in wm["nodes"] if n.get("is_seed")],
        "nodes": [pack_node(wm, wm["_nodes"][i]) for i in sorted(visible)],
        "edges": edges_within(wm, visible),
        "findings": findings_for(wm, visible),
        "total": {"nodes": len(wm["nodes"]), "edges": len(wm["edges"])},
        "reach": reach_payload(scenario, sorted(visible)),
        "walkable": walkable_for(wm),
        "viewer_version": VERSION,
        "map_generator": wm.get("generator") or wm.get("generated_from"),
        "map_tool_version": wm.get("tool_version"),
    }


def _local_path(node):
    """Filesystem path of a distribution, if it is one we can run git in."""
    url = (node or {}).get("url") or ""
    return url[len("file://"):] if url.startswith("file://") else None


def relation_probe(scenario, edge_id, what):
    """The costly rows of the relation panel, run on demand.

    Kept behind an explicit action because these are the expensive ones, and
    every result is returned with the command that produced it so the panel can
    say where a number came from rather than asserting it.
    """
    wm = worldmap(scenario)
    edge = next((e for e in wm["edges"] if e.get("id") == edge_id), None)
    if edge is None:
        return {"error": f"unknown relation {edge_id}"}
    src = wm["_nodes"].get(edge.get("source")) or {}
    tgt = wm["_nodes"].get(edge.get("target")) or {}
    path = _local_path(src)
    if not path or not os.path.isdir(path):
        return {"error": "the source of this relation is not a local checkout, "
                         "so nothing can be run against it from here"}
    name = edge.get("remote_name")
    target_url = edge.get("url") or tgt.get("url")

    def run(args, timeout=60):
        try:
            r = subprocess.run(args, cwd=path, capture_output=True, text=True,
                               timeout=timeout)
            return r.returncode, r.stdout, r.stderr
        except (subprocess.TimeoutExpired, OSError) as exc:
            return 1, "", str(exc)

    if what == "branches":
        ref = name or target_url
        if not ref:
            return {"error": "no remote name or URL to query"}
        cmd = ["git", "ls-remote", "--heads", ref]
        rc, out, err = run(cmd)
        if rc != 0:
            return {"cmd": " ".join(cmd), "error": err.strip() or "ls-remote failed"}
        remote = {}
        for line in out.splitlines():
            parts = line.split()
            if len(parts) == 2 and parts[1].startswith("refs/heads/"):
                remote[parts[1][len("refs/heads/"):]] = parts[0]
        rc2, out2, _ = run(["git", "for-each-ref", "--format=%(refname:short) %(objectname)",
                            "refs/heads"])
        local = {}
        for line in (out2 or "").splitlines():
            parts = line.split()
            if len(parts) == 2:
                local[parts[0]] = parts[1]
        rows = []
        for b in sorted(set(local) | set(remote)):
            l, r = local.get(b), remote.get(b)
            state = ("same" if l and r and l == r
                     else "only here" if l and not r
                     else "only there" if r and not l else "differs")
            rows.append({"branch": b, "local": (l or "")[:8], "remote": (r or "")[:8],
                         "state": state})
        return {"cmd": " ".join(cmd), "rows": rows}

    if what == "content":
        if not name:
            return {"error": "content comparison needs a configured remote name"}
        res = {}
        for label, args in (
            ("they have, we do not",
             ["git", "annex", "find", "--in=" + name, "--not", "--in=here",
              "--format=${bytesize}\n"]),
            ("we have, they do not",
             ["git", "annex", "find", "--in=here", "--not", "--in=" + name,
              "--format=${bytesize}\n"]),
        ):
            rc, out, err = run(args, timeout=120)
            if rc != 0:
                return {"cmd": " ".join(args),
                        "error": (err.strip().splitlines() or ["git annex find failed"])[0]}
            n = 0
            total = 0
            for line in out.split():
                try:
                    total += int(line); n += 1
                except ValueError:
                    pass
            res[label] = {"keys": n, "bytes": total}
        return {"cmd": "git annex find --in=X --not --in=Y --format='${bytesize}'",
                "sides": res,
                "note": "believed from location tracking, not verified"}

    return {"error": f"unknown probe {what}"}


# ---------------------------------------------------------------- view files

def canonical_view(obj):
    """Canonicalise a view so two saves of the same state produce identical
    bytes and a real change produces a *small* diff.

    Team B canonicalised too and still churned 88 of 155 lines, because their
    generator (whole-graph Graphviz) moved everything. The extra idea here is
    that leaf coordinates are stored CONTAINER-LOCAL: a container that moves
    rewrites one `containers` line, not one line per child.
    """
    def rnd(p):
        return {"x": int(round(float(p.get("x", 0)))), "y": int(round(float(p.get("y", 0))))}

    def box(b):
        return {k: int(round(float(b.get(k, 0)))) for k in ("x", "y", "w", "h")}

    view = obj.get("view") or {}
    return {
        "format": "worldmap-view/2-twotier",
        "scenario": obj.get("scenario"),
        "generator": obj.get("generator", "team-d two-tier"),
        "saved_at": obj.get("saved_at") or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "layout_engine": obj.get(
            "layout_engine",
            "tier1 graphviz/dot via @hpcc-js/wasm 2.35.0 (format json/xdot) over containers only; "
            "tier2 fcose 2.2.0 over leaves in container-local coordinates; both in a Web Worker"),
        "view": {
            "theme": view.get("theme", "dark"),
            "zoom": round(float(view.get("zoom", 1)), 4),
            "pan": rnd(view.get("pan", {"x": 0, "y": 0})),
            "labels": view.get("labels", "on-demand"),
        },
        "visible": sorted(set(obj.get("visible") or [])),
        "collapsed": sorted(set(obj.get("collapsed") or [])),
        "expansions": sorted(
            ({"node": e["node"], "relation": e["relation"]} for e in (obj.get("expansions") or [])),
            key=lambda e: (e["node"], e["relation"])),
        # tier 1: one line per top-level box (world coords + size)
        "containers": {k: box(v) for k, v in sorted((obj.get("containers") or {}).items())},
        # sizes of anything that is not a default leaf (nested container boxes)
        "sizes": {k: {"w": int(round(v["w"])), "h": int(round(v["h"]))}
                  for k, v in sorted((obj.get("sizes") or {}).items())},
        # tier 2: leaf offsets from their container's centre (or absolute for
        # top-level leaves, which is what an empty `in` means)
        "local": {k: {"in": v.get("in") or "", **rnd(v)}
                  for k, v in sorted((obj.get("local") or {}).items())},
    }


def view_path(scenario, name):
    safe = "".join(c for c in name if c.isalnum() or c in "-_") or "default"
    return os.path.join(VIEW_DIR, f"{scenario}.{safe}.view.json")


# ------------------------------------------------------------------- export

EXPORT_TEMPLATE = """<!doctype html>
<html lang="en" data-theme="__THEME__">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>worldmap - __SCENARIO__</title>
<style>__CSS__</style>
</head>
<body>
<div id="app"></div>
<script id="worldmap-data" type="application/json">__DATA__</script>
<script>__JS__</script>
</body>
</html>
"""


def build_export(scenario, name="default"):
    p = view_path(scenario, name)
    if not os.path.exists(p):
        raise FileNotFoundError(p)
    with open(p) as f:
        view = json.load(f)
    wm = worldmap(scenario)
    visible = set(view.get("visible") or [])
    payload = {
        "scenario": scenario,
        "title": wm.get("title"),
        "subtitle": wm.get("subtitle"),
        "exercises": wm.get("exercises", []),
        "nodes": [pack_node(wm, wm["_nodes"][i]) for i in sorted(visible) if i in wm["_nodes"]],
        "edges": [e for e in wm["edges"] if e["source"] in visible and e["target"] in visible],
        "findings": findings_for(wm, visible),
        "reach": reach_payload(scenario, sorted(visible)),
        "view": view,
        "exported_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    if not os.path.exists(VIEWER_JS):
        raise FileNotFoundError(VIEWER_JS)
    with open(VIEWER_JS) as f:
        js = f.read()
    css_path = os.path.join(ROOT, "web", "src", "viewer.css")
    css = open(css_path).read() if os.path.exists(css_path) else ""
    html = EXPORT_TEMPLATE
    html = html.replace("__THEME__", view.get("view", {}).get("theme", "dark"))
    html = html.replace("__SCENARIO__", scenario)
    html = html.replace("__CSS__", css)
    html = html.replace("__DATA__", json.dumps(payload).replace("</", "<\\/"))
    html = html.replace("__JS__", js)
    return html


# ------------------------------------------------------------------ handler

class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def _send(self, code, body, ctype="application/json; charset=utf-8", extra=None):
        if isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,PUT,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Cache-Control", "no-store")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _json(self, obj, code=200):
        self._send(code, json.dumps(obj), "application/json; charset=utf-8")

    def _err(self, code, msg):
        self._json({"error": msg}, code)

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(n) or b"{}")

    def do_OPTIONS(self):
        self._send(204, b"", "text/plain")

    def do_PUT(self):
        u = urlparse(self.path)
        parts = [unquote(p) for p in u.path.strip("/").split("/")]
        if len(parts) == 3 and parts[0] == "api" and parts[1] == "view":
            scenario = parts[2]
            if scenario not in SCENARIOS:
                return self._err(404, "unknown scenario")
            try:
                obj = self._body()
            except Exception as exc:
                return self._err(400, f"bad json: {exc}")
            obj.setdefault("scenario", scenario)
            name = (parse_qs(u.query).get("name") or ["default"])[0]
            can = canonical_view(obj)
            os.makedirs(VIEW_DIR, exist_ok=True)
            path = view_path(scenario, name)
            with open(path, "w") as f:
                f.write(json.dumps(can, indent=2, sort_keys=True) + "\n")
            return self._json({"saved": os.path.relpath(path, ROOT),
                               "bytes": os.path.getsize(path), "name": name,
                               "nodes": len(can["visible"])})
        self._err(404, "no such endpoint")

    def do_POST(self):
        u = urlparse(self.path)
        try:
            req = self._body()
        except Exception as exc:
            return self._err(400, f"bad json: {exc}")
        scenario = req.get("scenario")
        if scenario not in SCENARIOS:
            return self._err(404, "unknown scenario")

        if u.path == "/api/materialize":
            return self._json(materialize(scenario, req.get("ids") or []))

        if u.path == "/api/reach":
            return self._json(reach_payload(scenario, req.get("visible") or []))

        if u.path == "/api/relation":
            return self._json(relation_probe(scenario, req.get("edge_id"),
                                             req.get("what", "branches")))

        if u.path == "/api/expand":
            delay = random.uniform(PROBE_MIN_MS, PROBE_MAX_MS) / 1000.0
            if req.get("nodelay"):
                delay = 0.0
            t0 = time.time()
            try:
                out = expand(scenario, req.get("node_id"), req.get("relation", "*"),
                             req.get("known") or [])
            except KeyError as exc:
                return self._err(404, f"unknown node {exc}")
            time.sleep(max(0.0, delay - (time.time() - t0)))
            out["probe_ms"] = round(delay * 1000)
            return self._json(out)
        self._err(404, "no such endpoint")

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        u = urlparse(self.path)
        path = unquote(u.path)
        q = parse_qs(u.query)
        parts = [p for p in path.strip("/").split("/") if p]

        if path == "/api/scenarios":
            out = []
            for s in SCENARIOS:
                wm = worldmap(s)
                out.append({"id": s, "title": wm.get("title"),
                            "subtitle": wm.get("subtitle"),
                            "exercises": wm.get("exercises", []),
                            "nodes": len(wm["nodes"]),
                            "edges": len(wm["edges"])})
            return self._json(out)

        if len(parts) == 3 and parts[0] == "api" and \
                parts[1] in ("seed", "full", "view", "views", "roots"):
            scenario = parts[2]
            if scenario not in SCENARIOS:
                return self._err(404, "unknown scenario")
            kind = parts[1]
            if kind == "seed":
                return self._json(seed_payload(scenario))
            if kind == "roots":
                return self._json(roots_payload(scenario))
            if kind == "full":
                wm = worldmap(scenario)
                return self._json({
                    "scenario": scenario, "title": wm.get("title"),
                    "nodes": [pack_node(wm, n) for n in wm["nodes"]],
                    "edges": wm["edges"], "findings": wm.get("findings", []),
                    "reach": reach_payload(scenario, [n["id"] for n in wm["nodes"]]),
                })
            if kind == "views":
                os.makedirs(VIEW_DIR, exist_ok=True)
                pre = f"{scenario}."
                names = sorted(f[len(pre):-len(".view.json")]
                               for f in os.listdir(VIEW_DIR)
                               if f.startswith(pre) and f.endswith(".view.json"))
                return self._json({"scenario": scenario, "names": names})
            if kind == "view":
                name = (q.get("name") or ["default"])[0]
                p = view_path(scenario, name)
                if not os.path.exists(p):
                    return self._err(404, f"no saved view '{name}' for {scenario}")
                with open(p) as f:
                    return self._json(json.load(f))

        if len(parts) == 2 and parts[0] == "export":
            scenario = parts[1]
            if scenario not in SCENARIOS:
                return self._err(404, "unknown scenario")
            name = (q.get("name") or ["default"])[0]
            try:
                html = build_export(scenario, name)
            except FileNotFoundError as exc:
                return self._err(409, f"cannot export: missing {exc}. Save a view first "
                                      f"and build the viewer bundle (npm run build).")
            return self._send(200, html, "text/html; charset=utf-8",
                              {"Content-Disposition":
                               f'inline; filename="worldmap-{scenario}.html"'})

        rel = path.lstrip("/") or "index.html"
        fp = os.path.abspath(os.path.join(DIST, rel))
        if fp.startswith(os.path.abspath(DIST)):
            if os.path.isdir(fp):
                fp = os.path.join(fp, "index.html")
            if os.path.exists(fp):
                ctype = mimetypes.guess_type(fp)[0] or "application/octet-stream"
                if fp.endswith(".wasm"):
                    ctype = "application/wasm"
                with open(fp, "rb") as f:
                    return self._send(200, f.read(), ctype)
        if rel != "index.html" and os.path.exists(os.path.join(DIST, "index.html")):
            with open(os.path.join(DIST, "index.html"), "rb") as f:
                return self._send(200, f.read(), "text/html; charset=utf-8")
        self._err(404, f"not found: {path} (did you run `npm run build` in web/?)")


def main():
    port = int(os.environ.get("PORT", "8861"))
    os.makedirs(VIEW_DIR, exist_ok=True)
    srv = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"team-d worldmap server on http://127.0.0.1:{port}", flush=True)
    print(f"  scenarios: {SCENARIO_DIR} -> {list(SCENARIOS)}", flush=True)
    print(f"  static:    {DIST}", flush=True)
    print(f"  version:   {VERSION}", flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
