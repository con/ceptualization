/**
 * A perspective is a NAMED BUNDLE of (which node types and relations are
 * visible, how everything is styled).  Deliberately a pure function of the
 * already-positioned graph: switching one never touches positions, never
 * re-runs layout, never re-indexes sigma.  That is why it is instant.
 */
export const PERSPECTIVES = [
  {
    id: "remotes",
    name: "Remotes & aheadness",
    key: "1",
    desc: "Who is a remote of whom, under which name, and how far apart they " +
          "have drifted. Node size = commits ahead. Errors are always kept.",
    kinds: ["remote", "same_annex_uuid"],
    colorBy: "host",
    sizeBy: "ahead",
    edgeLabels: "remote_name",
    keepErrors: true,
  },
  {
    id: "storage",
    name: "Storage & special remotes",
    key: "2",
    desc: "Where bytes actually live: RIA stores, S3/directory special remotes, " +
          "exporttree, bare vs worktree. Containment is the story here.",
    kinds: ["contains", "part", "remote"],
    colorBy: "storage",
    sizeBy: "children",
    edgeLabels: "none",
    keepErrors: true,
    dimUnless: (a) => a.vcs === "none" || a.special_remote_type ||
      a.layout === "bare" || a.layout === "ria-store" ||
      a.layout === "export-tree" || a.layout === "archive" ||
      a.annex_mode === "exporttree" || a.type === "host",
  },
  {
    id: "lineage",
    name: "Lineage & identity",
    key: "3",
    desc: "Forks, shared history, worktrees and candidate same-as. Edge colour " +
          "encodes confidence; a rejected candidate is drawn, not hidden.",
    kinds: ["fork_of", "shares_history_with", "candidate_same_as",
            "worktree_of", "subdataset", "same_annex_uuid"],
    colorBy: "lineage",
    sizeBy: "ahead",
    edgeLabels: "confidence",
    keepErrors: true,
  },
  {
    id: "topology",
    name: "Infrastructure topology",
    key: "4",
    desc: "Hosts, stores and containment only. The skeleton the other " +
          "perspectives hang off. Host nodes are shown explicitly here.",
    kinds: ["contains", "part", "subdataset"],
    colorBy: "hostkind",
    sizeBy: "children",
    edgeLabels: "none",
    showHosts: true,
    keepErrors: false,
  },
  {
    id: "health",
    name: "Health & conflicts",
    key: "5",
    desc: "Everything greys out except nodes named in a finding and their " +
          "immediate neighbourhood. The triage view.",
    kinds: ["remote", "same_annex_uuid", "candidate_same_as", "worktree_of", "part"],
    colorBy: "severity",
    sizeBy: "severity",
    edgeLabels: "remote_name",
    keepErrors: true,
    focusFindings: true,
  },
];

export const byId = (id) => PERSPECTIVES.find((p) => p.id === id) || PERSPECTIVES[0];
