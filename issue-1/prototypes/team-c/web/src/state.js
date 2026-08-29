import { MultiDirectedGraph } from "graphology";

export const state = {
  scenario: "s1-spacetop",
  synthetic: false,
  graph: new MultiDirectedGraph(),
  meta: {},                  // title/subtitle/exercises/census
  findings: [],
  groups: new Map(),         // containerId -> geometry (from layoutWorld)
  perspective: "remotes",
  filters: {
    kinds: new Set(),        // active relation kinds (user override)
    hosts: new Set(),        // active top-level containers
    aheadMin: 0,
    annex: "all",            // all | annex | plain
    showInactive: true,
    showHosts: false,
    search: "",
  },
  collapsed: new Set(),
  hulls: true,
  semanticZoom: true,
  selected: null,
  hovered: null,
  theme: "dark",
  busy: null,
  lastProbeMs: null,
  perf: { fps: 0, frameMs: 0, lastLayoutMs: 0, lastSwitchMs: 0, firstRenderMs: null },
};

export function resetGraph() {
  state.graph = new MultiDirectedGraph();
  state.groups = new Map();
  state.collapsed = new Set();
  state.selected = null;
  state.hovered = null;
  state.filters.hosts = new Set();
}

/** Max "commits ahead" that this node claims over any of its outgoing edges. */
export function recomputeDerived(graph) {
  graph.forEachNode((n, a) => {
    let ahead = a.ahead_of_upstream || 0, behind = a.behind_upstream || 0;
    let names = new Set(), inbound = new Set();
    graph.forEachOutEdge(n, (e, ea) => {
      if (typeof ea.ahead === "number") ahead = Math.max(ahead, ea.ahead);
      if (typeof ea.behind === "number") behind = Math.max(behind, ea.behind);
      if (ea.remote_name) names.add(ea.remote_name);
    });
    graph.forEachInEdge(n, (e, ea) => {
      if (ea.kind === "remote" && ea.remote_name) inbound.add(ea.remote_name);
    });
    graph.mergeNodeAttributes(n, {
      _ahead: ahead, _behind: behind,
      _outNames: [...names], _inNames: [...inbound],
      _aliasCount: inbound.size,
    });
  });
}

export function findingIndex(findings) {
  const sev = new Map();
  for (const f of findings) {
    for (const n of (f.nodes || [])) {
      const cur = sev.get(n);
      if (cur !== "error") sev.set(n, f.severity === "error" ? "error" : (cur || f.severity));
    }
  }
  return sev;
}

export function topContainerOf(graph, n) {
  let cur = n, g = 0;
  while (g++ < 64) {
    const p = graph.getNodeAttribute(cur, "parent");
    if (!p || !graph.hasNode(p)) return cur;
    cur = p;
  }
  return cur;
}
