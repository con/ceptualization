#!/usr/bin/env python3
"""Crawl real git / git-annex repositories into a worldmap.json.

Emits the same schema as issue-1/scenarios/*/worldmap.json, so the output can
be explored with any of the bake-off prototypes.

Design follows issue-1/README.md finding 2: most of the map is readable
without ssh and without git-annex installed, because the `git-annex` branch
carries uuid.log / remote.log / trust.log and plain `git cat-file` can read it.

Offline by default. --ls-remote enables one network round trip per remote.

  ./worldmap-crawl.py ~/proj/foo -o /tmp/wm/my-repo
  ./worldmap-crawl.py ~/datasets/* --depth 2 -o /tmp/wm/datasets --ls-remote
"""
from __future__ import annotations
import argparse, hashlib, json, os, re, subprocess, sys, time
from pathlib import Path
from urllib.parse import urlparse

T0 = int(time.time())

def git(repo, *args, timeout=20):
    try:
        p = subprocess.run(["git", "-C", str(repo), *args], capture_output=True,
                           text=True, timeout=timeout)
        return p.stdout.strip() if p.returncode == 0 else None
    except (subprocess.TimeoutExpired, OSError):
        return None

# ---------------------------------------------------------------- URL handling
SCP_RE = re.compile(r'^(?P<user>[^@/]+)@(?P<host>[^:/]+):(?P<path>.+)$')

def canon_url(url, base=None):
    """Canonicalise a remote URL. Returns (kind, host, path, canonical)."""
    if url is None:
        return ("unknown", None, None, None)
    u = url.strip()
    m = SCP_RE.match(u)
    if m and "://" not in u:                       # git@host:path
        host, path = m.group("host"), m.group("path")
        path = re.sub(r'\.git$', '', path)
        return ("ssh", host, path, f"ssh://{host}/{path}")
    if "://" in u:
        p = urlparse(u)
        host = p.hostname or ""
        path = re.sub(r'\.git$', '', p.path or "")
        if p.scheme in ("file",):
            rp = os.path.realpath(path)
            return ("local", "localhost", rp, f"file://{rp}")
        return (p.scheme, host, path, f"{p.scheme}://{host}{path}")
    # bare filesystem path
    cand = u if os.path.isabs(u) else os.path.normpath(os.path.join(base or ".", u))
    rp = os.path.realpath(cand)
    return ("local", "localhost", rp, f"file://{rp}")

def node_id(canonical):
    return "d:" + hashlib.sha1((canonical or "?").encode()).hexdigest()[:12]

def short(canonical, kind, host, path):
    if kind == "local":
        home = os.path.expanduser("~")
        return (path.replace(home, "~") if path.startswith(home) else path)
    return f"{host}{path}"

# ---------------------------------------------------------------- annex branch
def annex_logs(repo):
    """Read uuid.log / remote.log / trust.log straight out of the git-annex
    branch. Needs plain git only -- git-annex need not be installed."""
    out = {"uuid": {}, "remote": {}, "trust": {}}
    if git(repo, "rev-parse", "--verify", "-q", "git-annex") is None:
        for ref in ("refs/remotes/origin/git-annex", "refs/remotes/*/git-annex"):
            if git(repo, "rev-parse", "--verify", "-q", ref) is not None:
                base = ref
                break
        else:
            return out
    else:
        base = "git-annex"
    txt = git(repo, "cat-file", "-p", f"{base}:uuid.log")
    if txt:
        for line in txt.splitlines():
            parts = line.split(" ", 1)
            if len(parts) == 2:
                desc = re.sub(r'\s*timestamp=\S+\s*$', '', parts[1]).strip()
                out["uuid"][parts[0]] = desc
    txt = git(repo, "cat-file", "-p", f"{base}:remote.log")
    if txt:
        for line in txt.splitlines():
            parts = line.split(" ", 1)
            if len(parts) == 2:
                cfg = dict(kv.split("=", 1) for kv in parts[1].split()
                           if "=" in kv and not kv.startswith("timestamp="))
                out["remote"][parts[0]] = cfg
    txt = git(repo, "cat-file", "-p", f"{base}:trust.log")
    if txt:
        for line in txt.splitlines():
            f = line.split()
            if len(f) >= 2:
                out["trust"][f[0]] = {"1": "trusted", "0": "untrusted",
                                      "X": "dead", "?": "semitrusted"}.get(f[1], f[1])
    return out

# ---------------------------------------------------------------- one repo
def inspect(repo):
    top = git(repo, "rev-parse", "--show-toplevel")
    gitdir = git(repo, "rev-parse", "--absolute-git-dir")
    if gitdir is None:
        return None
    bare = git(repo, "rev-parse", "--is-bare-repository") == "true"
    inside_wt = git(repo, "rev-parse", "--is-inside-work-tree") == "true"
    root = os.path.realpath(top or gitdir)
    info = {
        "root": root, "gitdir": gitdir, "bare": bare,
        "layout": "bare" if bare else ("linked-worktree"
                  if os.path.basename(os.path.dirname(gitdir)) == "worktrees"
                  else "worktree"),
        "head": git(repo, "symbolic-ref", "--short", "-q", "HEAD"),
        "annex_uuid": git(repo, "config", "--get", "annex.uuid"),
        "remotes": {}, "worktrees": [], "submodules": [], "tracking": {},
    }
    # dataset id, read from the tree so it works on bare repos too
    for ref in ("HEAD", "refs/heads/main", "refs/heads/master"):
        cfg = git(repo, "cat-file", "-p", f"{ref}:.datalad/config")
        if cfg:
            m = re.search(r'^\s*id\s*=\s*(\S+)', cfg, re.M)
            if m:
                info["dataset_id"] = m.group(1)
            break
    cfg = git(repo, "config", "--get-regexp", r'^remote\..*\.url') or ""
    for line in cfg.splitlines():
        k, _, v = line.partition(" ")
        name = k[len("remote."):-len(".url")]
        info["remotes"][name] = v
    trk = git(repo, "config", "--get-regexp", r'^branch\..*\.(remote|merge)') or ""
    for line in trk.splitlines():
        k, _, v = line.partition(" ")
        parts = k.split(".")
        if len(parts) >= 3:
            info["tracking"].setdefault(".".join(parts[1:-1]), {})[parts[-1]] = v
    wt = git(repo, "worktree", "list", "--porcelain") or ""
    cur = {}
    for line in wt.splitlines():
        if line.startswith("worktree "):
            if cur: info["worktrees"].append(cur)
            cur = {"path": line.split(" ", 1)[1]}
        elif line.startswith("branch "):
            cur["branch"] = line.split(" ", 1)[1].replace("refs/heads/", "")
        elif line.startswith("bare"):
            cur["bare"] = True
    if cur: info["worktrees"].append(cur)
    sm = git(repo, "config", "-f", ".gitmodules", "--get-regexp", r'^submodule\..*\.url') or ""
    for line in sm.splitlines():
        k, _, v = line.partition(" ")
        info["submodules"].append({"name": k.split(".")[1], "url": v})
    info["annex"] = annex_logs(repo)
    return info

def ahead_behind(repo, local_ref, remote_ref):
    out = git(repo, "rev-list", "--left-right", "--count", f"{local_ref}...{remote_ref}")
    if not out:
        return (None, None)
    try:
        a, b = out.split()
        return (int(a), int(b))
    except ValueError:
        return (None, None)

# ---------------------------------------------------------------- crawl
def crawl(seeds, depth, use_ls_remote, name):
    nodes, edges, findings = {}, [], []
    hosts, seen, queue = {}, set(), []
    by_annex_uuid = {}
    n_edge = [0]

    def host_node(hid, label, kind="host"):
        if hid not in hosts:
            hosts[hid] = {"id": hid, "type": "host", "label": label, "host_kind": kind}
            nodes[hid] = hosts[hid]
        return hid

    def add_edge(src, dst, kind, **kw):
        n_edge[0] += 1
        e = {"id": f"e{n_edge[0]}", "source": src, "target": dst, "kind": kind,
             "observed_at": T0, "via": "localhost"}
        e.update(kw); edges.append(e); return e

    def placeholder(canonical, kind, host, path, extra=None):
        nid = node_id(canonical)
        if nid not in nodes:
            hid = host_node(f"h:{host or 'unknown'}", host or "unknown",
                            "forge" if host in ("github.com", "gitlab.com", "codeberg.org")
                            else ("host" if kind in ("ssh", "local") else "web"))
            nodes[nid] = {"id": nid, "type": "distribution",
                          "label": short(canonical, kind, host, path),
                          "on_host": hid, "parent": hid, "vcs": "git",
                          "layout": "bare" if kind != "local" else "worktree",
                          "annex_mode": "none", "packaging": [], "url": canonical,
                          "expanded": False, "observed_at": T0, "via": "localhost",
                          "probed": False}
            if extra: nodes[nid].update(extra)
        return nid

    for s in seeds:
        queue.append((os.path.realpath(s), 0))

    while queue:
        path, d = queue.pop(0)
        if path in seen:
            continue
        seen.add(path)
        info = inspect(path)
        if info is None:
            print(f"  ! not a git repository: {path}", file=sys.stderr)
            continue
        canonical = f"file://{info['root']}"
        kind, host, p, _ = ("local", "localhost", info["root"], canonical)
        nid = placeholder(canonical, kind, host, p)
        n = nodes[nid]
        n.update({"probed": True, "expanded": True, "layout": info["layout"],
                  "branch": info["head"]})
        if info.get("dataset_id"):
            n["dataset_id"] = info["dataset_id"]
        if info.get("annex_uuid"):
            n["annex_uuid"] = info["annex_uuid"]
            n["annex_mode"] = "keystore"
            by_annex_uuid.setdefault(info["annex_uuid"], []).append(nid)
        if d == 0:
            n["is_seed"] = True

        # --- remotes, the core edges, carrying the per-clone remote NAME
        for rname, rurl in info["remotes"].items():
            k, h, pp, canon = canon_url(rurl, base=info["root"])
            tid = placeholder(canon, k, h, pp)
            a, b = (None, None)
            rref = f"refs/remotes/{rname}/{info['head']}" if info["head"] else None
            if rref and git(path, "rev-parse", "--verify", "-q", rref) is not None:
                a, b = ahead_behind(path, "HEAD", rref)
            elif use_ls_remote:
                ls = git(path, "ls-remote", "--heads", rurl, timeout=25)
                if ls is None:
                    nodes[tid]["unreachable"] = True
            add_edge(nid, tid, "remote", remote_name=rname, ahead=a, behind=b,
                     resolution="resolved" if (a is not None or nodes[tid].get("probed"))
                                 else "url-only", url=rurl)
            # annex trust for this remote, if the annex branch knows it
            ru = git(path, "config", "--get", f"remote.{rname}.annex-uuid")
            if ru:
                nodes[tid]["annex_uuid"] = ru
                nodes[tid]["annex_mode"] = "keystore"
                by_annex_uuid.setdefault(ru, []).append(tid)
                t = info["annex"]["trust"].get(ru)
                if t:
                    nodes[tid]["trust"] = t
            if k == "local" and d < depth and os.path.isdir(pp):
                queue.append((pp, d + 1))

        # --- what the annex branch knows about clones we have never visited
        for u, desc in info["annex"]["uuid"].items():
            if u == info.get("annex_uuid"):
                continue
            canon = f"annex-uuid://{u}"
            tid = placeholder(canon, "annex", None, "",
                              {"label": desc or u[:8], "annex_uuid": u,
                               "annex_mode": "keystore", "vcs": "git",
                               "from_annex_branch": True})
            nodes[tid].setdefault("annex_uuid", u)
            by_annex_uuid.setdefault(u, []).append(tid)
            cfg = info["annex"]["remote"].get(u)
            if cfg:
                nodes[tid].update({
                    "vcs": "none", "special_remote_type": cfg.get("type"),
                    "annex_mode": "exporttree" if cfg.get("exporttree") == "yes"
                                  else ("importtree" if cfg.get("importtree") == "yes"
                                        else "keystore"),
                    "layout": "export-tree" if cfg.get("exporttree") == "yes" else "archive",
                    "packaging": [f"encryption:{cfg.get('encryption','none')}"],
                    "label": cfg.get("name", nodes[tid]["label"])})
            t = info["annex"]["trust"].get(u)
            if t:
                nodes[tid]["trust"] = t
            if not any(e["source"] == nid and e["target"] == tid for e in edges):
                add_edge(nid, tid, "annex_knows", remote_name=None,
                         resolution="from-annex-branch")

        # --- worktrees and submodules
        for w in info["worktrees"]:
            wp = os.path.realpath(w["path"])
            if wp == info["root"]:
                continue
            wid = placeholder(f"file://{wp}", "local", "localhost", wp,
                              {"layout": "linked-worktree", "branch": w.get("branch")})
            add_edge(wid, nid, "worktree_of", remote_name=None)
            if d < depth:
                queue.append((wp, d + 1))
        for sm in info["submodules"]:
            k, h, pp, canon = canon_url(sm["url"], base=info["root"])
            sid = placeholder(canon, k, h, pp)
            nodes[sid]["parent"] = nid          # containment: submodule inside super
            add_edge(nid, sid, "subdataset", remote_name=None, path=sm["name"])

    # --- findings
    for u, ids in by_annex_uuid.items():
        real = [i for i in set(ids) if nodes[i].get("probed")]
        if len(real) > 1:
            findings.append({"severity": "error", "code": "duplicate-annex-uuid",
                             "message": f"{len(real)} distributions declare annex UUID "
                                        f"{u[:8]}… — a hard copy violates git-annex's model.",
                             "nodes": real})
    for nid, n in nodes.items():
        if n.get("trust") == "dead":
            findings.append({"severity": "warning", "code": "dead-remote",
                             "message": f"{n['label']} is marked dead in trust.log.",
                             "nodes": [nid]})
        if n.get("unreachable"):
            findings.append({"severity": "warning", "code": "unreachable",
                             "message": f"{n['label']} did not answer ls-remote.",
                             "nodes": [nid]})
    for e in edges:
        if e.get("behind"):
            findings.append({"severity": "info", "code": "behind",
                             "message": f"{nodes[e['source']]['label']} is {e['behind']} "
                                        f"commits behind '{e.get('remote_name')}'.",
                             "nodes": [e["source"]]})

    probed = sum(1 for n in nodes.values() if n.get("probed"))
    return {
        "scenario": name,
        "title": f"{name} — crawled from disk",
        "subtitle": f"{probed} repositories probed, "
                    f"{len(nodes) - len(hosts) - probed} known but unvisited, "
                    f"{len(hosts)} hosts.",
        "exercises": ["real remotes with their per-clone names",
                      "clones known only through the git-annex branch",
                      "worktrees, submodules, ahead/behind from local refs"],
        "generated_from": "worldmap-crawl.py",
        "nodes": list(nodes.values()), "edges": edges, "findings": findings,
        "stats": {"nodes": len(nodes), "edges": len(edges), "hosts": len(hosts),
                  "probed": probed, "findings": len(findings)},
    }

def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("repos", nargs="+", help="repository paths to crawl")
    ap.add_argument("-o", "--out", required=True,
                    help="output directory; worldmap.json is written inside it")
    ap.add_argument("--name", help="scenario name (default: output dir name)")
    ap.add_argument("--depth", type=int, default=1,
                    help="how far to follow local (file:// or path) remotes (default 1)")
    ap.add_argument("--ls-remote", action="store_true",
                    help="allow one network round trip per unresolved remote")
    a = ap.parse_args()
    out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
    name = a.name or out.name
    doc = crawl(a.repos, a.depth, a.ls_remote, name)
    (out / "worldmap.json").write_text(json.dumps(doc, indent=1))
    s = doc["stats"]
    print(f"{out/'worldmap.json'}\n  {s['nodes']} nodes ({s['probed']} probed), "
          f"{s['edges']} edges, {s['hosts']} hosts, {s['findings']} findings")

if __name__ == "__main__":
    main()
