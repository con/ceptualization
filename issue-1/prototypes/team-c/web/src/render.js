import Sigma from "sigma";
import { EdgeArrowProgram } from "sigma/rendering";
import EdgeCurveProgram, {
  EdgeCurvedArrowProgram, indexParallelEdgesIndex,
} from "@sigma/edge-curve";
import { state, recomputeDerived, findingIndex, topContainerOf } from "./state.js";
import { layoutWorld, leafRadius } from "./layout.js";
import { byId, PERSPECTIVES } from "./perspectives.js";
import { TOK, hostColor, kindColor, setPaletteTheme } from "./palette.js";
import { Overlay } from "./overlay.js";

export let renderer = null;
export let overlay = null;
let view = { kinds: new Set(), p: PERSPECTIVES[0], focus: null, hits: null, showHosts: false };

/* ------------------------------------------------------------------ sigma */
export function initSigma(container) {
  renderer = new Sigma(state.graph, container, {
    allowInvalidContainer: true,
    itemSizesReference: "positions",
    zoomToSizeRatioFunction: (x) => x,
    autoRescale: false,
    minCameraRatio: 0.02,
    maxCameraRatio: 40,
    renderEdgeLabels: true,
    labelDensity: 0.7,
    labelGridCellSize: 62,
    labelRenderedSizeThreshold: 7,
    labelFont: "ui-sans-serif, system-ui, sans-serif",
    labelSize: 11,
    edgeLabelFont: "ui-monospace, SFMono-Regular, Menlo, monospace",
    edgeLabelSize: 10,
    stagePadding: 60,
    defaultEdgeType: "straight",
    edgeProgramClasses: {
      straight: EdgeArrowProgram,
      curved: EdgeCurvedArrowProgram,
      plain: EdgeCurveProgram,
    },
    nodeReducer, edgeReducer,
  });
  overlay = new Overlay(renderer, container, state);
  new ResizeObserver(() => { overlay.resize(); renderer.refresh(); }).observe(container);
  return renderer;
}

/* --------------------------------------------------------------- ingestion */
export function ingest(payload, opts = {}) {
  const g = state.graph;
  for (const n of payload.nodes || []) {
    const attrs = { ...n, ntype: n.type, _new: !opts.reset };
    delete attrs.type;                       // `type` is sigma's program name
    if (g.hasNode(n.id)) g.mergeNodeAttributes(n.id, attrs);
    else g.addNode(n.id, { x: NaN, y: NaN, size: 8, color: "#888", ...attrs });
  }
  for (const [id, rel] of Object.entries(payload.refresh || {})) {
    if (g.hasNode(id)) g.setNodeAttribute(id, "relations", rel);
  }
  for (const e of payload.edges || []) {
    if (!g.hasNode(e.source) || !g.hasNode(e.target)) continue;
    if (g.hasEdge(e.id)) continue;
    try { g.addDirectedEdgeWithKey(e.id, e.source, e.target, { ...e }); } catch (_) { /* dup */ }
  }
  g.forEachNode((n, a) => {
    if (a._short === undefined) g.setNodeAttribute(n, "_short", shortLabel(a.label));
  });
  recomputeDerived(g);
  state._sev = findingIndex(state.findings);
  indexCurves();
}

/** Long POSIX paths destroy a graph canvas; keep the tail, keep the meaning. */
export function shortLabel(label) {
  if (!label) return label;
  let s = String(label);
  if (s.length <= 26) return s;
  const parts = s.split("/").filter(Boolean);
  if (parts.length > 2) s = ".../" + parts.slice(-2).join("/");
  if (s.length > 30) s = s.slice(0, 14) + "..." + s.slice(-13);
  return s;
}

function indexCurves() {
  const g = state.graph;
  try {
    indexParallelEdgesIndex(g, {
      edgeIndexAttribute: "pIdx",
      edgeMinIndexAttribute: "pMin",
      edgeMaxIndexAttribute: "pMax",
    });
  } catch (_) { return; }
  g.forEachEdge((e, a) => {
    const max = a.pMax || 0;
    if (max === 0 && (a.pMin === undefined || a.pMin === 0)) {
      g.mergeEdgeAttributes(e, { type: "straight", curvature: 0 });
    } else {
      const i = a.pIdx || 0;
      const c = 0.5 * ((i - max / 2) / (max / 2 || 1)) * (max > 1 ? 1 : 0.6);
      g.mergeEdgeAttributes(e, { type: "curved", curvature: c === 0 ? 0.22 : c });
    }
  });
}

/* ------------------------------------------------------------------ layout */
export function applyLayout(opts = {}) {
  const res = layoutWorld(state.graph, opts);
  state.groups = res.groups;
  state.perf.lastLayoutMs = res.ms;
  // positions changed -> sigma must re-normalise (autoRescale is off, but the
  // framed-graph normalisation still derives from the node extent)
  if (renderer) renderer.refresh();
  return res;
}

/* ------------------------------------------------ collapse / meta-nodes */
/**
 * Collapse is recomputed wholesale from `state.collapsed` every time it
 * changes. That is O(V+E) but it is the only version that stays correct under
 * nesting (a RIA store collapsed inside an already-collapsed host) and it
 * aggregates group-to-group instead of group-to-node, which matters as soon as
 * more than one group is collapsed at a time.
 * Positions are NOT recomputed: collapsing must never move the map.
 */
function visibleRep(g, n) {
  let cur = n, rep = null, guard = 0;
  while (cur && guard++ < 64) {
    if (state.collapsed.has(cur)) rep = cur;
    const p = g.getNodeAttribute(cur, "parent");
    cur = (p && g.hasNode(p)) ? p : null;
  }
  return rep || n;
}

export function rebuildCollapse() {
  const t0 = performance.now();
  const g = state.graph;
  for (const e of g.edges()) if (e.charCodeAt(0) === 109 && e.startsWith("meta:")) g.dropEdge(e);
  g.forEachNode((n, a) => {
    if (a._collapsedInto) g.removeNodeAttribute(n, "_collapsedInto");
    if (a._meta) g.mergeNodeAttributes(n, { _meta: false, _metaCount: 0 });
  });
  if (state.collapsed.size) {
    const counts = new Map();
    g.forEachNode((n) => {
      const rep = visibleRep(g, n);
      if (rep !== n) {
        g.setNodeAttribute(n, "_collapsedInto", rep);
        counts.set(rep, (counts.get(rep) || 0) + 1);
      }
    });
    for (const [rep, c] of counts) g.mergeNodeAttributes(rep, { _meta: true, _metaCount: c });

    const agg = new Map();
    g.forEachEdge((e, a, s, t) => {
      const rs = visibleRep(g, s), rt = visibleRep(g, t);
      if (rs === s && rt === t) return;      // nothing hidden, keep the real edge
      if (rs === rt) return;                 // wholly internal to one collapsed group
      const k = a.kind + "|" + rs + "|" + rt;
      let x = agg.get(k);
      if (!x) agg.set(k, (x = { kind: a.kind, s: rs, t: rt, n: 0, ahead: 0, names: new Set() }));
      x.n++;
      x.ahead = Math.max(x.ahead, a.ahead || 0);
      if (a.remote_name) x.names.add(a.remote_name);
    });
    // Budget: every aggregated (kind, groupA, groupB) pair is still a real edge,
    // so collapsing a sparse cross-group mesh does NOT reduce the edge count.
    // Above the budget we keep the heaviest bundles and say how many we dropped.
    const BUDGET = 800;
    let list = [...agg.entries()];
    state.metaEdgesTruncated = 0;
    if (list.length > BUDGET) {
      list.sort((a, b) => b[1].n - a[1].n);
      state.metaEdgesTruncated = list.length - BUDGET;
      list = list.slice(0, BUDGET);
    }
    state.metaEdgeCount = list.length;
    for (const [k, x] of list) {
      const id = "meta:" + k;
      if (g.hasEdge(id)) continue;
      try {
        g.addDirectedEdgeWithKey(id, x.s, x.t, {
          kind: x.kind, _metaEdge: true, _count: x.n, ahead: x.ahead,
          type: "straight", curvature: 0,
          remote_name: x.names.size === 1 ? [...x.names][0]
            : (x.names.size ? x.names.size + " names" : null),
        });
      } catch (_) { /* ignore */ }
    }
  }
  state.perf.lastCollapseMs = performance.now() - t0;
  if (renderer) renderer.refresh();
  return state.perf.lastCollapseMs;
}

export function collapseGroup(id) {
  if (!state.graph.hasNode(id)) return;
  const gr = state.groups.get(id);
  if (!gr || !gr.members.length || state.collapsed.has(id)) return;
  state.collapsed.add(id);
  rebuildCollapse();
}

export function expandGroup(id) {
  if (!state.collapsed.delete(id)) return;
  rebuildCollapse();
}

export function setCollapsed(ids) {
  state.collapsed = new Set(ids.filter((i) => state.graph.hasNode(i)));
  return rebuildCollapse();
}

export function collapsibleGroups() {
  return [...state.groups.values()].filter((gr) => gr.members.length >= 2);
}

/* ------------------------------------------------------- view computation */
export function applyView() {
  const t0 = performance.now();
  const p = byId(state.perspective);
  const f = state.filters;
  view.kinds = new Set([...f.kinds].filter((k) => p.kinds.includes(k) || k === "same_annex_uuid"));
  if (!view.kinds.size) view.kinds = new Set(p.kinds);
  view.p = p;
  view.showHosts = p.showHosts || f.showHosts;
  const g = state.graph;

  // health perspective: nodes named by a finding, plus their neighbours
  if (p.focusFindings) {
    const focus = new Set();
    for (const fi of state.findings) for (const n of (fi.nodes || [])) if (g.hasNode(n)) focus.add(n);
    for (const n of [...focus]) g.forEachNeighbor(n, (m) => focus.add(m));
    view.focus = focus;
  } else view.focus = null;

  // search hits
  const q = f.search.trim().toLowerCase();
  view.hits = null;
  if (q) {
    const hits = new Set();
    g.forEachNode((n, a) => { if (matches(a, n, q, g)) hits.add(n); });
    view.hits = hits;
  }
  if (renderer) renderer.refresh({ skipIndexation: true });
  state.perf.lastSwitchMs = performance.now() - t0;
  return state.perf.lastSwitchMs;
}

export function matches(a, n, q, g) {
  if ((a.label || "").toLowerCase().includes(q)) return true;
  if (n.toLowerCase().includes(q)) return true;
  if ((a.annex_uuid || "").toLowerCase().includes(q)) return true;
  if ((a.dataset_id || "").toLowerCase().includes(q)) return true;
  if ((a._outNames || []).some((x) => x.toLowerCase().includes(q))) return true;
  if ((a._inNames || []).some((x) => x.toLowerCase().includes(q))) return true;
  if (a.on_host && g.hasNode(a.on_host) &&
      (g.getNodeAttribute(a.on_host, "label") || "").toLowerCase().includes(q)) return true;
  return false;
}

/* ------------------------------------------------------------- reducers */
function nodeVisible(n, a) {
  const f = state.filters;
  if (a._collapsedInto) return false;
  if (a.ntype === "host" && !view.showHosts && !a._meta) return false;
  if (!f.showInactive && a.inactive) return false;
  if (f.annex === "annex" && (a.annex_mode === "none" || !a.annex_mode)) return false;
  if (f.annex === "plain" && a.annex_mode && a.annex_mode !== "none") return false;
  if (f.aheadMin > 0 && (a._ahead || 0) < f.aheadMin && !a._meta) return false;
  if (f.hosts.size) {
    const top = topContainerOf(state.graph, n);
    if (!f.hosts.has(top)) return false;
  }
  return true;
}

function nodeColor(n, a, T) {
  const p = view.p;
  switch (p.colorBy) {
    case "storage":
      if (a.layout === "ria-store") return "#c792ea";
      if (a.special_remote_type === "S3" || a.annex_mode === "exporttree") return "#63d9d2";
      if (a.trust === "dead" || a.layout === "archive") return T.grey;
      if (a.layout === "bare") return "#8ea9ff";
      if (a.ntype === "host") return T.fg3;
      return a.annex_mode && a.annex_mode !== "none" ? "#3fd68b" : T.fg3;
    case "lineage":
      if (a.is_upstream) return T.accent;
      if (a.is_template) return T.warn;
      if (a.inactive) return T.grey;
      if (a.is_fork) return "#3fd68b";
      if (a.role === "result-branch") return a.merged ? "#63d9d2" : T.warn;
      return "#c792ea";
    case "hostkind":
      if (a.ntype === "host") {
        return a.host_kind === "forge" ? "#c792ea"
          : a.host_kind === "cloud" ? "#63d9d2"
            : a.host_kind === "store" ? "#ffb454" : T.accent;
      }
      return hostColor(topContainerOf(state.graph, n));
    case "severity": {
      const s = (state._sev || new Map()).get(n);
      if (s === "error") return T.err;
      if (s === "warning") return T.warn;
      return T.grey;
    }
    default:
      return hostColor(topContainerOf(state.graph, n));
  }
}

function nodeReducer(n, a) {
  const T = TOK();
  const res = { ...a, type: "circle" };
  if (!nodeVisible(n, a)) { res.hidden = true; return res; }
  res.hidden = false;
  res.size = leafRadius(a);
  const p = view.p;
  if (p.sizeBy === "children") {
    const gr = state.groups.get(n);
    if (gr) res.size = Math.min(30, 10 + Math.sqrt(gr.members.length) * 2.4);
  } else if (p.sizeBy === "severity") {
    const s = (state._sev || new Map()).get(n);
    res.size = s ? res.size * 1.5 : res.size * 0.8;
  }
  res.color = nodeColor(n, a, T);
  res.label = a._short || a.label;
  res.zIndex = 2;

  let dim = false;
  if (p.dimUnless && !p.dimUnless(a)) dim = true;
  if (view.focus && !view.focus.has(n)) dim = true;
  if (a.inactive && !(view.hits && view.hits.has(n))) dim = true;
  if (view.hits && !view.hits.has(n)) dim = true;

  if (dim) {
    res.color = withAlpha(T.grey, 0.55);
    res.label = null;
    res.size = Math.max(2.5, res.size * 0.55);
    res.zIndex = 0;
  }
  if (view.hits && view.hits.has(n)) {
    res.zIndex = 4; res.highlighted = true; res.forceLabel = true;
  }
  if (n === state.selected || n === state.hovered) {
    res.zIndex = 5; res.forceLabel = true; res.highlighted = true;
  }
  if (a._meta) { res.label = (a._short || a.label) + "  x" + a._metaCount; res.zIndex = 4; res.forceLabel = true; }
  const sev = (state._sev || new Map()).get(n);
  if (sev === "error") { res.zIndex = 6; res.forceLabel = true; res.color = T.err; }
  return res;
}

function edgeReducer(e, a) {
  const T = TOK();
  const res = { ...a };
  const g = state.graph;
  const kindOK = view.kinds.has(a.kind) ||
    (view.p.keepErrors && (a.kind === "same_annex_uuid" || a.resolution === "conflict"));
  if (!kindOK) { res.hidden = true; return res; }
  if (a.kind === "contains" && !view.showHosts) { res.hidden = true; return res; }
  res.hidden = false;
  res.color = kindColor(a.kind);
  res.size = 1.1;
  if (a.kind === "same_annex_uuid" || a.resolution === "conflict") {
    res.color = T.err; res.size = 3; res.zIndex = 9; res.forceLabel = true;
    res.label = "same annex UUID";
  } else if (a._metaEdge) {
    res.size = Math.min(6, 1.4 + Math.sqrt(a._count) * 0.8);
    res.label = (a.remote_name ? a.remote_name + " " : "") + "x" + a._count;
    // forcing hundreds of labels costs more than the nodes we just hid
    res.forceLabel = (state.metaEdgeCount || 0) < 120;
  } else if (view.p.edgeLabels === "remote_name") {
    res.label = a.remote_name || (a.resolution === "url-only" ? "(url only)" : null);
    if (a.ahead > 0) res.size = 1.1 + Math.min(3, Math.sqrt(a.ahead) * 0.6);
  } else if (view.p.edgeLabels === "confidence") {
    if (typeof a.confidence === "number") {
      res.label = "conf " + a.confidence.toFixed(2) + (a.verdict ? " · " + a.verdict : "");
      res.color = a.verdict === "rejected" ? T.err : T.ok;
      res.size = 2.4; res.forceLabel = true;
    } else if (typeof a.containment === "number") {
      res.label = "containment " + a.containment.toFixed(2);
      res.color = T.warn; res.size = 1.8;
    } else res.label = null;
  } else res.label = null;

  const s = g.source(e), t = g.target(e);
  if (state.selected && (s === state.selected || t === state.selected)) {
    res.forceLabel = true; res.size = Math.max(res.size, 2.2); res.zIndex = 8;
    if (!res.label && a.remote_name) res.label = a.remote_name;
  }
  if (view.hits && !(view.hits.has(s) || view.hits.has(t))) {
    res.color = withAlpha(T.grey, 0.22); res.label = null; res.forceLabel = false;
  }
  if (view.focus && !(view.focus.has(s) && view.focus.has(t))) {
    res.color = withAlpha(T.grey, 0.2); res.label = null;
  }
  if (a.trustDead) res.color = T.grey;
  return res;
}

function withAlpha(hex, a) {
  if (hex.startsWith("rgba")) return hex;
  const n = parseInt(hex.slice(1), 16);
  return "rgba(" + ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + a + ")";
}

/* ------------------------------------------------------------ camera fit */
/**
 * With `autoRescale:false` one graph unit is one pixel at camera ratio 1, so
 * node radii, hull radii and layout spacing are all the same currency. The
 * price is that we own "fit to screen" ourselves.
 */
export function fitCamera(ids, opts = {}) {
  const g = state.graph;
  const list = (ids && ids.length ? ids : g.nodes()).filter((n) => {
    if (!g.hasNode(n)) return false;
    if (!Number.isFinite(g.getNodeAttribute(n, "x"))) return false;
    // a hidden host node still owns a visible containment disc
    if (state.groups.has(n) && !state.collapsed.has(n)) return true;
    const d = renderer.getNodeDisplayData(n);
    return d && !d.hidden;
  });
  if (!list.length) return;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const n of list) {
    const a = g.getNodeAttributes(n);
    const gr = state.groups.get(n);
    const r = (gr && !state.collapsed.has(n)) ? gr.r : leafRadius(a);
    x0 = Math.min(x0, a.x - r); x1 = Math.max(x1, a.x + r);
    y0 = Math.min(y0, a.y - r); y1 = Math.max(y1, a.y + r);
  }
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const bw = Math.max(60, x1 - x0), bh = Math.max(60, y1 - y0);
  const cam = renderer.getCamera();
  // camera coordinates live in sigma's normalised "framed graph" space
  const f = renderer.viewportToFramedGraph(renderer.graphToViewport({ x: cx, y: cy }));
  const keep = cam.getState();
  cam.setState({ x: f.x, y: f.y, ratio: 1, angle: 0 });
  renderer.refresh({ skipIndexation: true });         // make the matrix current
  const p0 = renderer.graphToViewport({ x: cx, y: cy });
  const p1 = renderer.graphToViewport({ x: cx + 100, y: cy });
  const s1 = Math.abs(p1.x - p0.x) / 100 || 1;        // px per graph unit @ratio 1
  const pad = opts.pad ?? 78;
  const W = renderer.getContainer().clientWidth, H = renderer.getContainer().clientHeight;
  const want = Math.min((W - 2 * pad) / bw, (H - 2 * pad) / bh);
  const ratio = Math.max(opts.minRatio ?? 0.28, Math.min(40, s1 / want));
  if (opts.animate) {
    cam.setState(keep);
    cam.animate({ x: f.x, y: f.y, ratio, angle: 0 }, { duration: opts.duration ?? 420 });
  } else {
    cam.setState({ x: f.x, y: f.y, ratio, angle: 0 });
  }
  return ratio;
}

/* ------------------------------------------------------------- benchmark */
export function setTheme(theme) {
  state.theme = theme;
  document.documentElement.dataset.theme = theme;
  setPaletteTheme(theme === "light");
  if (renderer) {
    renderer.setSetting("labelColor", { color: TOK().fg });
    renderer.setSetting("edgeLabelColor", { color: TOK().fg2 });
    renderer.refresh({ skipIndexation: true });
  }
}

/** Drive the camera for `ms` and report real frame timings. */
export function benchmark(ms = 3000) {
  return new Promise((resolve) => {
    const cam = renderer.getCamera();
    const start = performance.now();
    const s0 = { x: cam.x, y: cam.y, ratio: cam.ratio, angle: cam.angle };
    const frames = [];
    let last = start;
    function step(now) {
      frames.push(now - last); last = now;
      const t = (now - start) / ms;
      if (t >= 1) {
        cam.setState(s0);
        const d = frames.slice(2).sort((a, b) => a - b);
        const med = d[Math.floor(d.length / 2)] || 0;
        const p95 = d[Math.floor(d.length * 0.95)] || 0;
        const mean = d.reduce((a, b) => a + b, 0) / (d.length || 1);
        const rs = [];
        for (let i = 0; i < 12; i++) {
          const a = performance.now();
          renderer.refresh({ skipIndexation: true });
          rs.push(performance.now() - a);
        }
        rs.sort((a, b) => a - b);
        resolve({
          syncRefreshMs: +rs[Math.floor(rs.length / 2)].toFixed(2),
          frames: d.length,
          fps: +(1000 / mean).toFixed(1),
          meanMs: +mean.toFixed(2),
          medianMs: +med.toFixed(2),
          p95Ms: +p95.toFixed(2),
          nodes: state.graph.order, edges: state.graph.size,
        });
        return;
      }
      cam.setState({
        x: s0.x + Math.sin(t * Math.PI * 4) * 0.09,
        y: s0.y + Math.cos(t * Math.PI * 3) * 0.09,
        ratio: s0.ratio * (1 + 0.42 * Math.sin(t * Math.PI * 2)),
        angle: s0.angle,
      });
      requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  });
}
