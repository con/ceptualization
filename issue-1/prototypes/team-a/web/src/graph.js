import cytoscape from 'cytoscape';
import fcose from 'cytoscape-fcose';
import layoutUtilities from 'cytoscape-layout-utilities';
import nodeHtmlLabel from 'cytoscape-node-html-label';

import { buildStyle } from './cy-style.js';
import { toNodeEl, toEdgeEl, sortByDepth, shorten } from './model.js';

cytoscape.use(fcose);
cytoscape.use(layoutUtilities);

export const badgeBackend = { name: 'none', error: null };
try {
  nodeHtmlLabel(cytoscape);
  badgeBackend.name = 'cytoscape-node-html-label';
} catch (err) {
  badgeBackend.error = String(err);
}

export const S = {
  cy: null,
  lu: null,
  scenario: null,
  meta: null,
  frontier: {},
  findings: [],
  known: { nodes: new Set(), edges: new Set() },
  pin: true,
  separate: true,
  probing: new Set(),
  metrics: {
    firstRenderMs: null,
    expansions: [],
    relayouts: []
  },
  hooks: { onChange: () => {}, onLog: () => {}, onToast: () => {} }
};

const FCOSE_BASE = {
  name: 'fcose',
  quality: 'proof',
  nodeDimensionsIncludeLabels: true,
  uniformNodeDimensions: false,
  packComponents: true,
  nodeRepulsion: 9000,
  idealEdgeLength: (e) => (e.data('kind') === 'part' ? 45 : 95),
  edgeElasticity: 0.45,
  nestingFactor: 0.1,
  gravity: 0.28,
  gravityRange: 3.8,
  gravityCompound: 1.4,
  gravityRangeCompound: 1.5,
  numIter: 2500,
  tile: true,
  tilingPaddingVertical: 8,
  tilingPaddingHorizontal: 8,
  padding: 40
};

// ---------------------------------------------------------------- init ------

export function initCy(container) {
  const cy = cytoscape({
    container,
    style: buildStyle(),
    wheelSensitivity: 0.25,
    minZoom: 0.08,
    maxZoom: 3.2,
    boxSelectionEnabled: false,
    textureOnViewport: false,
    pixelRatio: 1
  });
  S.cy = cy;
  try {
    S.lu = cy.layoutUtilities({ desiredAspectRatio: 1.4, idealEdgeLength: 95, offset: 30 });
  } catch (err) {
    S.lu = null;
    badgeBackend.luError = String(err);
  }
  installBadges(cy);
  return cy;
}

export function restyle() {
  // NOTE: `cy.style(arr)` on a populated graph silently drops the edge rules in
  // cytoscape 3.34 (every edge falls back to the default width of 30). Going
  // through the style object's own fromJson()/update() is the working path.
  S.cy.style().fromJson(buildStyle()).update();
}

// ---------------------------------------------------------------- badges ----

function badgeHtml(d) {
  // node-html-label draws its div regardless of the node's `display`, so hidden
  // nodes would leave their badges floating in space. Gate on the filter flag.
  if (d._off) return '';
  const out = [];
  if (S.probing.has(d.id)) {
    out.push('<span class="badge badge-probing"><span class="spinner"></span>probing…</span>');
  }
  if (d.is_seed) out.push('<span class="badge badge-seed">SEED</span>');
  if (d._severity === 'error') out.push('<span class="badge badge-err">! ERROR</span>');
  else if (d._severity === 'warning') out.push('<span class="badge badge-warn">! WARN</span>');
  if (d.merged === false) out.push('<span class="badge badge-warn">unmerged</span>');
  if (d._ahead) out.push(`<span class="badge badge-ahead">▲${d._ahead}</span>`);
  if (d._behind) out.push(`<span class="badge badge-behind">▼${d._behind}</span>`);
  if (d._hidden > 0) out.push(`<span class="badge badge-hidden">+${d._hidden}</span>`);
  if (!out.length) return '';
  return `<div class="badge-stack">${out.join('')}</div>`;
}

function installBadges(cy) {
  if (badgeBackend.name !== 'cytoscape-node-html-label') return;
  try {
    cy.nodeHtmlLabel([
      {
        query: 'node',
        halign: 'right',
        valign: 'top',
        halignBox: 'right',
        valignBox: 'top',
        cssClass: 'cy-overlay',
        tpl: badgeHtml
      }
    ]);
  } catch (err) {
    badgeBackend.name = 'none';
    badgeBackend.error = String(err);
  }
}

function refreshBadges() {
  // node-html-label re-renders on style/position events; touching data is enough.
  S.cy.nodes().forEach((n) => n.trigger('data'));
  S.cy.emit('render');
}

// ------------------------------------------------------- derived node data --

export function recomputeDerived() {
  const cy = S.cy;
  cy.batch(() => {
    cy.nodes().forEach((n) => {
      const f = S.frontier[n.id()];
      n.data('_hidden', f ? f.hidden : 0);
      if (!f || f.hidden === 0) {
        n.removeClass('unexpanded').addClass('expanded');
      } else {
        n.removeClass('expanded').addClass('unexpanded');
      }
      let ahead = 0;
      let behind = 0;
      n.connectedEdges('[kind = "remote"], [kind = "worktree_of"]').forEach((e) => {
        if (e.data('source') === n.id()) {
          ahead = Math.max(ahead, e.data('ahead') || 0);
          behind = Math.max(behind, e.data('behind') || 0);
        }
      });
      n.data('_ahead', ahead);
      n.data('_behind', behind);
    });
    cy.edges().removeClass('inactive');
    cy.nodes('.inactive').connectedEdges().addClass('inactive');
  });
  refreshBadges();
}

export function applyFindings(findings) {
  S.findings = findings || [];
  const cy = S.cy;
  cy.nodes().removeClass('finding-error finding-warning pulse');
  cy.nodes().forEach((n) => n.data('_severity', null));
  for (const f of S.findings) {
    for (const id of f.nodes || []) {
      const n = cy.$id(id);
      if (n.length === 0) continue;
      if (f.severity === 'error') {
        n.addClass('finding-error pulse');
        n.data('_severity', 'error');
      } else if (f.severity === 'warning') {
        if (n.data('_severity') !== 'error') {
          n.addClass('finding-warning');
          n.data('_severity', 'warning');
        }
      }
    }
  }
  refreshBadges();
}

export function findingState(f) {
  const present = (f.nodes || []).filter((id) => S.cy.$id(id).length > 0);
  return { present, total: (f.nodes || []).length };
}

// ---------------------------------------------------------------- layout ----

function positionsOf(nodes) {
  const m = new Map();
  nodes.forEach((n) => {
    const p = n.position();
    m.set(n.id(), { x: p.x, y: p.y });
  });
  return m;
}

function stats(arr) {
  if (!arr.length) return { n: 0, mean: 0, max: 0, p95: 0 };
  const d = [...arr].sort((a, b) => a - b);
  return {
    n: d.length,
    mean: +(d.reduce((a, b) => a + b, 0) / d.length).toFixed(2),
    max: +d[d.length - 1].toFixed(2),
    p95: +d[Math.floor(d.length * 0.95)].toFixed(2)
  };
}

/** How far did the world move under the user?
 *
 * Split deliberately: fCoSE's `fixedNodeConstraint` cannot pin a *compound*
 * node, so a leaf that becomes a container during this very expansion is not
 * pinnable and will move. Lumping the two together would flatter the numbers in
 * one direction and slander them in the other, so both are reported.
 */
function displacement(before) {
  const stayedLeaf = [];
  const becameParent = [];
  before.forEach((p, id) => {
    const n = S.cy.$id(id);
    if (n.length === 0) return;
    const q = n.position();
    const dist = Math.hypot(q.x - p.x, q.y - p.y);
    (n.isParent() ? becameParent : stayedLeaf).push(dist);
  });
  const all = stats([...stayedLeaf, ...becameParent]);
  return { ...all, leaf: stats(stayedLeaf), newParents: stats(becameParent) };
}

function frameSampler() {
  let frames = 0;
  let longest = 0;
  let last = performance.now();
  let running = true;
  const tick = (t) => {
    if (!running) return;
    frames++;
    longest = Math.max(longest, t - last);
    last = t;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return {
    stop(elapsedMs) {
      running = false;
      return {
        frames,
        fps: elapsedMs > 0 ? +((frames / elapsedMs) * 1000).toFixed(1) : 0,
        longestFrameMs: +longest.toFixed(1)
      };
    }
  };
}

export function runLayout({ pin = true, fit = false, animate = true, eles = null } = {}) {
  const cy = S.cy;
  const opts = { ...FCOSE_BASE, animate, animationDuration: animate ? 450 : 0, fit, randomize: !pin };
  if (pin) {
    opts.randomize = false;
    opts.quality = 'proof';
    opts.fixedNodeConstraint = cy
      .nodes()
      .filter((n) => !n.isParent() && !n.hasClass('just-added') && n.visible())
      .map((n) => ({ nodeId: n.id(), position: { ...n.position() } }));
    if (opts.fixedNodeConstraint.length === 0) delete opts.fixedNodeConstraint;
  }
  const target = eles || cy.elements().filter((e) => e.visible());
  return new Promise((resolve) => {
    const l = target.layout(opts);
    l.one('layoutstop', () => resolve());
    l.run();
  });
}

// ------------------------------------------------- container separation -----

/** Rigid-box separation of top-level containers.
 *
 * fCoSE with every placed node pinned cannot resolve a *compound* that grew and
 * now overlaps its neighbour, because the fix would require moving pinned nodes.
 * So we move whole hosts as rigid bodies instead: the geometry *inside* a host is
 * bit-for-bit preserved (relative displacement 0), only the host boxes slide
 * apart. That keeps far more of the mental map than a full re-layout does.
 */
export function separateContainers({ gap = 30, maxIter = 60, animate = true } = {}) {
  const cy = S.cy;
  const tops = cy
    .nodes()
    .filter((n) => n.isParent() && n.parent().empty() && n.visible());
  if (tops.length < 2) return { moved: 0, iterations: 0, maxShift: 0 };

  const boxes = tops.map((n) => {
    const bb = n.boundingBox({ includeLabels: false, includeOverlays: false });
    return { id: n.id(), x1: bb.x1, y1: bb.y1, x2: bb.x2, y2: bb.y2, dx: 0, dy: 0 };
  });

  let iterations = 0;
  for (let it = 0; it < maxIter; it++) {
    let moved = false;
    iterations = it + 1;
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        const ox = Math.min(a.x2 + a.dx, b.x2 + b.dx) - Math.max(a.x1 + a.dx, b.x1 + b.dx) + gap;
        const oy = Math.min(a.y2 + a.dy, b.y2 + b.dy) - Math.max(a.y1 + a.dy, b.y1 + b.dy) + gap;
        if (ox <= 0 || oy <= 0) continue;
        moved = true;
        const acx = (a.x1 + a.x2) / 2 + a.dx;
        const bcx = (b.x1 + b.x2) / 2 + b.dx;
        const acy = (a.y1 + a.y2) / 2 + a.dy;
        const bcy = (b.y1 + b.y2) / 2 + b.dy;
        if (ox < oy) {
          const s = (ox / 2) * (acx <= bcx ? -1 : 1);
          a.dx += s;
          b.dx -= s;
        } else {
          const s = (oy / 2) * (acy <= bcy ? -1 : 1);
          a.dy += s;
          b.dy -= s;
        }
      }
    }
    if (!moved) break;
  }

  const shifts = boxes.filter((b) => Math.hypot(b.dx, b.dy) > 0.5);
  if (!shifts.length) return { moved: 0, iterations, maxShift: 0 };

  const apply = () => {
    cy.batch(() => {
      shifts.forEach((b) => {
        const parent = cy.$id(b.id);
        parent.descendants().forEach((n) => {
          const p = n.position();
          n.position({ x: p.x + b.dx, y: p.y + b.dy });
        });
      });
    });
  };
  apply();
  void animate;
  return {
    moved: shifts.length,
    iterations,
    maxShift: +Math.max(...shifts.map((b) => Math.hypot(b.dx, b.dy))).toFixed(1)
  };
}

/** Do any two top-level containers currently overlap? (drives the HUD hint) */
export function containerOverlaps() {
  const cy = S.cy;
  const tops = cy.nodes().filter((n) => n.isParent() && n.parent().empty() && n.visible());
  let count = 0;
  for (let i = 0; i < tops.length; i++) {
    for (let j = i + 1; j < tops.length; j++) {
      const a = tops[i].boundingBox({ includeLabels: false });
      const b = tops[j].boundingBox({ includeLabels: false });
      if (a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2) count++;
    }
  }
  return count;
}

// ------------------------------------------------------------- expansion ----

function addElements(nodes, edges) {
  const cy = S.cy;
  const added = { nodes: [], edges: [] };
  cy.batch(() => {
    for (const n of sortByDepth(nodes)) {
      if (cy.$id(n.id).length) continue;
      const el = toNodeEl(n);
      if (el.data.parent && cy.$id(el.data.parent).length === 0) delete el.data.parent;
      added.nodes.push(cy.add(el));
      S.known.nodes.add(n.id);
    }
    for (const e of edges) {
      if (cy.$id(e.id).length) continue;
      if (cy.$id(e.source).length === 0 || cy.$id(e.target).length === 0) continue;
      const ee = cy.add(toEdgeEl(e));
      // The nesting already draws containment; the edge is redundant ink.
      if (cy.$id(e.target).data('parent') === e.source) ee.addClass('containment');
      added.edges.push(ee);
      S.known.edges.add(e.id);
    }
  });
  return added;
}

/** Seed new nodes near their anchor before the incremental layout runs. */
function placeNewNodes(newNodes, anchorId) {
  const cy = S.cy;
  const anchor = cy.$id(anchorId);
  const leafs = newNodes.filter((n) => !n.isParent());
  if (!leafs.length) return 'none';
  const base = anchor.length ? anchor.position() : { x: 0, y: 0 };
  // deterministic fallback ring, always applied first so nothing sits at (0,0)
  const R = 120 + Math.min(260, leafs.length * 7);
  leafs.forEach((n, i) => {
    const a = (2 * Math.PI * i) / leafs.length + 0.4;
    n.position({ x: base.x + R * Math.cos(a), y: base.y + R * Math.sin(a) });
  });
  if (!S.lu) return 'ring-fallback';
  try {
    const coll = cy.collection(leafs);
    S.lu.placeNewNodes(coll);
    return 'layout-utilities';
  } catch (err) {
    return 'ring-fallback(' + String(err).slice(0, 60) + ')';
  }
}

/** Two-tier layout: a container that just received a crowd of near-identical
 *  children (the 40 per-subject repos of the RIA store) gets an internal grid
 *  instead of a force layout. It is compact, deterministic, and — because the
 *  children are then un-marked as new — fCoSE pins them and never reshuffles
 *  them on later expansions.
 */
function tileLargeSiblingSets(newCol, threshold = 12) {
  const groups = new Map();
  newCol.forEach((n) => {
    const p = n.data('parent');
    if (!p) return;
    if (!groups.has(p)) groups.set(p, []);
    groups.get(p).push(n);
  });
  let note = '';
  groups.forEach((kids, pid) => {
    if (kids.length < threshold) return;
    const parent = S.cy.$id(pid);
    if (parent.length === 0) return;
    const col = S.cy.collection(kids);
    // outerWidth() can still be stale right after cy.add(), so take the larger of
    // the measured width and a monospace estimate from the label.
    const w =
      Math.max(
        ...kids.map((k) =>
          Math.max(k.outerWidth(), String(k.data('label') || '').length * 6.8 + 20)
        )
      ) + 46; // room for the badge stack
    const h = 30;
    const cols = Math.max(1, Math.round(Math.sqrt(kids.length * 1.9)));
    const rows = Math.ceil(kids.length / cols);
    const centre = parent.position();
    col.layout({
      name: 'grid',
      rows,
      cols,
      fit: false,
      animate: false,
      avoidOverlap: true,
      avoidOverlapPadding: 14,
      boundingBox: {
        x1: centre.x - (cols * w) / 2,
        y1: centre.y - (rows * h) / 2,
        w: cols * w,
        h: rows * h
      }
    }).run();
    col.removeClass('just-added'); // -> pinned by the fCoSE pass that follows
    note += ` +grid(${kids.length} in ${pid})`;
  });
  return note;
}

export async function expand(nodeId, relation, api) {
  const cy = S.cy;
  const key = `${nodeId}|${relation}`;
  if (S.probing.has(nodeId)) return null;
  S.probing.add(nodeId);
  cy.$id(nodeId).addClass('probing');
  refreshBadges();
  S.hooks.onToast(`probing ${shorten(cy.$id(nodeId).data('fullLabel') || nodeId, 28)} · ${relation}`, true);

  const t0 = performance.now();
  let res;
  try {
    res = await api.expand({
      scenario: S.scenario,
      node_id: nodeId,
      relation,
      known_nodes: [...S.known.nodes],
      known_edges: [...S.known.edges]
    });
  } finally {
    S.probing.delete(nodeId);
    cy.$id(nodeId).removeClass('probing');
    S.hooks.onToast(null);
  }
  const netMs = performance.now() - t0;

  const before = positionsOf(cy.nodes().filter((n) => !n.isParent()));
  const added = addElements(res.nodes, res.edges);
  const newNodeCol = added.nodes.map((c) => c[0] ?? c).filter(Boolean);
  const newCol = cy.collection(newNodeCol);
  newCol.addClass('just-added');

  reapplyFilters();
  let placement = placeNewNodes(newNodeCol, nodeId);
  placement += tileLargeSiblingSets(newCol);

  const sampler = frameSampler();
  const tl0 = performance.now();
  await runLayout({ pin: S.pin, fit: false, animate: true });
  const layoutMs = performance.now() - tl0;
  const frames = sampler.stop(layoutMs);
  const dispLayout = displacement(before);
  const separation = S.separate ? separateContainers() : { moved: 0, maxShift: 0 };

  newCol.removeClass('just-added');
  S.frontier = res.frontier || {};
  recomputeDerived();
  applyFindings(S.findings);
  reapplyFilters();

  const disp = displacement(before);
  const rec = {
    separation,
    displacementBeforeSeparation: dispLayout,
    overlaps: containerOverlaps(),
    key,
    node: nodeId,
    relation,
    latencyMs: Math.round(res.latency_ms ?? netMs),
    netMs: Math.round(netMs),
    layoutMs: Math.round(layoutMs),
    newNodes: res.nodes.length,
    newEdges: res.edges.length,
    graphNodes: cy.nodes().length,
    graphEdges: cy.edges().length,
    pinned: S.pin,
    placement,
    displacement: disp,
    frames
  };
  S.metrics.expansions.push(rec);
  S.hooks.onLog(rec);
  S.hooks.onChange();
  panToNew(newCol);
  return rec;
}

function panToNew(col) {
  if (col.length === 0) return;
  const cy = S.cy;
  const ext = cy.extent();
  const bb = col.boundingBox();
  const inside =
    bb.x1 > ext.x1 && bb.x2 < ext.x2 && bb.y1 > ext.y1 && bb.y2 < ext.y2;
  if (inside) return; // "fit to new, not fit to all" — do not move the viewport needlessly
  cy.animate({ fit: { eles: cy.elements().filter((e) => e.visible()), padding: 70 }, duration: 350 });
}

/** Probe every relation that still has hidden edges on this node, sequentially. */
export async function expandAll(nodeId, api) {
  const f = S.frontier[nodeId];
  if (!f) return [];
  const out = [];
  for (const r of f.relations.filter((r) => r.hidden > 0)) {
    const rec = await expand(nodeId, r.key, api);
    if (rec) out.push(rec);
  }
  return out;
}

// ------------------------------------------------- full unpinned re-layout --

export async function fullRelayout() {
  const cy = S.cy;
  const before = positionsOf(cy.nodes().filter((n) => !n.isParent()));
  const sampler = frameSampler();
  const t0 = performance.now();
  await runLayout({ pin: false, fit: true, animate: true });
  const ms = performance.now() - t0;
  const frames = sampler.stop(ms);
  const rec = {
    ms: Math.round(ms),
    displacement: displacement(before),
    frames,
    graphNodes: cy.nodes().length
  };
  S.metrics.relayouts.push(rec);
  S.hooks.onLog({ relayout: rec });
  return rec;
}

// ------------------------------------------------------------ collapse ------

export function toggleCollapse(node) {
  if (!node.isParent() && !node.hasClass('collapsed')) return;
  if (node.hasClass('collapsed')) {
    node.removeClass('collapsed');
    const kids = S.cy.nodes(`[parent = "${node.id()}"]`);
    node.data('_stash').forEach((id) => S.cy.$id(id).removeClass('collapsed-hidden'));
    S.cy.edges('.meta').filter((e) => e.data('metaParent') === node.id()).remove();
    node.removeData('_stash');
    node.removeStyle('width height');
    node.data('label', node.data('fullLabel') || node.data('label'));
    void kids;
  } else {
    const desc = node.descendants();
    if (desc.length === 0) return;
    const ids = desc.map((n) => n.id());
    node.data('_stash', ids);
    const buckets = new Map();
    const inner = new Set([node.id(), ...node.ancestors().map((a) => a.id()), ...ids]);
    desc.connectedEdges().forEach((e) => {
      if (e.hasClass('containment')) return; // nesting already said this
      const s = e.source();
      const t = e.target();
      const sIn = ids.includes(s.id());
      const tIn = ids.includes(t.id());
      if (sIn && tIn) return;
      const other = sIn ? t : s;
      if (inner.has(other.id())) return;
      const k = `${other.id()}|${sIn ? 'out' : 'in'}|${e.data('kind')}`;
      const b = buckets.get(k) || { other: other.id(), dir: sIn ? 'out' : 'in', kind: e.data('kind'), n: 0 };
      b.n++;
      buckets.set(k, b);
    });
    desc.addClass('collapsed-hidden');
    node.addClass('collapsed');
    node.style({ width: 210, height: 44 });
    const unmerged = desc.filter((n) => n.data('merged') === false).length;
    node.data(
      'label',
      `${node.data('fullLabel') || node.data('label')}  ▸ ${desc.length} collapsed${unmerged ? ` · ${unmerged} unmerged` : ''}`
    );
    buckets.forEach((b, k) => {
      S.cy.add({
        group: 'edges',
        data: {
          id: `meta:${node.id()}:${k}`,
          source: b.dir === 'out' ? node.id() : b.other,
          target: b.dir === 'out' ? b.other : node.id(),
          kind: b.kind,
          metaParent: node.id(),
          edgeLabel: `${b.n}× ${b.kind}`
        },
        classes: 'meta'
      });
    });
  }
  reapplyFilters();
  recomputeDerived();
}

// -------------------------------------------------------------- filters -----

export const filters = { hideInactive: false, showContainmentEdges: false, showInactiveEdges: false };

export function reapplyFilters() {
  const cy = S.cy;
  cy.batch(() => {
    cy.elements().removeClass('hidden-filter');
    cy.nodes('.collapsed-hidden').addClass('hidden-filter');
    cy.nodes('.collapsed-hidden').connectedEdges().addClass('hidden-filter');
    if (!filters.showContainmentEdges) cy.edges('.containment').addClass('hidden-filter');
    // 52 near-identical fork_of edges converging on one node stack their alpha into
    // an opaque wedge; the grey node styling already says "inactive fork".
    if (!filters.showInactiveEdges) cy.edges('.inactive').addClass('hidden-filter');
    if (filters.hideInactive) {
      const inact = cy.nodes('.inactive');
      inact.addClass('hidden-filter');
      inact.connectedEdges().addClass('hidden-filter');
    }
    cy.nodes().forEach((n) => n.data('_off', n.hasClass('hidden-filter')));
  });
  refreshBadges();
}

// ------------------------------------------------------------- highlight ----

export function focusNodes(ids) {
  const cy = S.cy;
  cy.elements().removeClass('highlight dimmed');
  const col = cy.collection(ids.map((id) => cy.$id(id)).filter((n) => n.length));
  if (col.length === 0) return false;
  col.addClass('highlight');
  const keep = col.union(col.connectedEdges()).union(col.ancestors());
  cy.elements().difference(keep).addClass('dimmed');
  // Explicit zoom + centre rather than cy.fit(): fitting a two-node collection that
  // happens to span the whole map yields an unreadable postage stamp, and fitting two
  // adjacent nodes yields a uselessly deep zoom. Clamp both ends.
  const bb = col.boundingBox();
  const pad = 140;
  const raw = Math.min(
    (cy.width() - 2 * pad) / Math.max(bb.w, 1),
    (cy.height() - 2 * pad) / Math.max(bb.h, 1)
  );
  const zoom = Math.max(0.5, Math.min(1.6, raw));
  cy.stop();
  cy.animate({ zoom, center: { eles: col } }, { duration: 400 });
  setTimeout(() => cy.elements().removeClass('dimmed'), 2600);
  return true;
}

// ---------------------------------------------------------------- reset -----

export async function loadScenario(id, api) {
  const cy = S.cy;
  const t0 = performance.now();
  cy.elements().remove();
  S.known.nodes = new Set();
  S.known.edges = new Set();
  S.probing = new Set();
  S.metrics = { firstRenderMs: null, expansions: [], relayouts: [] };
  filters.hideInactive = false;
  const seed = await api.seed(id);
  S.scenario = id;
  S.meta = seed;
  S.frontier = seed.frontier || {};
  addElements(seed.nodes, seed.edges);
  reapplyFilters();
  await runLayout({ pin: false, fit: true, animate: false });
  cy.zoom(Math.min(cy.zoom(), 1.5));
  cy.center();
  recomputeDerived();
  applyFindings(seed.findings);
  S.metrics.firstRenderMs = Math.round(performance.now() - t0);
  S.hooks.onChange();
  return seed;
}

/** Debug / benchmark: reveal the whole fixture at once. */
export async function revealAll(api) {
  const cy = S.cy;
  const full = await api.full(S.scenario);
  const before = positionsOf(cy.nodes().filter((n) => !n.isParent()));
  const newNodes = full.nodes.filter((n) => !S.known.nodes.has(n.id));
  const newEdges = full.edges.filter((e) => !S.known.edges.has(e.id));
  const added = addElements(newNodes, newEdges);
  const col = cy.collection(added.nodes.map((c) => c[0] ?? c).filter(Boolean));
  col.addClass('just-added');
  placeNewNodes(col.toArray(), S.meta.seed_ids?.[0] || cy.nodes()[0]?.id());
  const sampler = frameSampler();
  const t0 = performance.now();
  await runLayout({ pin: S.pin, fit: true, animate: true });
  const ms = performance.now() - t0;
  col.removeClass('just-added');
  // frontier is now empty everywhere
  S.frontier = {};
  recomputeDerived();
  applyFindings(full.findings);
  reapplyFilters();
  const rec = {
    revealAll: true,
    ms: Math.round(ms),
    newNodes: newNodes.length,
    newEdges: newEdges.length,
    graphNodes: cy.nodes().length,
    displacement: displacement(before),
    frames: sampler.stop(ms)
  };
  S.metrics.relayouts.push(rec);
  S.hooks.onChange();
  return rec;
}
