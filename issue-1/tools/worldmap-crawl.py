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
import argparse, hashlib, json, os, posixpath, re, subprocess, sys, time
from pathlib import Path
from urllib.parse import urlparse

T0 = int(time.time())


def tool_version():
    """`git describe --always --dirty` of the checkout this script lives in,
    so a produced map names the exact tooling that made it."""
    here = os.path.dirname(os.path.abspath(__file__))
    try:
        p = subprocess.run(["git", "-C", here, "describe", "--always", "--dirty", "--tags"],
                           capture_output=True, text=True, timeout=5)
        return p.stdout.strip() or "unknown"
    except Exception:
        return "unknown"


def annex_sizes(repo):
    """Per-repository annexed byte totals, straight from git-annex.

    `git annex info` reports "the annex sizes of each repository" and, since
    10.20240831, uses maintained repository-size tracking rather than
    recomputing. `--show=` skips the work we do not need. We do NOT sum
    `-s<bytes>` out of key names ourselves: that reimplements, from a staler
    source, something git-annex already does properly.

    Returns {uuid_or_description: bytes}. Empty when git-annex is absent.
    """
    out = git(repo, "annex", "info", "--json", "--bytes", "--fast",
              "--show=annex sizes of repositories", timeout=60)
    if not out:
        return {}
    sizes = {}
    for line in out.splitlines():
        try:
            rec = json.loads(line)
        except ValueError:
            continue
        block = rec.get("annex sizes of repositories") or rec.get("repository sizes") or {}
        if isinstance(block, dict):
            for k, v in block.items():
                try:
                    sizes[k] = int(str(v).split()[0])
                except (ValueError, IndexError):
                    pass
    return sizes


def annex_version():
    try:
        p = subprocess.run(["git", "annex", "version", "--raw"],
                           capture_output=True, text=True, timeout=5)
        return p.stdout.strip() or None
    except Exception:
        return None

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

def submodule_target(smurl, info):
    """Where a submodule URL points, by git's own rule: a RELATIVE url
    resolves against the superproject's default remote url (origin, else any
    remote), and only against the superproject's path when it has no remote
    at all. Resolving against the local path -- the obvious shortcut -- sends
    a clone's declared subdatasets to paths that never existed."""
    if not smurl or "://" in smurl or SCP_RE.match(smurl) or os.path.isabs(smurl):
        return canon_url(smurl, base=info["root"])
    base = (info["remotes"].get("origin")
            or next(iter(info["remotes"].values()), None) or info["root"])
    if "://" in base or SCP_RE.match(base):
        bk, bh, bp, _ = canon_url(base)
        joined = posixpath.normpath(posixpath.join(bp or "/", smurl))
        if not joined.startswith("/"):
            joined = "/" + joined
        return canon_url(f"{bk}://{bh}{joined}")
    return canon_url(smurl, base=base)

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
    # Read url AND path per submodule. The path is what identifies the
    # subdataset within the super (and where its checkout lives); the name is
    # just the config key and may differ (datalad's "sub _1"). Slicing off the
    # fixed prefix/suffix keeps names containing dots intact.
    sm_cfg = {}
    for suffix in ("url", "path"):
        # -z: NUL-separated entries with key and value split by a newline --
        # the only form that survives submodule names containing spaces
        # (datalad's testrepo_gh has "sub _1"; the old first-space partition
        # produced garbage nodes for it)
        txt = git(repo, "config", "-z", "-f", ".gitmodules",
                  "--get-regexp", rf'^submodule\..*\.{suffix}$') or ""
        for entry in txt.split("\0"):
            if not entry:
                continue
            k, _, v = entry.partition("\n")
            name = k[len("submodule."):-(len(suffix) + 1)]
            sm_cfg.setdefault(name, {})[suffix] = v
    for name, cfg in sm_cfg.items():
        info["submodules"].append({"name": name, "url": cfg.get("url", ""),
                                   "path": cfg.get("path") or name})
    info["annex"] = annex_logs(repo)
    info["annex_sizes"] = annex_sizes(repo)
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

# Hosts that cannot carry annexed content over plain git. This is an
# ASSUMPTION, deliberately short and overridable, and it is recorded on the
# node as `annex_incapable_assumed` so the UI can render it differently from an
# observed `annex-ignore`. A git-lfs special remote to the same host CAN carry
# content -- annex-capability is a property of the route, not the host -- so
# this is never applied to a host node, only to a plain-git distribution.
ANNEX_INCAPABLE_FORGES = {"github.com", "gitlab.com", "bitbucket.org"}


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

    seen_edges = set()

    def add_edge(src, dst, kind, **kw):
        # `git worktree list` reports EVERY worktree whichever one you run it
        # in, so crawling N worktrees naively emits N*N worktree_of edges --
        # the green hairball. Identity of an edge is (src, dst, kind, name).
        key = (src, dst, kind, kw.get("remote_name"))
        if key in seen_edges:
            return None
        seen_edges.add(key)
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
            if (kind in ("https", "http", "ssh", "git")
                    and host in ANNEX_INCAPABLE_FORGES
                    and not (extra or {}).get("special_remote_type")):
                nodes[nid]["annex_incapable_assumed"] = True
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
        sizes = info.get("annex_sizes") or {}
        if sizes:
            n["annex_sizes_source"] = "git annex info"
            own = sizes.get(info.get("annex_uuid"))
            if own is not None:
                n["annex_bytes"] = own
        if d == 0:
            n["is_seed"] = True

        # Linked worktrees share .git/config with the main worktree, so every
        # one of them reports the SAME remotes. Emitting them per worktree
        # multiplies the map by the worktree count (20 worktrees x 59 remotes =
        # 1180 identical arrows) and says something untrue: the remotes belong
        # to the repository, not to each checkout of it. Emit them once, from
        # the main worktree; a linked worktree is joined to it by worktree_of.
        _wts = info["worktrees"]
        _main_wt = os.path.realpath(_wts[0]["path"]) if _wts else info["root"]
        # A submodule's git dir is absorbed into the super's .git/modules/, and
        # `git worktree list` reports THAT path as the main worktree. A repo
        # whose "main worktree" is its own git dir is its own main worktree --
        # without this, every submodule checkout looked like a linked worktree
        # of a phantom repository living inside .git.
        if _main_wt == os.path.realpath(info["gitdir"]):
            _main_wt = info["root"]
        is_linked = _main_wt != info["root"]
        n["is_linked_worktree"] = is_linked
        if is_linked:
            n["remotes_via"] = "main worktree"

        # --- remotes, the core edges, carrying the per-clone remote NAME
        for rname, rurl in ({} if is_linked else info["remotes"]).items():
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
            # Which branches actually TRACK this remote, and is one of them the
            # branch checked out here? A remote nobody tracks is configuration;
            # a remote the current branch tracks is what you are working with.
            # Kept as a list rather than a flag because each worktree has its
            # own HEAD, so "current" is a question about a node, not the edge.
            tracked_by = sorted(bn for bn, cfg in info["tracking"].items()
                                if cfg.get("remote") == rname)
            head = info.get("head")
            tracking = ("current" if head and head in tracked_by
                        else "branch" if tracked_by else "none")
            add_edge(nid, tid, "remote", remote_name=rname, ahead=a, behind=b,
                     resolution="resolved" if (a is not None or nodes[tid].get("probed"))
                                 else "url-only", url=rurl,
                     tracked_by=tracked_by, tracking=tracking)
            # annex trust for this remote, if the annex branch knows it
            ig = git(path, "config", "--get", f"remote.{rname}.annex-ignore")
            if ig and ig.lower() in ("true", "yes", "1"):
                edges[-1]["annex_ignore"] = True
                nodes[tid]["annex_ignored_by"] = nodes[tid].get("annex_ignored_by", 0) + 1
            pu = git(path, "config", "--get", f"remote.{rname}.pushurl")
            if pu:
                edges[-1]["pushurl"] = pu
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
            # git-annex descriptions are conventionally "user@host:/path", so
            # the host is recoverable and the clone can be clustered properly
            # instead of piling up under "unknown".
            ahost, apath = None, ""
            m = re.match(r'^(?:(?P<user>[^@\s]+)@)?(?P<host>[A-Za-z0-9._-]+):(?P<path>\S+)$',
                         (desc or "").strip())
            if m:
                ahost, apath = m.group("host"), m.group("path")
            tid = placeholder(canon, "annex", ahost, apath,
                              {"label": desc or u[:8], "annex_uuid": u,
                               "annex_mode": "keystore", "vcs": "git",
                               "layout": "bare" if apath.endswith(".git") else "worktree",
                               "from_annex_branch": True})
            nodes[tid].setdefault("annex_uuid", u)
            by_annex_uuid.setdefault(u, []).append(tid)
            sz = (info.get("annex_sizes") or {}).get(u)
            if sz is None:
                sz = (info.get("annex_sizes") or {}).get(desc)
            if sz is not None:
                nodes[tid]["annex_bytes"] = sz
                nodes[tid]["annex_sizes_source"] = "git annex info"
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
        # The first entry of `git worktree list` is the MAIN worktree; the rest
        # are linked to it. Every worktree reports the same list, so anchor the
        # edges on the main one and they are identical whoever observed them --
        # which, with the dedupe above, yields exactly N-1 edges for N
        # worktrees instead of N*N.
        wts = _wts
        main_wt = _main_wt
        main_id = (nid if main_wt == info["root"]
                   else placeholder(f"file://{main_wt}", "local", "localhost", main_wt))
        for w in wts:
            wp = os.path.realpath(w["path"])
            if wp == main_wt or wp == os.path.realpath(info["gitdir"]):
                continue
            wid = placeholder(f"file://{wp}", "local", "localhost", wp,
                              {"layout": "linked-worktree", "branch": w.get("branch")})
            add_edge(wid, main_id, "worktree_of", remote_name=None)
            if d < depth:
                queue.append((wp, d + 1))
        # A subdataset is the CHECKOUT at <super>/<path>, not its .gitmodules
        # URL. The old code made the URL target the subdataset node, which (a)
        # labelled it by URL, (b) claimed the upstream lives INSIDE the super,
        # and (c) with several worktrees each declaring the same URL, let the
        # last writer win the parent -- so a worktree's subdataset arrow
        # pointed at the original checkout instead of into its own box.
        for sm in info["submodules"]:
            smpath = sm.get("path") or sm["name"]
            checkout = os.path.realpath(os.path.join(info["root"], smpath))
            if os.path.exists(os.path.join(checkout, ".git")):
                # initialized: a real repository on disk, contained in THIS
                # checkout (each worktree has its own), crawled like one
                cid = placeholder(f"file://{checkout}", "local", "localhost", checkout)
                nodes[cid]["parent"] = nid
                add_edge(nid, cid, "subdataset", remote_name=None, path=smpath)
                if d < depth:
                    queue.append((checkout, d + 1))
            elif not is_linked:
                # declared but never checked out: the URL target is all there
                # is. No containment -- an upstream is not inside the super.
                # Linked worktrees share .gitmodules, so the declaration is a
                # repository-level fact emitted once from the main worktree.
                k2, h2, pp2, canon = submodule_target(sm["url"], info)
                sid = placeholder(canon, k2, h2, pp2)
                add_edge(nid, sid, "subdataset", remote_name=None, path=smpath,
                         state="not-initialized")

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
        "generator": "worldmap-crawl.py",
        "tool_version": tool_version(),
        "git_version": (git(".", "--version") or "").replace("git version ", "") or None,
        "git_annex_version": annex_version(),
        "crawled_at": T0,
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
