#!/usr/bin/env python3
"""Team A worldmap server.

Stdlib-only (no FastAPI available in this environment) threading HTTP server that

  * keeps the three worldmap fixtures server-side, and reveals them progressively;
  * serves only the seed node (+ its containment ancestors) on first load;
  * answers POST /api/expand with *only the newly discovered* nodes/edges,
    after an artificial 300-900 ms delay that stands in for an ssh / forge-API probe;
  * serves the built Vite app from web/dist.

The client is authoritative about what it already knows: every expand request carries
`known_nodes` / `known_edges`, so the server is stateless and several browser tabs can
explore the same scenario independently.
"""

from __future__ import annotations

import argparse
import json
import mimetypes
import os
import posixpath
import random
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SCENARIO_DIR = os.path.abspath(os.path.join(ROOT, "..", "..", "scenarios"))
WEB_DIST = os.path.join(ROOT, "web", "dist")

SCENARIOS = ("s1-spacetop", "s2-babs-ria", "s3-forks")

# Artificial probe latency, in seconds. This is the whole point of the exercise:
# expansion latency is the core UX problem, so it is simulated, not hidden.
LATENCY_MIN = 0.30
LATENCY_MAX = 0.90

# How a relation reads to a human, per (kind, direction).
RELATION_LABELS = {
    ("remote", "out"): ("remotes", "git remote -v on this clone"),
    ("remote", "in"): ("used as a remote by", "clones that configure this one as a remote"),
    ("subdataset", "out"): ("subdatasets", ".gitmodules of this dataset"),
    ("subdataset", "in"): ("superdataset", "dataset that registers this one"),
    ("part", "out"): ("contents", "repositories stored inside this store"),
    ("part", "in"): ("stored in", "the store that contains this repository"),
    ("worktree_of", "out"): ("main repository", "git worktree list origin"),
    ("worktree_of", "in"): ("worktrees", "linked worktrees of this repository"),
    ("fork_of", "out"): ("upstream", "the repository this was forked from"),
    ("fork_of", "in"): ("forks", "forge fork list"),
    ("shares_history_with", "out"): ("shares history with", "merge-base probe"),
    ("shares_history_with", "in"): ("shares history with", "merge-base probe"),
    ("candidate_same_as", "out"): ("identity candidates", "containment heuristic"),
    ("candidate_same_as", "in"): ("identity candidates", "containment heuristic"),
    ("same_annex_uuid", "out"): ("same annex UUID", "annex uuid.log collision"),
    ("same_annex_uuid", "in"): ("same annex UUID", "annex uuid.log collision"),
    ("host_scan", "out"): ("repositories on this host", "filesystem / forge scan for repos not seen yet"),
}


def _load_scenarios() -> dict:
    out = {}
    for name in SCENARIOS:
        path = os.path.join(SCENARIO_DIR, name, "worldmap.json")
        with open(path, "r", encoding="utf-8") as fh:
            doc = json.load(fh)
        doc["_nodes_by_id"] = {n["id"]: n for n in doc["nodes"]}
        doc["_edges_by_id"] = {e["id"]: e for e in doc["edges"]}
        # incident index: node id -> list of (edge, direction)
        inc: dict[str, list] = {}
        for e in doc["edges"]:
            inc.setdefault(e["source"], []).append((e, "out"))
            inc.setdefault(e["target"], []).append((e, "in"))
        doc["_incident"] = inc
        out[name] = doc
    return out


DATA = _load_scenarios()


def ancestors(doc, node_id):
    """Containment chain of a node, outermost last."""
    chain = []
    cur = doc["_nodes_by_id"].get(node_id)
    seen = set()
    while cur is not None:
        pid = cur.get("parent")
        if not pid or pid in seen:
            break
        seen.add(pid)
        parent = doc["_nodes_by_id"].get(pid)
        if parent is None:
            break
        chain.append(parent)
        cur = parent
    return chain


def public_node(n):
    return {k: v for k, v in n.items() if not k.startswith("_")}


def frontier(doc, known_nodes: set, known_edges: set) -> dict:
    """For every known node, what is still hidden behind it, per relation.

    `hidden` counts *unprobed edges*, not unknown nodes: in s1 several clones point
    at peers we already know about under a different remote name, and those edges are
    exactly the interesting ones, so they must still be counted as "not yet seen".
    """
    out = {}
    for nid in known_nodes:
        buckets = {}
        for edge, direction in doc["_incident"].get(nid, []):
            other = edge["target"] if direction == "out" else edge["source"]
            key = f"{edge['kind']}:{direction}"
            b = buckets.setdefault(key, {"count": 0, "hidden": 0, "new_nodes": set()})
            b["count"] += 1
            if edge["id"] not in known_edges:
                b["hidden"] += 1
                if other not in known_nodes:
                    b["new_nodes"].add(other)
        # Synthetic relation: "rescan this container for things we have not seen".
        # This is what a real walker does (find / -name .git, or a forge repo list),
        # and it is the only way to reach a component the seed does not link to.
        contained = [
            n for n in doc["nodes"] if n.get("parent") == nid and n["id"] not in known_nodes
        ]
        if contained:
            buckets["host_scan:out"] = {
                "count": len([n for n in doc["nodes"] if n.get("parent") == nid]),
                "hidden": len(contained),
                "new_nodes": set(n["id"] for n in contained),
            }

        rels = []
        total_hidden = 0
        for key, b in sorted(buckets.items()):
            kind, direction = key.split(":")
            label, probe = RELATION_LABELS.get((kind, direction), (kind, kind))
            rels.append(
                {
                    "key": key,
                    "kind": kind,
                    "dir": direction,
                    "label": label,
                    "probe": probe,
                    "count": b["count"],
                    "hidden": b["hidden"],
                    "new_nodes": len(b["new_nodes"]),
                }
            )
            total_hidden += b["hidden"]
        if rels:
            out[nid] = {"hidden": total_hidden, "relations": rels}
    return out


def reveal(doc, seeds, known_nodes: set, known_edges: set, kinds=None):
    """Reveal `seeds` (node ids) plus their containment ancestors.

    Returns (new_nodes, new_edges) as public dicts.
    """
    new_nodes = []
    for sid in seeds:
        node = doc["_nodes_by_id"].get(sid)
        if node is None or sid in known_nodes:
            continue
        known_nodes.add(sid)
        new_nodes.append(node)
        for anc in ancestors(doc, sid):
            if anc["id"] not in known_nodes:
                known_nodes.add(anc["id"])
                new_nodes.append(anc)
    # ancestors of the seeds themselves, when the seed was already known
    for sid in seeds:
        for anc in ancestors(doc, sid):
            if anc["id"] not in known_nodes:
                known_nodes.add(anc["id"])
                new_nodes.append(anc)
    new_edges = []
    if kinds is not None:
        for eid, e in doc["_edges_by_id"].items():
            if eid in known_edges:
                continue
            if e["id"] not in kinds:
                continue
            known_edges.add(eid)
            new_edges.append(e)
    return [public_node(n) for n in new_nodes], new_edges


def seed_payload(scenario):
    doc = DATA[scenario]
    seeds = [n["id"] for n in doc["nodes"] if n.get("is_seed")]
    known_nodes: set = set()
    known_edges: set = set()
    nodes, _ = reveal(doc, seeds, known_nodes, known_edges)
    return {
        "scenario": scenario,
        "title": doc["title"],
        "subtitle": doc.get("subtitle", ""),
        "exercises": doc.get("exercises", []),
        "stats": doc.get("stats", {}),
        "findings": doc.get("findings", []),
        "seed_ids": seeds,
        "nodes": nodes,
        "edges": [],
        "frontier": frontier(doc, known_nodes, known_edges),
        "total_nodes": len(doc["nodes"]),
        "total_edges": len(doc["edges"]),
    }


def expand_payload(scenario, node_id, relation, known_nodes, known_edges):
    doc = DATA[scenario]
    if node_id not in doc["_nodes_by_id"]:
        raise KeyError(node_id)
    try:
        kind, direction = relation.split(":")
    except ValueError:
        raise KeyError(relation)

    known_nodes = set(known_nodes)
    known_edges = set(known_edges)
    if known_nodes and node_id not in known_nodes:
        raise KeyError("cannot probe a node that has not been discovered: %s" % node_id)

    if kind == "host_scan":
        targets = [n["id"] for n in doc["nodes"] if n.get("parent") == node_id]
        new_nodes, new_edges = reveal(doc, targets, known_nodes, known_edges, kinds=set())
        # any edge whose two endpoints are now both known and which touches one of
        # the freshly scanned repos is implied knowledge
        fresh = {n["id"] for n in new_nodes}
        for e in doc["edges"]:
            if e["id"] in known_edges:
                continue
            if e["source"] in known_nodes and e["target"] in known_nodes:
                if e["source"] in fresh or e["target"] in fresh:
                    known_edges.add(e["id"])
                    new_edges.append(e)
        return {
            "scenario": scenario,
            "node_id": node_id,
            "relation": relation,
            "nodes": new_nodes,
            "edges": new_edges,
            "frontier": frontier(doc, known_nodes, known_edges),
        }

    matching = [
        e
        for e, d in doc["_incident"].get(node_id, [])
        if e["kind"] == kind and d == direction
    ]
    targets = [
        (e["target"] if direction == "out" else e["source"]) for e in matching
    ]
    edge_ids = {e["id"] for e in matching}
    new_nodes, new_edges = reveal(doc, targets, known_nodes, known_edges, kinds=edge_ids)

    # Once both endpoints of an edge of the *same* kind are known, that edge is
    # implied knowledge (we probed one side and can see the other) - reveal it too,
    # but only for the relation we just probed. This is what makes the s1 mesh
    # ("everybody calls rolando `origin`") actually appear.
    for e in doc["edges"]:
        if e["id"] in known_edges:
            continue
        if e["kind"] != kind:
            continue
        if e["source"] in known_nodes and e["target"] in known_nodes:
            if e["source"] == node_id or e["target"] == node_id:
                known_edges.add(e["id"])
                new_edges.append(e)

    return {
        "scenario": scenario,
        "node_id": node_id,
        "relation": relation,
        "nodes": new_nodes,
        "edges": new_edges,
        "frontier": frontier(doc, known_nodes, known_edges),
    }


class Handler(BaseHTTPRequestHandler):
    server_version = "TeamAWorldmap/0.1"
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):  # quieter log
        sys.stderr.write("[server] %s\n" % (fmt % args))

    # -- helpers ---------------------------------------------------------
    def _send_json(self, obj, status=200):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _send_bytes(self, body, ctype):
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _404(self, msg="not found"):
        self._send_json({"error": msg}, status=404)

    # -- routes ----------------------------------------------------------
    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/api/health":
            return self._send_json({"ok": True, "scenarios": list(SCENARIOS)})
        if path == "/api/scenarios":
            return self._send_json(
                [
                    {
                        "id": s,
                        "title": DATA[s]["title"],
                        "subtitle": DATA[s].get("subtitle", ""),
                        "exercises": DATA[s].get("exercises", []),
                        "stats": DATA[s].get("stats", {}),
                    }
                    for s in SCENARIOS
                ]
            )
        parts = [p for p in path.split("/") if p]
        if len(parts) == 4 and parts[0] == "api" and parts[1] == "scenario":
            sid, verb = parts[2], parts[3]
            if sid not in DATA:
                return self._404("unknown scenario %s" % sid)
            if verb == "seed":
                return self._send_json(seed_payload(sid))
            if verb == "full":
                # Used only by the benchmark harness / "reveal everything" debug button.
                doc = DATA[sid]
                return self._send_json(
                    {
                        "scenario": sid,
                        "nodes": [public_node(n) for n in doc["nodes"]],
                        "edges": doc["edges"],
                        "findings": doc.get("findings", []),
                    }
                )
            return self._404("unknown verb %s" % verb)
        return self._serve_static(path)

    def do_POST(self):
        path = urlparse(self.path).path
        if path != "/api/expand":
            return self._404()
        try:
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length) or b"{}")
        except Exception as exc:  # noqa: BLE001
            return self._send_json({"error": "bad json: %s" % exc}, status=400)

        scenario = payload.get("scenario")
        node_id = payload.get("node_id")
        relation = payload.get("relation")
        if scenario not in DATA:
            return self._send_json({"error": "unknown scenario"}, status=400)

        # The probe. 300-900 ms, as if we were ssh-ing somewhere.
        delay = random.uniform(LATENCY_MIN, LATENCY_MAX)
        t0 = time.time()
        time.sleep(delay)

        try:
            out = expand_payload(
                scenario,
                node_id,
                relation,
                payload.get("known_nodes") or [],
                payload.get("known_edges") or [],
            )
        except KeyError as exc:
            return self._send_json({"error": "unknown node/relation %s" % exc}, status=400)
        out["latency_ms"] = round((time.time() - t0) * 1000)
        return self._send_json(out)

    # -- static ----------------------------------------------------------
    def _serve_static(self, path):
        if path in ("/", ""):
            path = "/index.html"
        rel = posixpath.normpath(path).lstrip("/")
        target = os.path.join(WEB_DIST, rel)
        if not os.path.abspath(target).startswith(os.path.abspath(WEB_DIST)):
            return self._404("nope")
        if not os.path.isfile(target):
            index = os.path.join(WEB_DIST, "index.html")
            if os.path.isfile(index):
                target = index
            else:
                return self._404(
                    "web/dist not built - run `npm --prefix web run build` first"
                )
        ctype, _ = mimetypes.guess_type(target)
        with open(target, "rb") as fh:
            body = fh.read()
        return self._send_bytes(body, ctype or "application/octet-stream")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8848)
    args = ap.parse_args()
    srv = ThreadingHTTPServer((args.host, args.port), Handler)
    srv.daemon_threads = True
    print(
        "worldmap server on http://%s:%d  (scenarios: %s)"
        % (args.host, args.port, ", ".join(SCENARIOS)),
        flush=True,
    )
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
