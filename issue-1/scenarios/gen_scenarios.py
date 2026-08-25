"""Generate worldmap fixtures for the three git/git-annex exploration scenarios.

Emits, per scenario:  <out>/<id>/worldmap.json   -- the crawled graph
Model follows issue-1/distribution-modeling-and-repo-identity.md:
Distribution(vcs, layout, annex_mode, packaging) + RemoteLink edges carrying
the per-clone remote name, plus Observation-style provenance on every fact.
"""
import json, hashlib, pathlib, sys

OUT = pathlib.Path(sys.argv[1])
T0 = 1755000000  # fixed epoch; no wallclock, fixtures must be reproducible

def uuid_for(s):
    h = hashlib.sha1(s.encode()).hexdigest()
    return f"{h[:8]}-{h[8:12]}-4{h[13:16]}-a{h[17:20]}-{h[20:32]}"

class W:
    def __init__(self, sid, title, subtitle, exercises):
        self.sid, self.title, self.subtitle = sid, title, subtitle
        self.exercises = exercises
        self.nodes, self.edges, self.findings = [], [], []
        self._n = 0
    def host(self, hid, label, kind="host", **kw):
        self.nodes.append(dict(id=hid, type="host", label=label, host_kind=kind, **kw)); return hid
    def dist(self, nid, label, host=None, parent=None, **kw):
        n = dict(id=nid, type="distribution", label=label, on_host=host,
                 parent=parent, vcs="git", layout="worktree", annex_mode="none",
                 packaging=[], expanded=False, observed_at=T0, via="lena")
        n.update(kw); self.nodes.append(n); return nid
    def edge(self, src, dst, remote_name=None, kind="remote", **kw):
        self._n += 1
        e = dict(id=f"e{self._n}", source=src, target=dst, kind=kind,
                 remote_name=remote_name, observed_at=T0, via="lena")
        e.update(kw); self.edges.append(e); return e["id"]
    def finding(self, sev, code, msg, nodes):
        self.findings.append(dict(severity=sev, code=code, message=msg, nodes=nodes))
    def write(self):
        d = OUT / self.sid; d.mkdir(parents=True, exist_ok=True)
        doc = dict(scenario=self.sid, title=self.title, subtitle=self.subtitle,
                   exercises=self.exercises, generated_from="synthetic fixture",
                   nodes=self.nodes, edges=self.edges, findings=self.findings,
                   stats=dict(nodes=len(self.nodes), edges=len(self.edges),
                              hosts=len([n for n in self.nodes if n["type"]=="host"]),
                              findings=len(self.findings)))
        (d/"worldmap.json").write_text(json.dumps(doc, indent=1, sort_keys=False))
        print(f"  {self.sid:22s} nodes={len(self.nodes):4d} edges={len(self.edges):4d} "
              f"findings={len(self.findings)}")

# ---------------------------------------------------------------- scenario 1
# The real spacetop case from issue #1: one dataset, many clones, many hosts,
# per-clone remote names that disagree, special remotes, a dead remote, and a
# duplicate annex UUID that must be rendered as an ERROR.
s1 = W("s1-spacetop", "Spacetop: one dataset, eleven clones, six hosts",
       "The hand-drawn map from issue #1, crawled. Remote names differ per clone.",
       ["host clustering as compound nodes", "per-edge remote names",
        "special remotes with flavours", "duplicate annex UUID as a loud error",
        "dead remote as a warning", "bare vs worktree"])
DSID = "fd3b41bb-5d75-4cee-b41c-aac0e0cae7f1"
for h,l in [("h:lena","lena (laptop)"),("h:typhon","typhon.dartmouth.edu"),
            ("h:smaug","smaug.datalad.org"),("h:rolando","rolando.cns.dartmouth.edu"),
            ("h:discovery","discovery.dartmouth.edu"),("h:github","github.com"),
            ("h:openneuro","openneuro.org"),("h:aws","s3.amazonaws.com")]:
    s1.host(h,l, kind="forge" if h in ("h:github","h:openneuro") else
                 "cloud" if h=="h:aws" else "host")
C = {}
def c1(key,label,host,**kw):
    C[key]=s1.dist(f"d:{key}",label,host=host,parent=host,dataset_id=DSID,
                   annex_uuid=uuid_for(key),annex_mode="keystore",**kw)
c1("lena","~/datasets/1076_spacetop","h:lena",is_seed=True,expanded=True)
c1("typhon","/mnt/DATA/data/yoh/1076_spacetop","h:typhon")
c1("typhon-bare","/mnt/DATA/data/yoh/1076_spacetop.git","h:typhon",layout="bare")
c1("smaug","/mnt/btrfs/datasets/incoming/yoh/1076_spacetop","h:smaug")
c1("rolando","/inbox/BIDS/Wager/1076_spacetop","h:rolando")
c1("rolando-x","/inbox/BIDS/Wager/1076_spacetop.git","h:rolando",layout="bare")
c1("discovery","/dartfs-hpc/.../spacetop/dartmouth","h:discovery")
c1("hjlaptop","~/Documents/projects_local/1076_spacetop","h:hjlaptop") \
    if False else None
s1.host("h:hjlaptop","h-MacBook-Pro.local")
c1("hjlaptop","~/Documents/projects_local/1076_spacetop","h:hjlaptop")
# the duplicate-uuid offender: a hard copy, violating git-annex's core principle
dup = s1.dist("d:discovery-copy","/dartfs-hpc/.../spacetop/dartmouth-COPY",
              host="h:discovery",parent="h:discovery",dataset_id=DSID,
              annex_uuid=s1.nodes[[n["id"] for n in s1.nodes].index(C["discovery"])]["annex_uuid"],
              annex_mode="keystore")
for key,lbl in [("gh-spatial","spatialtopology/ds005256"),
                ("gh-yarik","yarikoptic/ds005256"),
                ("gh-openneuro","OpenNeuroDatasets/ds005256")]:
    C[key]=s1.dist(f"d:{key}",lbl,host="h:github",parent="h:github",
                   layout="bare",dataset_id=DSID,annex_uuid=uuid_for(key),
                   annex_mode="keystore",forge="github")
C["on"]=s1.dist("d:on","openneuro.org/git/0/ds005256",host="h:openneuro",
                parent="h:openneuro",layout="bare",dataset_id=DSID,
                annex_uuid=uuid_for("on"),annex_mode="keystore")
C["s3"]=s1.dist("d:s3","s3-PUBLIC",host="h:aws",parent="h:aws",vcs="none",
                layout="export-tree",annex_mode="exporttree",
                packaging=["encrypted:none","public"],
                annex_uuid=uuid_for("s3"),special_remote_type="S3")
C["dead"]=s1.dist("d:dead","old-backup (dead)",host="h:smaug",parent="h:smaug",
                  vcs="none",layout="archive",annex_mode="keystore",
                  annex_uuid=uuid_for("dead"),trust="dead",special_remote_type="directory")
# edges: the same peer known by different names from different clones
E1 = [("lena","rolando","origin",3,0),("lena","rolando-x","rolando-exchange",0,12),
      ("lena","smaug","smaug",0,4),("lena","typhon-bare","typhon-exchange",0,0),
      ("lena","typhon",None,1,1),("lena","discovery",None,0,7),
      ("lena","gh-openneuro",None,0,0),("lena","gh-yarik",None,2,0),
      ("lena","gh-spatial",None,0,3),("lena","s3",None,0,0),
      ("typhon","rolando","origin",0,3),("typhon","rolando-x","rolando-exchange",0,12),
      ("typhon","gh-spatial","gh-spatialtopology",0,3),("typhon","on",None,0,0),
      ("typhon-bare","typhon",None,0,0),
      ("smaug","rolando","origin",0,3),("smaug","rolando-x","rolando-exchange",0,12),
      ("smaug","dead","old-backup",0,0),
      ("rolando-x","rolando","origin",0,0),("rolando-x","typhon","typhon",1,0),
      ("rolando","rolando-x","spacetop-rolando-exchange",12,0),
      ("hjlaptop","rolando","origin",0,9),("hjlaptop","rolando-x","rolando-exchange",0,21),
      ("discovery","rolando","origin",0,5)]
for a,b,name,ahead,behind in E1:
    s1.edge(C[a],C[b],remote_name=name,ahead=ahead,behind=behind,
            resolution="resolved" if name else "url-only")
s1.edge(C["discovery"],dup,kind="same_annex_uuid",remote_name=None,
        resolution="conflict")
s1.finding("error","duplicate-annex-uuid",
           "Two distributions declare annex UUID "
           f"{uuid_for('discovery')[:8]}… but differ in content — a hard copy.",
           [C["discovery"],dup])
s1.finding("warning","dead-remote",
           "Remote 'old-backup' is marked dead in trust.log but is still "
           "configured on smaug.",[C["dead"],C["smaug"]])
s1.finding("info","behind","lena is 12 commits behind rolando-exchange.",[C["lena"]])
s1.write()

# ---------------------------------------------------------------- scenario 2
# BABS / mechababs: a superdataset of subdatasets, a RIA store accumulating one
# result branch per subject, worktrees with unmerged work.  Issues #4 and #5.
s2 = W("s2-babs-ria", "BABS: 40 subjects, a RIA store, and unmerged worktrees",
       "Nested subdatasets, per-subject result branches piling up in a RIA, "
       "and three worktrees nobody merged.",
       ["deep nesting as compound nodes", "aheadness badges that scale",
        "a RIA store that contains repositories", "worktrees as first-class nodes",
        "collapse/expand of 40 similar children"])
for h,l,k in [("h:discovery","discovery.dartmouth.edu","host"),
              ("h:lena","lena (laptop)","host"),
              ("h:ria","ria.datalad.org","store")]:
    s2.host(h,l,kind=k)
SUPER = s2.dist("d:super","babs-spacetop-fmriprep",host="h:discovery",
                parent="h:discovery",dataset_id=uuid_for("super"),
                annex_mode="keystore",annex_uuid=uuid_for("super-annex"),
                is_seed=True,expanded=True)
inp = s2.dist("d:sub-input","inputs/data (subdataset)",host="h:discovery",
              parent="d:super",dataset_id=DSID,annex_mode="keystore",
              annex_uuid=uuid_for("sub-input"),role="subdataset")
cont = s2.dist("d:sub-cont","containers (subdataset)",host="h:discovery",
               parent="d:super",dataset_id=uuid_for("cont"),annex_mode="keystore",
               annex_uuid=uuid_for("cont-annex"),role="subdataset")
s2.edge(SUPER,inp,kind="subdataset",remote_name=None,path="inputs/data")
s2.edge(SUPER,cont,kind="subdataset",remote_name=None,path="containers")
RIA = s2.dist("d:ria","ria-store /data/ria (ORA)",host="h:ria",parent="h:ria",
              vcs="none",layout="ria-store",annex_mode="keystore",
              annex_uuid=uuid_for("ria"),special_remote_type="ora")
s2.edge(SUPER,RIA,remote_name="output-ria",ahead=0,behind=40,resolution="resolved")
# 40 per-subject bare repos INSIDE the RIA store -> parts, i.e. nesting
for i in range(1,41):
    sid = f"sub-{i:03d}"
    n = s2.dist(f"d:ria-{sid}",sid,host="h:ria",parent="d:ria",layout="bare",
                dataset_id=uuid_for("super"),annex_mode="keystore",
                annex_uuid=uuid_for(f"ria-{sid}"),role="result-branch",
                result_branch=f"job-{sid}",
                merged=(i<=28))
    s2.edge(RIA,n,kind="part",remote_name=None)
    s2.edge(n,SUPER,remote_name="origin",ahead=1 if i>28 else 0,behind=0,
            resolution="resolved")
s2.finding("info","unmerged-results",
           "12 of 40 per-subject result branches in the RIA store are not yet "
           "merged into the superdataset.",[RIA,SUPER])
# worktrees
for wt,br,ahead in [("wt-fix","fix/heudiconv-dedup",3),("wt-qa","qa/review",1),
                    ("wt-old","exp/old-pipeline",17)]:
    n = s2.dist(f"d:{wt}",f"~/work/{wt}",host="h:lena",parent="h:lena",
                layout="linked-worktree",dataset_id=uuid_for("super"),
                annex_mode="keystore",annex_uuid=uuid_for(wt),branch=br)
    s2.edge(n,SUPER,kind="worktree_of",remote_name=None,ahead=ahead,behind=0)
s2.finding("warning","stale-worktree",
           "Worktree exp/old-pipeline is 17 commits ahead and untouched for "
           "months.",["d:wt-old"])
LOCAL = s2.dist("d:local-super","~/work/babs-spacetop-fmriprep",host="h:lena",
                parent="h:lena",dataset_id=uuid_for("super"),
                annex_mode="keystore",annex_uuid=uuid_for("local-super"))
s2.edge(LOCAL,SUPER,remote_name="origin",ahead=0,behind=41,resolution="resolved")
s2.write()

# ---------------------------------------------------------------- scenario 3
# Plain git, no annex, no dataset UUID: a fork network to preview before adding,
# plus the template-sibling ambiguity.  Issue #6 and the identity problem.
s3 = W("s3-forks", "Fork network: 60 forks, no UUIDs, one template trap",
       "Plain git. Nothing declares an identity, so relatedness must be "
       "inferred — and two repos share a template, not a lineage.",
       ["preview before adding as a remote", "grey out forks with no new commits",
        "identity as confidence, not a merge", "candidate clusters from remote topology",
        "scale: 60+ nodes without becoming hairball"])
s3.host("h:github","github.com",kind="forge")
s3.host("h:lena","lena (laptop)",kind="host")
UP = s3.dist("d:upstream","con/duct",host="h:github",parent="h:github",
             layout="bare",forge="github",forge_id=812334455,
             stars=214,is_upstream=True)
MINE = s3.dist("d:mine","~/proj/duct",host="h:lena",parent="h:lena",
               is_seed=True,expanded=True)
s3.edge(MINE,UP,remote_name="origin",ahead=2,behind=0,resolution="resolved")
import random
rnd = random.Random(20260825)
ACTIVE = [("yarikoptic",14,0),("asmacdo",6,3),("candleindark",2,0),
          ("jwodder",31,12),("mih",1,0),("adswa",9,1),("TheChymera",4,0),
          ("djarecka",22,5)]
for owner,ahead,behind in ACTIVE:
    n = s3.dist(f"d:fork-{owner}",f"{owner}/duct",host="h:github",parent="h:github",
                layout="bare",forge="github",forge_id=rnd.randint(8e8,9e8),
                is_fork=True,ahead_of_upstream=ahead,behind_upstream=behind,
                added_as_remote=False,stars=rnd.randint(0,9))
    s3.edge(n,UP,kind="fork_of",remote_name=None,ahead=ahead,behind=behind)
for i in range(52):
    owner = f"user{i:02d}"
    n = s3.dist(f"d:fork-{owner}",f"{owner}/duct",host="h:github",parent="h:github",
                layout="bare",forge="github",forge_id=rnd.randint(8e8,9e8),
                is_fork=True,ahead_of_upstream=0,
                behind_upstream=rnd.choice([0,1,3,9,40]),
                added_as_remote=False,stars=0,inactive=True)
    s3.edge(n,UP,kind="fork_of",remote_name=None,ahead=0,behind=n["behind_upstream"]
            if isinstance(n,dict) else 0)
s3.finding("info","inactive-forks",
           "52 of 60 forks have no commits beyond upstream and are greyed out.",
           [UP])
# the template trap, straight from the measured experiment
TPL = s3.dist("d:tpl","con/python-template",host="h:github",parent="h:github",
              layout="bare",forge="github",is_template=True)
A = s3.dist("d:proj-a","con/project-alpha",host="h:github",parent="h:github",
            layout="bare",forge="github")
B = s3.dist("d:proj-b","con/project-beta",host="h:github",parent="h:github",
            layout="bare",forge="github")
for x in (A,B):
    s3.edge(x,TPL,kind="shares_history_with",remote_name="origin",
            containment=0.19,merge_base="77ecb3d",note="template-derived")
s3.edge(A,B,kind="candidate_same_as",remote_name=None,confidence=0.19,
        verdict="rejected",
        note="Same upstream and same tracked branch, but containment 0.19 — "
             "template siblings, not the same repository.")
s3.finding("warning","identity-ambiguous",
           "project-alpha and project-beta share an upstream and a tracked "
           "branch but only 19% history containment. Suggest: NOT the same "
           "repository. Confirm or reject.",[A,B])
CLONE = s3.dist("d:proj-a-clone","~/proj/project-alpha",host="h:lena",parent="h:lena")
s3.edge(CLONE,A,remote_name="origin",ahead=0,behind=1,resolution="resolved")
s3.edge(CLONE,A,kind="candidate_same_as",remote_name=None,confidence=1.0,
        verdict="accepted",note="Containment 1.00 — strict ancestor.")
s3.write()
