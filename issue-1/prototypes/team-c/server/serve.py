#!/usr/bin/env python3
"""
Team C worldmap service -- stdlib only (no FastAPI in this environment).

Serves the three bake-off worldmap fixtures, an /api/expand probe endpoint with
an artificial 300-900 ms delay, and a procedurally enlarged /api/synthetic
worldmap for scale testing.

The client never receives the whole fixture at once (except for /api/full,
which exists only for the scale benchmark). It starts from the seed node and
grows the map by calling /api/expand.
"""
from __future__ import annotations

import json
import os
import posixpath
import random
import sys
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)                      # prototypes/team-c
SCEN = os.path.abspath(os.path.join(ROOT, "..", "..", "scenarios"))
WEBDIST = os.path.join(ROOT, "web", "dist")

SCENARIOS = ["s1-spacetop", "s2-babs-ria", "s3-forks"]

# Relations we allow expansion along.  `contains` is DERIVED from the `parent`
# field: the fixtures express host->clone / RIA->repo containment only through
# `parent`, and we need it to be walkable like any other relation.
DERIVED_CONTAINS = "contains"

_cache: dict[str, dict] = {}


def load(scenario: str) -> dict:
    if scenario in _cache:
        return _cache[scenario]
    if scenario not in SCENARIOS:
        raise KeyError(scenario)
    with open(os.path.join(SCEN, scenario, "worldmap.json")) as fh:
        raw = json.load(fh)
    _cache[scenario] = index(raw)
    return _cache[scenario]


def index(raw: dict) -> dict:
    """Build adjacency indices once per scenario."""
    nodes = {n["id"]: n for n in raw["nodes"]}
    # derived containment edges (parent -> child)
    derived = []
    for n in raw["nodes"]:
        p = n.get("parent")
        if p and p in nodes:
            derived.append({
                "id": "c:%s" % n["id"],
                "source": p,
                "target": n["id"],
                "kind": DERIVED_CONTAINS,
                "remote_name": None,
                "derived": True,
                "observed_at": n.get("observed_at"),
                "via": n.get("via"),
            })
    edges = list(raw["edges"]) + derived
    adj: dict[str, list[dict]] = {nid: [] for nid in nodes}
    for e in edges:
        if e["source"] in adj:
            adj[e["source"]].append(e)
        if e["target"] in adj and e["target"] != e["source"]:
            adj[e["target"]].append(e)
    return {
        "raw": raw,
        "nodes": nodes,
        "edges": edges,
        "edges_by_id": {e["id"]: e for e in edges},
        "adj": adj,
    }


def ancestors(idx: dict, node_id: str) -> list[str]:
    """parent chain, outermost first."""
    chain, cur, guard = [], idx["nodes"].get(node_id), 0
    while cur and cur.get("parent") and guard < 32:
        chain.append(cur["parent"])
        cur = idx["nodes"].get(cur["parent"])
        guard += 1
    return list(reversed(chain))


def relation_summary(idx: dict, node_id: str, known: set[str]) -> dict:
    """How many *undiscovered* neighbours hang off this node, per relation."""
    out: dict[str, dict] = {}
    for e in idx["adj"].get(node_id, ()):
        other = e["target"] if e["source"] == node_id else e["source"]
        slot = out.setdefault(e["kind"], {"total": 0, "new": 0})
        slot["total"] += 1
        if other not in known:
            slot["new"] += 1
    return out


def decorate(idx: dict, node_ids, known: set[str]) -> list[dict]:
    res = []
    for nid in node_ids:
        n = dict(idx["nodes"][nid])
        n["relations"] = relation_summary(idx, nid, known)
        res.append(n)
    return res


def seed_payload(scenario: str) -> dict:
    idx = load(scenario)
    raw = idx["raw"]
    seeds = [n["id"] for n in raw["nodes"] if n.get("is_seed")]
    if not seeds:
        seeds = [raw["nodes"][0]["id"]]
    ids: list[str] = []
    for s in seeds:
        for a in ancestors(idx, s):
            if a not in ids:
                ids.append(a)
        if s not in ids:
            ids.append(s)
    known = set(ids)
    edges = [e for e in idx["edges"]
             if e["source"] in known and e["target"] in known]
    return {
        "scenario": scenario,
        "title": raw.get("title"),
        "subtitle": raw.get("subtitle"),
        "exercises": raw.get("exercises", []),
        "stats": raw.get("stats", {}),
        "findings": raw.get("findings", []),
        "nodes": decorate(idx, ids, known),
        "edges": edges,
        "seeds": seeds,
        # the full census, so the UI can honestly say "12 of 51 discovered"
        "census": {
            "nodes": len(idx["nodes"]),
            "edges": len(idx["raw"]["edges"]),
        },
    }


def expand(scenario: str, node_id: str, relation: str, known: set[str]) -> dict:
    idx = load(scenario)
    if node_id not in idx["nodes"]:
        raise KeyError(node_id)
    known = set(known) | {node_id}
    new_ids: list[str] = []
    hit_edges: list[dict] = []
    for e in idx["adj"].get(node_id, ()):
        if relation not in ("*", e["kind"]):
            continue
        hit_edges.append(e)
        other = e["target"] if e["source"] == node_id else e["source"]
        if other in known or other in new_ids:
            continue
        for a in ancestors(idx, other):
            if a not in known and a not in new_ids:
                new_ids.append(a)
        new_ids.append(other)
    after = known | set(new_ids)
    # every edge that is now fully resolved but the client cannot know about
    edges = [e for e in idx["edges"]
             if e["source"] in after and e["target"] in after
             and not (e["source"] in known and e["target"] in known)]
    seen = {e["id"] for e in edges}
    for e in hit_edges:
        if e["id"] not in seen and e["source"] in after and e["target"] in after:
            edges.append(e)
            seen.add(e["id"])
    return {
        "scenario": scenario,
        "node_id": node_id,
        "relation": relation,
        "nodes": decorate(idx, new_ids, after),
        "edges": edges,
        # refreshed affordances for nodes the client already had
        "refresh": {nid: relation_summary(idx, nid, after)
                    for nid in known if nid in idx["nodes"]},
    }


# --------------------------------------------------------------------------
# synthetic scale fixture
# --------------------------------------------------------------------------
def synthetic(n: int, seed: int = 20260826) -> dict:
    """Procedurally enlarge the worldmap SHAPE (not the data) to ~n nodes.

    Same node/edge schema as the fixtures.  Clearly labelled synthetic.
    Mix mirrors the three scenarios: hosts with clones, one RIA store per
    ~8 hosts holding per-subject repos, and a fork fan on a forge.
    """
    rng = random.Random(seed)
    nodes: list[dict] = []
    edges: list[dict] = []
    eid = [0]

    def E(s, t, kind, **kw):
        eid[0] += 1
        e = {"id": "se%d" % eid[0], "source": s, "target": t, "kind": kind,
             "remote_name": kw.pop("remote_name", None),
             "observed_at": 1755000000, "via": "synthetic"}
        e.update(kw)
        edges.append(e)

    hostnames = ["typhon", "smaug", "rolando", "discovery", "lena", "falkor",
                 "hydra", "chimera", "kelpie", "wyvern", "drake", "nidhogg"]
    n_hosts = max(4, n // 12)
    clones: list[str] = []
    hub = None
    for h in range(n_hosts):
        if len(nodes) >= n:
            break
        hid = "h:syn%d" % h
        base = hostnames[h % len(hostnames)]
        nodes.append({"id": hid, "type": "host",
                      "label": "%s%d.synthetic.test" % (base, h),
                      "host_kind": "forge" if h % 7 == 0 else "host"})
        per = rng.randint(6, 14)
        for c in range(per):
            if len(nodes) >= n:
                break
            cid = "d:syn%d-%d" % (h, c)
            bare = c % 3 == 0
            nodes.append({
                "id": cid, "type": "distribution",
                "label": "/data/proj%02d/dataset-%03d" % (h, c),
                "on_host": hid, "parent": hid, "vcs": "git",
                "layout": "bare" if bare else "worktree",
                "annex_mode": "keystore" if c % 4 else "none",
                "packaging": [], "expanded": False,
                "observed_at": 1755000000, "via": "synthetic",
                "annex_uuid": "%08x-synt-4000-8000-%012x" % (rng.getrandbits(32), rng.getrandbits(48)),
                "is_seed": hub is None,
            })
            if hub is None:
                hub = cid
            clones.append(cid)
        # a RIA store on every 8th host, with per-subject repos
        if h % 8 == 3 and len(nodes) + 12 < n:
            rid = "d:synria%d" % h
            nodes.append({"id": rid, "type": "distribution",
                          "label": "ria-store /data/ria%d (ORA)" % h,
                          "on_host": hid, "parent": hid, "vcs": "none",
                          "layout": "ria-store", "annex_mode": "keystore",
                          "packaging": [], "expanded": False,
                          "observed_at": 1755000000, "via": "synthetic",
                          "special_remote_type": "ora"})
            for s in range(min(40, max(0, n - len(nodes)))):
                sid = "d:synria%d-sub%03d" % (h, s)
                nodes.append({"id": sid, "type": "distribution",
                              "label": "sub-%03d" % (s + 1),
                              "on_host": hid, "parent": rid, "vcs": "git",
                              "layout": "bare", "annex_mode": "keystore",
                              "packaging": [], "expanded": False,
                              "observed_at": 1755000000, "via": "synthetic",
                              "role": "result-branch",
                              "result_branch": "job-sub-%03d" % (s + 1),
                              "merged": s % 4 != 0})
                E(rid, sid, "part")
            E(clones[0] if clones else hub, rid, "remote",
              remote_name="output-ria", ahead=0, behind=40,
              resolution="resolved")

    # fork fan on the last forge host, if room
    if len(nodes) + 20 < n:
        fid = "h:synforge"
        nodes.append({"id": fid, "type": "host", "label": "forge.synthetic.test",
                      "host_kind": "forge"})
        up = "d:synup"
        nodes.append({"id": up, "type": "distribution", "label": "org/tool",
                      "on_host": fid, "parent": fid, "vcs": "git",
                      "layout": "bare", "annex_mode": "none", "packaging": [],
                      "expanded": False, "observed_at": 1755000000,
                      "via": "synthetic", "forge": "github", "is_upstream": True})
        k = 0
        while len(nodes) < n:
            k += 1
            kid = "d:synfork%d" % k
            ahead = 0 if k % 5 else rng.randint(1, 30)
            nodes.append({"id": kid, "type": "distribution",
                          "label": "user%03d/tool" % k, "on_host": fid,
                          "parent": fid, "vcs": "git", "layout": "bare",
                          "annex_mode": "none", "packaging": [],
                          "expanded": False, "observed_at": 1755000000,
                          "via": "synthetic", "forge": "github", "is_fork": True,
                          "ahead_of_upstream": ahead, "behind_upstream": 0,
                          "inactive": ahead == 0, "added_as_remote": False})
            E(kid, up, "fork_of", ahead=ahead, behind=0)
        E(hub, up, "remote", remote_name="origin", ahead=2, behind=0,
          resolution="resolved")

    # remote mesh between clones: each clone gets 1-3 remotes
    names = ["origin", "upstream", "exchange", "backup", "smaug", "typhon-exchange"]
    for i, c in enumerate(clones):
        for _ in range(rng.randint(1, 3)):
            t = clones[rng.randrange(len(clones))]
            if t == c:
                continue
            E(c, t, "remote", remote_name=rng.choice(names),
              ahead=rng.choice([0, 0, 0, 1, 3, 7, 12]),
              behind=rng.choice([0, 0, 2, 5, 21]), resolution="resolved")

    return {
        "scenario": "synthetic",
        "title": "SYNTHETIC scale fixture (%d nodes)" % len(nodes),
        "subtitle": "Procedurally generated. NOT real data. Shape only.",
        "synthetic": True,
        "exercises": ["renderer scale ceiling"],
        "nodes": nodes,
        "edges": edges,
        "findings": [{"severity": "info", "code": "synthetic",
                      "message": "Synthetic fixture: %d nodes / %d edges. "
                                 "Not derived from any real repository."
                                 % (len(nodes), len(edges)),
                      "nodes": []}],
        "stats": {"nodes": len(nodes), "edges": len(edges),
                  "hosts": sum(1 for x in nodes if x["type"] == "host")},
    }


MIME = {".html": "text/html; charset=utf-8", ".js": "text/javascript",
        ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json",
        ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon",
        ".map": "application/json", ".woff2": "font/woff2"}


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "worldmap-teamc/0.1"

    def log_message(self, fmt, *args):
        if os.environ.get("WORLDMAP_QUIET"):
            return
        sys.stderr.write("[srv] %s\n" % (fmt % args))

    # ---- helpers
    def send_json(self, obj, status=200):
        body = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Content-Length", "0")
        self.end_headers()

    # ---- routes
    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        p, q = u.path, urllib.parse.parse_qs(u.query)
        # the brief spells these without the /api prefix; accept both
        for bare in ("/scenarios", "/seed/", "/full/", "/synthetic", "/health"):
            if p == bare or p.startswith(bare):
                p = "/api" + p
                break
        try:
            if p == "/api/scenarios":
                out = []
                for s in SCENARIOS:
                    raw = load(s)["raw"]
                    out.append({"id": s, "title": raw.get("title"),
                                "subtitle": raw.get("subtitle"),
                                "exercises": raw.get("exercises", []),
                                "stats": raw.get("stats", {})})
                return self.send_json({"scenarios": out})
            if p.startswith("/api/seed/"):
                return self.send_json(seed_payload(p.rsplit("/", 1)[-1]))
            if p.startswith("/api/full/"):
                # whole fixture in one shot -- used only by the benchmark
                idx = load(p.rsplit("/", 1)[-1])
                raw = idx["raw"]
                known = set(idx["nodes"])
                return self.send_json({
                    "scenario": raw["scenario"], "title": raw.get("title"),
                    "subtitle": raw.get("subtitle"),
                    "exercises": raw.get("exercises", []),
                    "findings": raw.get("findings", []),
                    "stats": raw.get("stats", {}),
                    "seeds": [n["id"] for n in raw["nodes"] if n.get("is_seed")],
                    "census": {"nodes": len(idx["nodes"]),
                               "edges": len(raw["edges"])},
                    "nodes": decorate(idx, list(idx["nodes"]), known),
                    "edges": idx["edges"]})
            if p == "/api/synthetic":
                n = max(10, min(30000, int(q.get("n", ["2000"])[0])))
                data = synthetic(n)
                data["seeds"] = [x["id"] for x in data["nodes"] if x.get("is_seed")]
                data["census"] = {"nodes": len(data["nodes"]),
                                  "edges": len(data["edges"])}
                for x in data["nodes"]:
                    x.setdefault("relations", {})
                return self.send_json(data)
            if p == "/api/health":
                return self.send_json({"ok": True, "scenarios": SCENARIOS})
            return self.serve_static(p)
        except KeyError as exc:
            return self.send_json({"error": "not found: %s" % exc}, 404)
        except Exception as exc:                      # pragma: no cover
            return self.send_json({"error": repr(exc)}, 500)

    def do_POST(self):
        u = urllib.parse.urlparse(self.path)
        if u.path not in ("/api/expand", "/expand"):
            return self.send_json({"error": "no such endpoint"}, 404)
        try:
            n = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(n) or b"{}")
            scenario = body["scenario"]
            node_id = body["node_id"]
            relation = body.get("relation", "*")
            # `known` is an extension: without it the server cannot tell which
            # nodes are *newly* discovered, so it falls back to "just the seed"
            known = set(body.get("known", [seed_payload(scenario)["nodes"][0]["id"]]))
            # artificial probe latency: this is what an ssh/forge round-trip costs
            delay = random.uniform(0.30, 0.90)
            time.sleep(delay)
            res = expand(scenario, node_id, relation, known)
            res["probe_ms"] = round(delay * 1000)
            return self.send_json(res)
        except KeyError as exc:
            return self.send_json({"error": "not found: %s" % exc}, 404)
        except Exception as exc:                      # pragma: no cover
            return self.send_json({"error": repr(exc)}, 500)

    def serve_static(self, path):
        rel = posixpath.normpath(urllib.parse.unquote(path)).lstrip("/")
        if rel in ("", "."):
            rel = "index.html"
        full = os.path.join(WEBDIST, rel)
        if not os.path.abspath(full).startswith(os.path.abspath(WEBDIST)):
            return self.send_json({"error": "nope"}, 403)
        if not os.path.isfile(full):
            full = os.path.join(WEBDIST, "index.html")
            if not os.path.isfile(full):
                return self.send_json(
                    {"error": "web/dist not built; run `npm run build` in web/, "
                              "or use the Vite dev server on :5173"}, 404)
        with open(full, "rb") as fh:
            data = fh.read()
        ext = os.path.splitext(full)[1]
        self.send_response(200)
        self.send_header("Content-Type", MIME.get(ext, "application/octet-stream"))
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)


def main():
    port = int(os.environ.get("WORLDMAP_PORT", "8853"))
    srv = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    sys.stderr.write("worldmap server on http://127.0.0.1:%d  (dist=%s)\n"
                     % (port, WEBDIST))
    srv.serve_forever()


if __name__ == "__main__":
    main()
