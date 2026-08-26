import cytoscape from 'cytoscape';
import { PALETTES } from './palette.js';

// Graphviz emits points with y growing *up* from a bottom-left origin.
// Cytoscape's y grows down. One conversion, in one place.
export function gvToCy(pos, bbTop) {
  const [x, y] = pos.split(',').map(Number);
  return { x, y: bbTop - y };
}

export function parseGraphvizJson(text) {
  const j = JSON.parse(text);
  const bb = j.bb.split(',').map(Number);           // llx,lly,urx,ury
  const bbTop = bb[3];
  const nodes = {}, clusters = {}, edges = {};
  for (const o of j.objects || []) {
    if (o.name && o.name.startsWith('cluster_')) {
      const id = o.id || o.name;
      const b = (o.bb || '0,0,0,0').split(',').map(Number);
      clusters[id.replace(/^cluster:/, '')] = {
        x: (b[0] + b[2]) / 2, y: bbTop - (b[1] + b[3]) / 2,
        w: b[2] - b[0], h: b[3] - b[1],
      };
    } else if (o.pos) {
      const p = gvToCy(o.pos, bbTop);
      const rec = { x: p.x, y: p.y, w: Number(o.width) * 72, h: Number(o.height) * 72 };
      if (o.gridpos) {
        const [c, r] = o.gridpos.split(',').map(Number);
        rec.grid = { c, r };
      }
      nodes[o.id || o.name] = rec;
    }
  }
  for (const e of j.edges || []) {
    if (!e.id) continue;
    const rec = {};
    if (e.xlp) rec.labelPos = gvToCy(e.xlp, bbTop);
    if (e.pos) rec.points = parseSpline(e.pos, bbTop);
    edges[e.id] = rec;
  }
  return { bb: { w: bb[2] - bb[0], h: bbTop }, nodes, clusters, edges };
}

/** Graphviz edge `pos` is "e,ex,ey p0 c1 c2 p1 c3 c4 p2 …" (a cubic bezier
 *  chain). The on-curve points are indices 0,3,6,… -- those are the waypoints
 *  a router actually chose, and they are what we replay in cytoscape. */
export function parseSpline(pos, bbTop) {
  const toks = pos.trim().split(/\s+/);
  let end = null;
  const pts = [];
  for (const t of toks) {
    if (t.startsWith('e,')) { const [x, y] = t.slice(2).split(',').map(Number); end = { x, y: bbTop - y }; continue; }
    if (t.startsWith('s,')) continue;
    const [x, y] = t.split(',').map(Number);
    if (Number.isFinite(x) && Number.isFinite(y)) pts.push({ x, y: bbTop - y });
  }
  const on = pts.filter((_, i) => i % 3 === 0);
  if (end) on.push(end);
  return on;
}

/** Re-express Graphviz waypoints as cytoscape `segments` (weight along the
 *  straight source->target line, signed perpendicular distance from it). */
export function routeFor(srcPos, tgtPos, points) {
  if (!points || points.length < 3) return null;
  const Lx = tgtPos.x - srcPos.x, Ly = tgtPos.y - srcPos.y;
  const len2 = Lx * Lx + Ly * Ly;
  if (len2 < 1) return null;
  const len = Math.sqrt(len2);
  const w = [], d = [];
  for (const p of points.slice(1, -1)) {
    const vx = p.x - srcPos.x, vy = p.y - srcPos.y;
    const t = (vx * Lx + vy * Ly) / len2;
    if (t <= 0.02 || t >= 0.98) continue;
    const dist = (Lx * vy - Ly * vx) / len;
    w.push(Math.round(t * 1000) / 1000);
    d.push(Math.round(dist * 10) / 10);
  }
  if (!w.length) return null;
  return { w, d };
}

/** Wrap a path-ish label that has no spaces to break on. */
export function wrapLabel(s, width = 23, maxLines = 2) {
  s = String(s || '');
  if (s.length <= width) return s;
  const lines = [];
  let rest = s;
  while (rest.length > width && lines.length < maxLines - 1) {
    let cut = rest.lastIndexOf('/', width);
    if (cut < width * 0.3) cut = width;
    else cut += 1;
    lines.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest.length > width) rest = '…' + rest.slice(-(width - 1));
  lines.push(rest);
  return lines.join('\n');
}

/** Graphviz honours `rank=same` for the columns of a gridded cluster but then
 *  staggers rows to make room for edge splines -- 60 forks came back with 8
 *  distinct x values and 50 distinct y values. Snap them back onto the grid
 *  Graphviz was told to build. Returns the set of ids that were moved. */
export function regularizeGrids(nodes, rowH = 80) {
  const cols = {};
  const moved = new Set();
  for (const [id, n] of Object.entries(nodes)) {
    if (!n.grid) continue;
    (cols[n.grid.c] ||= []).push([id, n]);
    moved.add(id);
  }
  if (!moved.size) return moved;
  const ys = [...moved].map((id) => nodes[id].y);
  const top = Math.min(...ys), oldBottom = Math.max(...ys);
  let newBottom = top;
  for (const list of Object.values(cols)) {
    const xs = list.map(([, n]) => n.x).sort((a, b) => a - b);
    const x = xs[Math.floor(xs.length / 2)];
    for (const [, n] of list) {
      n.x = x; n.y = top + n.grid.r * rowH;
      newBottom = Math.max(newBottom, n.y);
    }
  }
  // Snapping collapses the block's height; pull everything that Graphviz put
  // below it up by the same amount, or the map is mostly whitespace.
  const delta = oldBottom - newBottom;
  if (delta > 1) {
    for (const [id, n] of Object.entries(nodes)) {
      if (!moved.has(id) && n.y > oldBottom) n.y -= delta;
    }
  }
  return moved;
}

// ------------------------------------------------------------- element model



export function nodeClasses(n) {
  const c = [];
  if (n.type === 'host') {
    c.push('host', 'cluster', 'hk-' + (n.host_kind || 'host'));
  } else {
    c.push('dist');
    if (n.layout) c.push('lay-' + n.layout);
    if (n.vcs === 'none') c.push('special');
    if (n.is_seed) c.push('seed');
    if (n.trust === 'dead') c.push('dead');
    if (n.inactive) c.push('inactive');
    if (n.is_upstream) c.push('upstream');
    if (n.is_template) c.push('template');
    if (n.role) c.push('role-' + n.role);
    if (n.result_branch && !n.merged) c.push('unmerged');
  }
  return c;
}

export function chipsFor(n) {
  const chips = [];
  if (n.type === 'host') return chips;
  if (n.layout && n.layout !== 'worktree') chips.push(n.layout);
  if (n.layout === 'worktree') chips.push('worktree');
  if (n.special_remote_type) chips.push(n.special_remote_type);
  if (n.annex_mode && n.annex_mode !== 'none' && n.annex_mode !== 'keystore') chips.push(n.annex_mode);
  if (n.annex_mode === 'none') chips.push('plain git');
  if (n.branch) chips.push(n.branch);
  if (n.result_branch) chips.push(n.merged ? 'merged' : 'UNMERGED');
  if (n.trust === 'dead') chips.push('DEAD');
  if (typeof n.ahead_of_upstream === 'number') {
    chips.push(n.ahead_of_upstream === 0 ? 'nothing new' : `▲${n.ahead_of_upstream} upstream`);
  }
  if (n.stars) chips.push('★' + n.stars);
  return chips;
}

export function edgeLabel(e) {
  const bits = [];
  if (e.remote_name) bits.push(e.remote_name);
  else if (e.kind === 'remote') bits.push('(url only)');
  else bits.push(e.kind.replace(/_/g, ' '));
  const ab = [];
  if (e.ahead) ab.push('▲' + e.ahead);
  if (e.behind) ab.push('▼' + e.behind);
  if (ab.length) bits.push(ab.join(' '));
  if (typeof e.confidence === 'number') bits.push(`conf ${e.confidence.toFixed(2)}`);
  else if (typeof e.containment === 'number') bits.push(`cont ${e.containment.toFixed(2)}`);
  return bits.join('  ');
}

/** Redundant with the compound box: an edge that only restates `parent`. */
export function isContainmentEdge(e, byId) {
  const t = byId[e.target];
  return t && t.parent === e.source;
}

export function buildElements(model, { mode = 'map', dupUuids = new Set() } = {}) {
  const byId = Object.fromEntries(model.nodes.map((n) => [n.id, n]));
  const visible = new Set(model.nodes.map((n) => n.id));
  const els = [];
  const lineage = mode === 'lineage';

  for (const n of model.nodes) {
    if (lineage && n.type === 'host') continue;   // layers, not clusters
    const cls = nodeClasses(n);
    if (n.annex_uuid && dupUuids.has(n.annex_uuid)) cls.push('dup-uuid');
    const hasKids = model.nodes.some((m) => m.parent === n.id);
    if (hasKids) cls.push('container');
    els.push({
      group: 'nodes',
      data: {
        id: n.id,
        parent: !lineage && n.parent && visible.has(n.parent) ? n.parent : undefined,
        label: n.label || n.id,
        short: wrapLabel(n.label || n.id),
        chips: chipsFor(n).join(' · '),
        raw: n,
        expandable: Object.entries(n.rel_counts || {})
          .map(([k, v]) => `${k}:${v}`).join(','),
      },
      classes: cls.join(' '),
    });
  }

  // A fan of >=10 identically-named edges into one target (40 `origin`
  // remotes from a RIA store into the superdataset) is a bundle: label it
  // once, not forty times.
  const fan = {};
  for (const e of model.edges) {
    const k = e.target + '|' + e.kind + '|' + (e.remote_name || '');
    fan[k] = (fan[k] || 0) + 1;
  }

  const LINEAGE_KINDS = new Set(['fork_of', 'remote', 'worktree_of', 'shares_history_with',
    'candidate_same_as', 'same_annex_uuid']);
  for (const e of model.edges) {
    if (!visible.has(e.source) || !visible.has(e.target)) continue;
    if (isContainmentEdge(e, byId)) continue;
    if (lineage && !LINEAGE_KINDS.has(e.kind)) continue;
    const cls = ['k-' + e.kind];
    if (e.resolution === 'url-only') cls.push('url-only');
    if (e.resolution === 'conflict') cls.push('conflict');
    if (e.verdict) cls.push('verdict-' + e.verdict);
    if (byId[e.source] && byId[e.source].inactive) cls.push('inactive');
    if (fan[e.target + '|' + e.kind + '|' + (e.remote_name || '')] >= 10) cls.push('bundled');
    els.push({
      group: 'edges',
      data: { id: e.id, source: e.source, target: e.target, label: edgeLabel(e), raw: e },
      classes: cls.join(' '),
    });
  }
  return els;
}

export function duplicateUuids(nodes) {
  const seen = new Map();
  const dup = new Set();
  for (const n of nodes) {
    if (!n.annex_uuid) continue;
    if (seen.has(n.annex_uuid)) dup.add(n.annex_uuid);
    seen.set(n.annex_uuid, n.id);
  }
  return dup;
}

// -------------------------------------------------------------------- style

export function cyStyle(theme) {
  const p = PALETTES[theme] || PALETTES.dark;
  return [
    { selector: 'node', style: {
      'background-color': p.nodeFill, 'border-color': p.nodeBorder, 'border-width': 1.5,
      shape: 'round-rectangle', width: 188, height: 54,
      label: 'data(short)', color: p.nodeText,
      'font-family': 'ui-monospace, SFMono-Regular, Menlo, monospace', 'font-size': 11,
      'text-valign': 'center', 'text-halign': 'center', 'text-wrap': 'wrap',
      'text-max-width': 176, 'text-margin-y': -7,
      'min-zoomed-font-size': 6,
    }},
    { selector: 'node.dist', style: {
      label: (n) => {
        const c = n.data('chips');
        return n.data('short') + (c ? '\n' + c : '');
      },
      'text-margin-y': 0, 'line-height': 1.35,
    }},
    { selector: 'node.cluster', style: {
      'background-color': p.clusterFill, 'background-opacity': 1,
      'border-color': p.clusterBorder, 'border-width': 1.5, 'border-style': 'solid',
      shape: 'round-rectangle', padding: 22,
      label: 'data(label)', color: p.clusterText, 'font-size': 13, 'font-weight': 'bold',
      'font-family': 'ui-sans-serif, system-ui, sans-serif',
      'text-valign': 'top', 'text-halign': 'center', 'text-margin-y': 10,
    }},
    { selector: 'node.dist.container', style: {
      'background-color': p.clusterFill, 'background-opacity': 1, padding: 20,
      'border-color': p.store, 'border-width': 1.5, 'border-style': 'dashed',
      label: 'data(label)', color: p.store, 'font-size': 12, 'font-weight': 'bold',
      'text-valign': 'top', 'text-margin-y': 9,
      'font-family': 'ui-sans-serif, system-ui, sans-serif',
    }},
    { selector: 'node.hk-forge', style: { 'border-color': p.forge, color: p.forge } },
    { selector: 'node.hk-cloud', style: { 'border-color': p.cloud, color: p.cloud } },
    { selector: 'node.hk-store', style: { 'border-color': p.store, color: p.store } },
    { selector: 'node.seed', style: {
      'border-color': p.seed, 'border-width': 3, 'background-color': p.seedFill, color: p.nodeText,
    }},
    { selector: 'node.special', style: { 'border-style': 'dashed', 'border-color': p.special } },
    { selector: 'node.lay-bare', style: { shape: 'cut-rectangle' } },
    { selector: 'node.lay-ria-store', style: { 'border-color': p.store } },
    { selector: 'node.dead', style: { 'border-color': p.dead, color: p.nodeSub, opacity: 0.65 } },
    { selector: 'node.inactive', style: {
      'background-color': p.inactive, 'border-color': p.inactiveBorder,
      color: p.inactiveText, 'border-width': 1,
    }},
    { selector: 'node.upstream', style: { 'border-color': p.seed, 'border-width': 2.5 } },
    { selector: 'node.template', style: { 'border-style': 'dotted', 'border-color': p.candidate } },
    { selector: 'node.role-result-branch', style: { width: 172, height: 48, 'font-size': 10 } },
    { selector: 'node.dup-uuid', style: {
      'border-color': p.err, 'border-width': 4, 'background-color': p.errFill,
      'border-style': 'double', color: p.nodeText,
    }},
    { selector: 'node.unmerged', style: { 'border-color': p.warn, 'border-width': 2.5 } },
    { selector: 'node.unexpanded', style: { 'border-style': 'dashed' } },
    { selector: 'node:selected', style: { 'overlay-color': p.seed, 'overlay-opacity': 0.25, 'overlay-padding': 6 } },
    { selector: 'node.dimmed', style: { opacity: 0.18 } },

    { selector: 'edge', style: {
      width: 1.6, 'line-color': p.edge, 'target-arrow-color': p.edge,
      'target-arrow-shape': 'triangle', 'arrow-scale': 0.85,
      'curve-style': 'bezier', 'control-point-step-size': 42,
      label: 'data(label)', color: p.edgeText, 'font-size': 10,
      'font-family': 'ui-monospace, SFMono-Regular, Menlo, monospace',
      'text-background-color': p.edgeLabelBg, 'text-background-opacity': 0.92,
      'text-background-padding': 2.5, 'text-background-shape': 'roundrectangle',
      'text-rotation': 'autorotate', 'min-zoomed-font-size': 7,
      'text-events': 'yes',
    }},
    { selector: 'edge.routed', style: {
      'curve-style': 'segments', 'segment-distances': 'data(segD)', 'segment-weights': 'data(segW)',
      'segment-radii': 8, 'radius-type': 'arc-radius',
    }},
    { selector: 'edge.url-only', style: { 'line-style': 'dashed', opacity: 0.75 } },
    { selector: 'edge.k-fork_of', style: {
      'line-color': p.forge, 'target-arrow-color': p.forge, width: 1.2, label: '',
    }},
    { selector: 'edge.k-fork_of.inactive', style: { opacity: 0.28, width: 0.8 } },
    { selector: 'edge.k-worktree_of', style: {
      'line-color': p.ok, 'target-arrow-color': p.ok, 'line-style': 'dotted', width: 2,
    }},
    { selector: 'edge.k-same_annex_uuid', style: {
      'line-color': p.err, 'target-arrow-color': p.err, 'source-arrow-color': p.err,
      'source-arrow-shape': 'triangle', width: 3.5, 'line-style': 'solid', label: 'same annex UUID',
      color: p.err, 'font-weight': 'bold', 'z-index': 99,
      'text-background-color': p.errFill, 'text-background-opacity': 1, 'text-background-padding': 4,
      'text-border-color': p.err, 'text-border-width': 1, 'text-border-opacity': 1,
    }},
    { selector: 'edge.k-candidate_same_as', style: {
      'line-color': p.candidate, 'target-arrow-color': p.candidate, 'line-style': 'dashed', width: 2.4,
    }},
    { selector: 'edge.verdict-rejected', style: {
      'line-color': p.warn, 'target-arrow-color': p.warn, 'target-arrow-shape': 'tee',
    }},
    { selector: 'edge.k-shares_history_with', style: {
      'line-color': p.candidate, 'target-arrow-color': p.candidate, 'line-style': 'dotted', width: 1.6,
    }},
    { selector: 'edge.k-part, edge.k-subdataset', style: { 'line-style': 'dashed', opacity: 0.6 } },
    { selector: 'edge.bundled', style: { label: '', width: 0.9, opacity: 0.4 } },
    { selector: 'edge:selected', style: { width: 4, 'line-color': p.seed, 'target-arrow-color': p.seed } },
    { selector: 'edge.dimmed', style: { opacity: 0.08, label: '' } },
    { selector: '.hl', style: { 'overlay-color': p.seed, 'overlay-opacity': 0.3, 'overlay-padding': 8 } },
  ];
}

export function makeCy(container, theme) {
  return cytoscape({
    container,
    style: cyStyle(theme),
    wheelSensitivity: 0.2,
    minZoom: 0.06,
    maxZoom: 3,
    boxSelectionEnabled: false,
  });
}

/** Apply preset positions to leaf nodes (compound boxes are derived). */
export function applyPositions(cy, positions) {
  cy.batch(() => {
    cy.nodes().forEach((n) => {
      const p = positions[n.id()];
      if (p && !n.isParent()) n.position({ x: p.x, y: p.y });
    });
  });
}

/** Attach Graphviz spline waypoints to the live cytoscape edges. */
export function applyRoutes(cy, gvEdges, posMap = {}, gridded = new Set()) {
  const routes = {};
  const at = (n) => posMap[n.id()] || n.position();
  cy.batch(() => {
    cy.edges().forEach((e) => {
      const rec = gvEdges[e.id()];
      // A compound node's cytoscape position is the centre of its children's
      // bounding box, not the Graphviz anchor point, so replaying Graphviz
      // waypoints relative to it produces wild detours. Bezier those.
      // Nodes we snapped onto a grid no longer sit where Graphviz put them,
      // so its waypoints for their edges are meaningless.
      const compound = e.source().isParent() || e.target().isParent()
        || gridded.has(e.source().id()) || gridded.has(e.target().id());
      // Use the *final* coordinates, not the live ones: during an animated
      // relayout the nodes are still sitting at their old positions.
      const r = !compound && rec && routeFor(at(e.source()), at(e.target()), rec.points);
      if (!r) { e.removeClass('routed'); return; }
      e.data('segW', r.w.join(' '));
      e.data('segD', r.d.join(' '));
      e.addClass('routed');
      routes[e.id()] = r.w.join(' ') + '|' + r.d.join(' ');
    });
  });
  return routes;
}

/** Re-attach routes saved in a view file (used by the offline export). */
export function applySavedRoutes(cy, routes) {
  if (!routes) return;
  cy.batch(() => {
    cy.edges().forEach((e) => {
      const s = routes[e.id()];
      if (!s) return;
      const [w, d] = s.split('|');
      if (!w || !d) return;
      e.data('segW', w); e.data('segD', d); e.addClass('routed');
    });
  });
}

/** Median displacement of nodes that already had a position: layout churn. */
export function layoutChurn(before, after) {
  const d = [];
  for (const [id, p] of Object.entries(before)) {
    const q = after[id];
    if (!q) continue;
    d.push(Math.hypot(q.x - p.x, q.y - p.y));
  }
  if (!d.length) return null;
  d.sort((a, b) => a - b);
  return {
    n: d.length,
    median: Math.round(d[Math.floor(d.length / 2)]),
    max: Math.round(d[d.length - 1]),
    moved: d.filter((v) => v > 4).length,
  };
}
