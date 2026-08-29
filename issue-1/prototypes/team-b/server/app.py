#!/usr/bin/env python3
"""Team B worldmap server -- stdlib http.server only (no FastAPI in this env).

Endpoints
---------
GET  /api/scenarios                 list of scenarios with metadata
GET  /api/seed/{scenario}           seed node + containment chain only
POST /api/expand                    {scenario,node_id,relation,known[]} -> new nodes/edges
                                    (artificial 300-900 ms probe delay)
POST /api/materialize               {scenario,ids[]} -> those nodes/edges (view reload)
GET  /api/full/{scenario}           whole worldmap (debug / DOT round-trip page)
GET  /api/roots/{scenario}          entry points to components unreachable from the seed
GET  /api/dot/{scenario}?ids=a,b    server-side DOT for the visible subgraph
GET  /api/view/{scenario}?name=x    load a saved view file
PUT  /api/view/{scenario}?name=x    save a view file (canonicalised here)
GET  /api/views/{scenario}          list saved view names
GET  /export/{scenario}?name=x      self-contained single-file interactive HTML
GET  /                              the Vite app (web/dist), falling back to web/
"""

import json
import mimetypes
import os
import random
import sys
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs, unquote

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SCENARIO_DIR = os.path.abspath(os.path.join(ROOT, "..", "..", "scenarios"))
VIEW_DIR = os.path.join(ROOT, "views")
DIST = os.path.join(ROOT, "web", "dist")
VIEWER_JS = os.path.join(ROOT, "web", "dist-viewer", "worldmap-viewer.iife.js")

sys.path.insert(0, HERE)
from dot import build_dot  # noqa: E402

SCENARIOS = ["s1-spacetop", "s2-babs-ria", "s3-forks"]

# artificial probe latency, ms -- a real `git ls-remote` over ssh is worse
PROBE_MIN_MS = 300
PROBE_MAX_MS = 900

_cache = {}


def worldmap(scenario):
    if scenario not in SCENARIOS:
        raise KeyError(scenario)
    if scenario not in _cache:
        with open(os.path.join(SCENARIO_DIR, scenario, "worldmap.json")) as f:
            wm = json.load(f)
        wm["_nodes"] = {n["id"]: n for n in wm["nodes"]}
        inc = {}
        for e in wm["edges"]:
            inc.setdefault(e["source"], []).append(e)
            inc.setdefault(e["target"], []).append(e)
        wm["_incident"] = inc
        _cache[scenario] = wm
    return _cache[scenario]


def rel_counts(wm, node_id):
    c = {}
    for e in wm["_incident"].get(node_id, []):
        c[e["kind"]] = c.get(e["kind"], 0) + 1
    return c


def pack_node(wm, n):
    out = dict(n)
    out.pop("_incident", None)
    out["rel_counts"] = rel_counts(wm, n["id"])
    return out


def ancestors(wm, node_id):
    """Containment chain (parents) of a node, outermost last."""
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
    """A finding only fires once every node it talks about is on screen.
    That is what makes s1's duplicate-UUID error a *discovery*, not a banner
    you were shown before you explored anything."""
    return [f for f in wm.get("findings", []) if all(n in visible for n in f["nodes"])]


def edges_within(wm, visible, known_edges):
    return [
        e for e in wm["edges"]
        if e["source"] in visible and e["target"] in visible and e["id"] not in known_edges
    ]


def components(wm):
    """Undirected connected components over relation edges (containment excluded)."""
    adj = {}
    for e in wm["edges"]:
        adj.setdefault(e["source"], set()).add(e["target"])
        adj.setdefault(e["target"], set()).add(e["source"])
    seen, comps = set(), []
    for nid in sorted(n["id"] for n in wm["nodes"] if n["type"] != "host"):
        if nid in seen:
            continue
        stack, comp = [nid], []
        seen.add(nid)
        while stack:
            cur = stack.pop()
            comp.append(cur)
            for nb in sorted(adj.get(cur, ())):
                if nb not in seen and wm["_nodes"].get(nb, {}).get("type") != "host":
                    seen.add(nb)
                    stack.append(nb)
        comps.append(sorted(comp))
    return comps


def other_roots(scenario):
    """Entry points into components that expansion from the seed can never reach.

    s3-forks really does have two: the fork network around con/duct, and the
    template-sibling trap (project-alpha / project-beta / python-template).
    A pure click-to-expand UI cannot discover the second one, which is a fact
    about expansion UIs, not about this fixture.
    """
    wm = worldmap(scenario)
    seeds = {n["id"] for n in wm["nodes"] if n.get("is_seed")}
    out = []
    for comp in components(wm):
        if seeds & set(comp):
            continue
        deg = {c: len(wm["_incident"].get(c, [])) for c in comp}
        root = max(comp, key=lambda c: (deg[c], -comp.index(c)))
        out.append({"root": root, "label": wm["_nodes"][root].get("label", root),
                    "size": len(comp), "members": comp})
    return out


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
        "stats": wm.get("stats", {}),
        "seeds": seeds,
        "nodes": [pack_node(wm, wm["_nodes"][i]) for i in sorted(visible)],
        "edges": edges_within(wm, visible, set()),
        "findings": findings_for(wm, visible),
        "total": {"nodes": len(wm["nodes"]), "edges": len(wm["edges"])},
        "other_roots": other_roots(scenario),
    }


def expand(scenario, node_id, relation, known):
    wm = worldmap(scenario)
    if node_id not in wm["_nodes"]:
        raise KeyError(node_id)
    known = set(known)
    new_ids = set()
    for e in wm["_incident"].get(node_id, []):
        if relation not in ("*", None) and e["kind"] != relation:
            continue
        other = e["target"] if e["source"] == node_id else e["source"]
        if other not in known:
            new_ids.add(other)
    # containment: pulling in a clone pulls in its host cluster too
    new_ids = with_ancestors(wm, new_ids) - known
    # and expanding a container reveals what it contains
    if relation in ("part", "subdataset", "*"):
        for n in wm["nodes"]:
            if n.get("parent") == node_id and n["id"] not in known:
                new_ids.add(n["id"])

    # The clicked node itself may not yet be on the client's map (it can be
    # reached through "reveal other component"), so hand it back too.
    if node_id not in known:
        new_ids.add(node_id)
    visible = known | new_ids | {node_id}
    known_edges = set()  # client sends node ids only; we recompute edges from visibility
    new_edges = [e for e in wm["edges"]
                 if e["source"] in visible and e["target"] in visible]
    return {
        "scenario": scenario,
        "node_id": node_id,
        "relation": relation,
        "nodes": [pack_node(wm, wm["_nodes"][i]) for i in sorted(new_ids)],
        "edges": new_edges,
        "findings": findings_for(wm, visible),
        "visible_count": len(visible),
        "other_roots": other_roots(scenario),
        "total": {"nodes": len(wm["nodes"]), "edges": len(wm["edges"])},
    }


# ---------------------------------------------------------------- view files

def canonical_view(obj):
    """Canonicalise a view so two saves of the same state produce identical
    bytes, and a real change produces a *small* diff: sorted keys, integer
    coordinates, sorted id lists, one field per line."""
    def rnd(p):
        return {"x": int(round(float(p.get("x", 0)))), "y": int(round(float(p.get("y", 0))))}

    positions = {}
    for mode, pos in sorted((obj.get("positions") or {}).items()):
        positions[mode] = {k: rnd(v) for k, v in sorted(pos.items())}

    view = obj.get("view") or {}
    out = {
        "format": "worldmap-view/1",
        "scenario": obj.get("scenario"),
        "generator": obj.get("generator", "team-b graphviz-first"),
        "saved_at": obj.get("saved_at") or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "layout_engine": obj.get("layout_engine", "graphviz/dot via @hpcc-js/wasm 2.35.0, output format json (xdot)"),
        "view": {
            "mode": view.get("mode", "map"),
            "theme": view.get("theme", "dark"),
            "zoom": round(float(view.get("zoom", 1)), 4),
            "pan": rnd(view.get("pan", {"x": 0, "y": 0})),
        },
        "visible": sorted(set(obj.get("visible") or [])),
        "expansions": sorted(
            ({"node": e["node"], "relation": e["relation"]} for e in (obj.get("expansions") or [])),
            key=lambda e: (e["node"], e["relation"]),
        ),
        "pinned": {k: rnd(v) for k, v in sorted((obj.get("pinned") or {}).items())},
        "positions": positions,
        # Graphviz's own edge waypoints, replayed as cytoscape segments.
        # "w1 w2 …|d1 d2 …" -- one short line per edge, so a diff stays local.
        "routes": {k: v for k, v in sorted((obj.get("routes") or {}).items()) if v},
    }
    return out


def view_path(scenario, name):
    safe = "".join(c for c in name if c.isalnum() or c in "-_") or "default"
    return os.path.join(VIEW_DIR, f"{scenario}.{safe}.view.json")


# ------------------------------------------------------------------- export

EXPORT_TEMPLATE = """<!doctype html>
<html lang="en" data-theme="__THEME__">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>worldmap — __SCENARIO__</title>
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

    def do_OPTIONS(self):
        self._send(204, b"", "text/plain")

    def do_PUT(self):
        u = urlparse(self.path)
        parts = [unquote(p) for p in u.path.strip("/").split("/")]
        if len(parts) == 3 and parts[0] == "api" and parts[1] == "view":
            scenario = parts[2]
            if scenario not in SCENARIOS:
                return self._err(404, "unknown scenario")
            n = int(self.headers.get("Content-Length") or 0)
            try:
                obj = json.loads(self.rfile.read(n) or b"{}")
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
                               "bytes": os.path.getsize(path),
                               "name": name,
                               "nodes": len(can["visible"])})
        self._err(404, "no such endpoint")

    def do_POST(self):
        u = urlparse(self.path)
        if u.path == "/api/materialize":
            n = int(self.headers.get("Content-Length") or 0)
            try:
                req = json.loads(self.rfile.read(n) or b"{}")
            except Exception as exc:
                return self._err(400, f"bad json: {exc}")
            scenario = req.get("scenario")
            if scenario not in SCENARIOS:
                return self._err(404, "unknown scenario")
            wm = worldmap(scenario)
            ids = [i for i in (req.get("ids") or []) if i in wm["_nodes"]]
            visible = set(ids)
            return self._json({
                "scenario": scenario,
                "title": wm.get("title"), "subtitle": wm.get("subtitle"),
                "exercises": wm.get("exercises", []),
                "nodes": [pack_node(wm, wm["_nodes"][i]) for i in sorted(visible)],
                "edges": edges_within(wm, visible, set()),
                "findings": findings_for(wm, visible),
                "total": {"nodes": len(wm["nodes"]), "edges": len(wm["edges"])},
            })

        if u.path == "/api/expand":
            n = int(self.headers.get("Content-Length") or 0)
            try:
                req = json.loads(self.rfile.read(n) or b"{}")
            except Exception as exc:
                return self._err(400, f"bad json: {exc}")
            scenario = req.get("scenario")
            if scenario not in SCENARIOS:
                return self._err(404, "unknown scenario")
            delay = random.uniform(PROBE_MIN_MS, PROBE_MAX_MS) / 1000.0
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
                out.append({"id": s, "title": wm.get("title"), "subtitle": wm.get("subtitle"),
                            "exercises": wm.get("exercises", []), "stats": wm.get("stats", {})})
            return self._json(out)

        if len(parts) == 3 and parts[0] == "api" and parts[1] in ("seed", "full", "dot", "view", "views", "roots"):
            scenario = parts[2]
            if scenario not in SCENARIOS:
                return self._err(404, "unknown scenario")
            kind = parts[1]
            if kind == "seed":
                return self._json(seed_payload(scenario))
            if kind == "roots":
                return self._json({"scenario": scenario, "roots": other_roots(scenario)})
            if kind == "full":
                wm = worldmap(scenario)
                return self._json({
                    "scenario": scenario, "title": wm.get("title"),
                    "nodes": [pack_node(wm, n) for n in wm["nodes"]],
                    "edges": wm["edges"], "findings": wm.get("findings", []),
                })
            if kind == "dot":
                wm = worldmap(scenario)
                ids = q.get("ids", [None])[0]
                vis = [i for i in ids.split(",") if i] if ids else None
                body = build_dot(wm, vis)
                return self._send(200, body, "text/vnd.graphviz; charset=utf-8")
            if kind == "views":
                os.makedirs(VIEW_DIR, exist_ok=True)
                pre = f"{scenario}."
                names = sorted(
                    f[len(pre):-len(".view.json")]
                    for f in os.listdir(VIEW_DIR)
                    if f.startswith(pre) and f.endswith(".view.json")
                )
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
            fname = f"worldmap-{scenario}.html"
            return self._send(200, html, "text/html; charset=utf-8",
                              {"Content-Disposition": f'inline; filename="{fname}"'})

        # ---- static
        rel = path.lstrip("/") or "index.html"
        for base in (DIST,):
            fp = os.path.abspath(os.path.join(base, rel))
            if not fp.startswith(os.path.abspath(base)):
                continue
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
    port = int(os.environ.get("PORT", "8391"))
    os.makedirs(VIEW_DIR, exist_ok=True)
    srv = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"team-b worldmap server on http://127.0.0.1:{port}", flush=True)
    print(f"  scenarios: {SCENARIO_DIR}", flush=True)
    print(f"  static:    {DIST}", flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
