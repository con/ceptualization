import './style.css';
import {
  makeCy, cyStyle, buildElements, duplicateUuids, nameDisagreements,
} from './graph.js';
import { TwoTierLayout, startWorker, call } from './layout.js';
import { aggregate, verify } from './collapse.js';
import { applyLabelPolicy, compensateZoom, measureRendered } from './labels.js';
import { worldPositions } from './viewpos.js';
import { LEAF, clampTo, innerBounds } from './geometry.js';
import { History } from './history.js';
import { GROUPS, humanBytes } from './badges.js';

const API = '';
let SCENARIOS = ['s1-spacetop', 's2-babs-ria', 's3-forks'];

const S = {
  scenario: null,
  title: '', subtitle: '',
  byId: {}, edges: [], findings: [], reach: null,
  visible: new Set(), collapsed: new Set(), expansions: [],
  theme: 'dark', labelMode: 'demand', greyInactive: true,
  selected: null, busy: false,
  layout: new TwoTierLayout(),
  layoutMode: 'sticky',
  lastMetrics: null,
  timings: {},
  view: null,
  history: null,
  hidden: new Set(),
  badges: Object.fromEntries(Object.entries(GROUPS).map(([k, v]) => [k, v.on])),
  version: null,
  bundle: false,
  overlapping: new Set(),
  moved: new Set(),
};
let cy = null;

// ---------------------------------------------------------------- api

async function api(path, opts) {
  const r = await fetch(API + path, opts);
  if (!r.ok) throw new Error(`${path} -> ${r.status} ${await r.text()}`);
  return r.json();
}
const post = (p, body) => api(p, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

// ---------------------------------------------------------------- model

function mergePayload(p) {
  for (const n of p.nodes || []) S.byId[n.id] = n;
  const seen = new Set(S.edges.map((e) => e.id));
  for (const e of p.edges || []) if (!seen.has(e.id)) { S.edges.push(e); seen.add(e.id); }
  for (const n of p.nodes || []) S.visible.add(n.id);
  if (p.findings) S.findings = p.findings;
  if (p.reach) S.reach = p.reach;
  if (p.total) S.total = p.total;
}

const labelOf = (id) => {
  const n = S.byId[id];
  const l = (n && n.label) || id;
  return l.length > 30 ? '…' + l.slice(-29) : l;
};
const parentOf = (id) => {
  const n = S.byId[id];
  return n && n.parent && S.visible.has(n.parent) ? n.parent : null;
};
const childrenVisible = (id) => {
  if (S.collapsed.has(id)) return [];
  return [...S.visible].filter((k) => S.byId[k] && S.byId[k].parent === id).sort();
};

/** Highest-severity finding touching each node. */
function severityMap() {
  const m = new Map();
  const rank = { info: 1, warning: 2, error: 3 };
  for (const f of S.findings) {
    for (const id of f.nodes || []) {
      const cur = m.get(id);
      if (!cur || rank[f.severity] > rank[cur]) m.set(id, f.severity);
    }
  }
  return m;
}

/** Relations already walked, per node, so badges count only what is left. */
function walkedMap() {
  const m = new Map();
  for (const e of S.expansions) {
    if (!m.has(e.node)) m.set(e.node, new Set());
    m.get(e.node).add(`${e.relation}:out`);
  }
  return m;
}

/**
 * Nodes that EVERY inbound remote edge annex-ignores. Per the spec this is a
 * derived graph finding, not a stored fact: annex-ignore lives on the edge
 * because clones disagree, and only the unanimous case means "no route to
 * content here at all". Needs >= 2 edges, or it is just one clone's setting.
 */
function ignoredByAllSet() {
  const tally = new Map();
  for (const e of S.edges) {
    if (e.kind !== 'remote') continue;
    if (!S.visible.has(e.source) || !S.visible.has(e.target)) continue;
    const t = tally.get(e.target) || { n: 0, ig: 0 };
    t.n += 1;
    if (e.annex_ignore) t.ig += 1;
    tally.set(e.target, t);
  }
  const out = new Set();
  for (const [id, t] of tally) if (t.n >= 2 && t.n === t.ig) out.add(id);
  return out;
}

const model = () => ({
  byId: S.byId,
  edges: S.edges,
  childrenOf: (id) => [...S.visible].filter((k) => S.byId[k] && S.byId[k].parent === id).sort(),
});

/** Nodes that still have relations nobody has walked. */
function frontierSet() {
  const out = new Set();
  const seenKind = new Map();
  for (const e of S.edges) {
    if (!S.visible.has(e.source) || !S.visible.has(e.target)) continue;
    for (const [end, dir] of [[e.source, ':out'], [e.target, ':in']]) {
      const m = seenKind.get(end) || {};
      m[e.kind + dir] = (m[e.kind + dir] || 0) + 1;
      seenKind.set(end, m);
    }
  }
  for (const id of S.visible) {
    const n = S.byId[id];
    if (!n || !n.rel_counts) continue;
    const have = seenKind.get(id) || {};
    for (const [k, v] of Object.entries(n.rel_counts)) {
      if ((have[k] || 0) < v) { out.add(id); break; }
    }
  }
  return out;
}

// ---------------------------------------------------------------- render

let renderSeq = 0;
async function render({ fit = false, reason = '', inside = null, relayout = true, focus = null } = {}) {
  const mySeq = ++renderSeq;
  const t0 = performance.now();
  const m = model();
  // Hidden nodes leave the VIEW, never the store: they can be revealed again
  // from the Hidden panel, and a later expansion from another clone that
  // reaches them un-hides them automatically.
  const shownSet = new Set([...S.visible].filter((i) => !S.hidden.has(i)));
  const view = aggregate(m, shownSet, S.collapsed, { bundleCrossContainer: S.bundle });

  let metrics = null;
  if (relayout) {
    const g = {
      ids: [...view.shown].sort(),
      parentOf: (id) => {
        const n = S.byId[id];
        return n && n.parent && view.shown.has(n.parent) ? n.parent : null;
      },
      childrenOf: (id) => childrenVisible(id).filter((k) => view.shown.has(k)),
      labelOf: (id) => (S.byId[id] || {}).label || id,
      edges: S.edges.filter((e) => view.shown.has(e.source) && view.shown.has(e.target)),
    };
    const res = await S.layout.run(g, {
      mode: S.layoutMode, reason, inside, focus, pinned: S.moved,
    });
    metrics = res.metrics;
    S.lastMetrics = metrics;
  }
  if (mySeq !== renderSeq) return metrics;

  const positions = S.layout.allWorld([...view.shown], (id) => {
    const n = S.byId[id];
    return n && n.parent && view.shown.has(n.parent) ? n.parent : null;
  });
  const dis = nameDisagreements(Object.values(S.byId), S.edges, view.shown);
  S.disagree = dis;
  const els = buildElements(view, {
    byId: S.byId,
    childrenOf: (id) => childrenVisible(id).filter((k) => view.shown.has(k)),
  }, S.layout.size, {
    dupUuids: duplicateUuids([...view.shown].map((i) => S.byId[i]).filter(Boolean)),
    disagree: dis,
    frontier: frontierSet(),
    collapsed: S.collapsed,
    badgeGroups: S.badges,
    severityOf: severityMap(),
    walkedOf: walkedMap(),
    ignoredByAll: ignoredByAllSet(),
    overlapping: S.overlapping,
  });

  cy.startBatch();
  cy.elements().remove();
  cy.add(els);
  cy.nodes().forEach((n) => {
    const p = positions.get(n.id());
    if (p) n.position({ x: p.x, y: p.y });
  });
  cy.endBatch();
  grey();
  applyLabelPolicy(cy, { mode: S.labelMode, selected: S.selected });
  compensateZoom(cy);
  if (fit) fitAll();
  S.timings.renderMs = +(performance.now() - t0).toFixed(1);
  S.view = view;
  paintPanels(view);
  return metrics;
}

/** The default: fit everything, exactly like team A's `cy.fit()`, so the
 *  rendered-label measurement is directly comparable to theirs. Nothing here
 *  depends on a generous zoom -- the labels compensate instead. */
function fitAll(padding = 55) {
  cy.fit(undefined, padding);
  if (cy.zoom() > 1.6) { cy.zoom(1.6); cy.center(); }
  compensateZoom(cy);
  if (S.view) paintPanels(S.view);
}
/** Reading zoom: never smaller than 0.8, for when you want the node text too. */
function focusFit(padding = 60, floor = 0.8) {
  cy.fit(undefined, padding);
  if (cy.zoom() < floor) { cy.zoom(floor); cy.center(); }
  if (cy.zoom() > 1.6) { cy.zoom(1.6); cy.center(); }
  compensateZoom(cy);
  if (S.view) paintPanels(S.view);
}
function grey() {
  cy.nodes('.inactive').style('opacity', S.greyInactive ? 0.45 : 1);
  cy.edges('.inactive').style('opacity', S.greyInactive ? 0.15 : 0.8);
}

// ---------------------------------------------------------------- actions

async function loadScenario(name) {
  S.scenario = name;
  if (!S.history) S.history = new History(S);
  S.history.reset();
  S.byId = {}; S.edges = []; S.findings = []; S.visible = new Set();
  S.collapsed = new Set(); S.expansions = []; S.selected = null;
  S.hidden = new Set(); S.moved = new Set();
  S.layout = new TwoTierLayout();
  const t0 = performance.now();
  const p = await api(`/api/seed/${name}`);
  S.title = p.title; S.subtitle = p.subtitle || '';
  S.walkable = p.walkable;
  S.version = { viewer: p.viewer_version, map: p.map_tool_version,
                generator: p.map_generator };
  mergePayload(p);
  S.timings.seedMs = +(performance.now() - t0).toFixed(1);
  await render({ fit: true, reason: 'seed' });
  S.timings.firstPaintMs = +(performance.now() - t0).toFixed(1);
  document.getElementById('scen').value = name;
  document.getElementById('title').innerHTML = `<b>${S.title}</b><br>${S.subtitle || ''}`;
  paintPanels(S.view);
}



// ---------------------------------------------------------------- dragging

/**
 * Writing a drag back into the layout is a two-line operation *because* of the
 * container-local coordinate model: a top-level container owns a world centre,
 * and everything else owns an offset from its parent's top-left. So dragging a
 * container moves its children for free, and dragging a repository inside a
 * container cannot take it out of the box.
 *
 * Dragged nodes are remembered in S.moved and pinned (`layout.run` receives
 * the set), so later expansions and layout runs leave them where the user put
 * them. Positions live in the saved view already, so a hand-arranged map
 * survives save / reload.
 *
 * Two rules are enforced here rather than hoped for, because the UX pass
 * measured both failing:
 *
 *  - a leaf is CLAMPED to its container's inner bounds. Without the clamp a
 *    drag of 40 x 45 px was already enough to push a repository 43 px through
 *    the bottom of its host box, and a big one put it 552 px outside; the box
 *    is sized from the child COUNT, so it never grows to catch up.
 *  - a drag is refused while a probe is in flight. `S.busy` means a
 *    `History.begin()` is already open, and the drag's own entry was being
 *    eaten by that probe's `abandon()` -- a 297 px move that could not be
 *    undone and was silently reverted by the next undo.
 */
function wireDragging() {
  let startPos = null;
  cy.on('grab', 'node', (ev) => {
    const p = ev.target.position();
    startPos = { x: p.x, y: p.y, id: ev.target.id() };
  });
  cy.on('dragfree', 'node', async (ev) => {
    const node = ev.target;
    const id = node.id();
    const pos = node.position();
    if (startPos && startPos.id === id
        && Math.hypot(pos.x - startPos.x, pos.y - startPos.y) < 2) return;
    if (S.busy) {
      // put it back: a step is already open and this one cannot be recorded
      if (startPos && startPos.id === id) node.position({ x: startPos.x, y: startPos.y });
      toast('busy — finish the probe before moving nodes');
      return;
    }
    const parent = (i) => {
      const n = S.byId[i];
      return n && n.parent && S.visible.has(n.parent) && !S.hidden.has(n.parent) ? n.parent : null;
    };
    const step = S.history.begin(`move ${labelOf(id)}`);
    if (S.layout.centre.has(id)) {
      const prev = S.layout.centre.get(id) || {};
      S.layout.centre.set(id, { ...prev, x: pos.x, y: pos.y });
    } else {
      const par = parent(id);
      if (!par) { S.history.abandon(step); return; }
      const t = S.layout.worldTopLeft(par, parent);
      const s = S.layout.size.get(id) || { ...LEAF };
      const box = S.layout.size.get(par);
      let want = { x: pos.x - s.w / 2 - t.x, y: pos.y - s.h / 2 - t.y };
      // A child owns an offset from its parent's top-left; the box does not
      // grow to follow it, so the offset has to stay inside the box.
      if (box && box.w && box.h) want = clampTo(want, innerBounds(box, s));
      const had = S.layout.local.get(id);
      if (had && Math.hypot(want.x - had.x, want.y - had.y) < 0.5) {
        // fully clamped away: say so instead of leaving a no-op on the undo
        // stack and snapping the node back without explanation
        S.history.abandon(step);
        node.position(S.layout.worldOf(id, parent));
        toast(`${labelOf(id)} is already against the edge of its box`);
        return;
      }
      S.layout.local.set(id, want);
    }
    S.moved.add(id);
    // Rule 9 says user placement wins, so an overlapping drop is allowed --
    // but silently allowing it looks like a rendering bug. Say it happened.
    let overlapWith = null;
    if (S.layout.centre.has(id)) {
      const rect = (i) => {
        const c = S.layout.centre.get(i); const s = S.layout.size.get(i);
        if (!c || !s) return null;
        return { x1: c.x - s.w / 2, x2: c.x + s.w / 2, y1: c.y - s.h / 2, y2: c.y + s.h / 2 };
      };
      const a = rect(id);
      for (const other of S.layout.centre.keys()) {
        if (other === id || !S.visible.has(other) || S.hidden.has(other)) continue;
        const b2 = rect(other);
        if (!a || !b2) continue;
        if (a.x1 < b2.x2 && a.x2 > b2.x1 && a.y1 < b2.y2 && a.y2 > b2.y1) {
          overlapWith = other; break;
        }
      }
    }
    S.overlapping = overlapWith ? new Set([id, overlapWith]) : new Set();
    await render({ fit: false, reason: 'drag', relayout: false });
    paintPanels(S.view);
    toast(overlapWith
      ? `moved ${labelOf(id)} — now overlapping ${labelOf(overlapWith)} · undo with Ctrl+Z`
      : `moved ${labelOf(id)} · undo with Ctrl+Z`);
  });
}

// ---------------------------------------------------------------- hide

/** Hide a node, or a container and everything inside it. */
async function hideNode(id, withDescendants) {
  if (S.busy) return;
  const n = S.byId[id];
  // Hiding a box but leaving its contents drawn orphans them: their positions
  // are offsets from a parent that is no longer there. A container always
  // takes its descendants with it.
  if (!withDescendants && childrenVisible(id).length) withDescendants = true;
  S.history.begin(`hide ${withDescendants ? 'container ' : ''}${labelOf(id)}`);
  S.busy = true;
  try {
    const drop = new Set([id]);
    if (withDescendants) {
      let grew = true;
      while (grew) {
        grew = false;
        for (const k of S.visible) {
          const par = S.byId[k] && S.byId[k].parent;
          if (par && drop.has(par) && !drop.has(k)) { drop.add(k); grew = true; }
        }
      }
    }
    drop.forEach((k) => S.hidden.add(k));
    if (drop.has(S.selected)) S.selected = null;
    await render({ fit: false, reason: 'hide', relayout: true });
    paintPanels(S.view);
    toast(`hid ${drop.size} node${drop.size === 1 ? '' : 's'} · undo with Ctrl+Z`);
  } finally { S.busy = false; }
}

async function unhide(ids) {
  if (S.busy) return;
  S.history.begin(ids.length === 1 ? `show ${labelOf(ids[0])}` : `show ${ids.length} hidden`);
  S.busy = true;
  try {
    ids.forEach((k) => S.hidden.delete(k));
    await render({ fit: false, reason: 'unhide', relayout: true });
    paintPanels(S.view);
  } finally { S.busy = false; }
}

function paintHidden() {
  const el2 = document.getElementById('hidden');
  if (!el2) return;
  const ids = [...S.hidden].filter((i) => S.visible.has(i));
  if (!ids.length) { el2.innerHTML = '<p class="muted">nothing hidden</p>'; return; }
  el2.innerHTML = `<button class="histrow" data-all="1"><span>show all</span><b>${ids.length}</b></button>`
    + ids.slice(0, 40).map((i) =>
      `<button class="histrow" data-id="${i}"><span>${labelOf(i)}</span><b>show</b></button>`).join('');
  el2.querySelectorAll('.histrow').forEach((b) => {
    b.onclick = () => unhide(b.dataset.all ? ids : [b.dataset.id]);
  });
}

// ---------------------------------------------------------------- history

async function doUndo() {
  if (S.busy || !S.history.canUndo()) return;
  S.busy = true;
  try {
    const label = S.history.undo();
    await render({ fit: false, reason: 'undo', relayout: false });
    paintPanels(S.view);
    toast(`undid: ${label}`);
  } finally { S.busy = false; }
}

async function doRedo() {
  if (S.busy || !S.history.canRedo()) return;
  S.busy = true;
  try {
    const label = S.history.redo();
    await render({ fit: false, reason: 'redo', relayout: false });
    paintPanels(S.view);
    toast(`redid: ${label}`);
  } finally { S.busy = false; }
}

async function doJump(i) {
  if (S.busy) return;
  S.busy = true;
  try {
    const label = S.history.jumpTo(i);
    await render({ fit: false, reason: 'history-jump', relayout: false });
    paintPanels(S.view);
    toast(`back to before: ${label}`);
  } finally { S.busy = false; }
}

function paintHistory() {
  const el = document.getElementById('history');
  if (!el) return;
  const es = S.history ? S.history.entries() : [];
  document.getElementById('undo').disabled = !(S.history && S.history.canUndo());
  document.getElementById('redo').disabled = !(S.history && S.history.canRedo());
  if (!es.length) {
    el.innerHTML = '<p class="muted">nothing to undo yet</p>';
    return;
  }
  el.innerHTML = es.map((e) => `<button class="histrow" data-i="${e.i}">`
    + `<span>${e.label}</span><b>${e.nodes}</b></button>`).join('');
  el.querySelectorAll('.histrow').forEach((b) => {
    b.onclick = () => doJump(+b.dataset.i);
  });
}

async function doExpand(nodeId, relation, opts = {}) {
  if (S.busy) return null;
  S.busy = true; toast(`probing ${relation} of ${nodeId}…`, true);
  const step = S.history.begin(`expand ${relation} of ${labelOf(nodeId)}`);
  const t0 = performance.now();
  try {
    const p = await post('/api/expand', {
      scenario: S.scenario, node_id: nodeId, relation,
      known: [...S.visible], nodelay: !!opts.nodelay,
    });
    const netMs = performance.now() - t0;
    const newIds = (p.nodes || []).map((n) => n.id);
    if (!newIds.length) S.history.abandon(step);
    // reaching a hidden node by another route brings it back
    newIds.forEach((i) => S.hidden.delete(i));
    mergePayload(p);
    S.expansions.push({ node: nodeId, relation });
    const kids = new Set([...S.visible].filter((k) => {
      let cur = S.byId[k] && S.byId[k].parent;
      let guard = 0;
      while (cur && guard++ < 20) { if (cur === nodeId) return true; cur = S.byId[cur] && S.byId[cur].parent; }
      return false;
    }));
    const metrics = await render({ reason: `${nodeId}|${relation}`, inside: kids, focus: nodeId });
    if (metrics) {
      metrics.netMs = +netMs.toFixed(1);
      metrics.probeMs = p.probe_ms;
      metrics.newNodes = newIds.length;
      metrics.key = `${nodeId}|${relation}`;
    }
    toast(`+${newIds.length} nodes · containers moved ${metrics ? metrics.containers.max : '?'} px max · `
      + `leaves ${metrics ? metrics.leaves.max : '?'} px max`);
    return metrics;
  } catch (err) {
    S.history.abandon(step);
    toast('expand failed: ' + err.message);
    return null;
  } finally {
    S.busy = false;
  }
}

async function revealRoot(rootId) {
  const p = await post('/api/materialize', {
    scenario: S.scenario, ids: [...S.visible, rootId],
  });
  mergePayload(p);
  await render({ reason: 'reveal-root ' + rootId });
  const n = cy.getElementById(rootId);
  if (n.nonempty()) { select(rootId); cy.center(n); }
  toast(`revealed ${rootId} — a component the seed cannot reach by probing`);
}

/** Reveal the entire worldmap in one shot. Not an exploration gesture -- it
 *  exists so the frame-time number is comparable with team A's "reveal 68
 *  nodes at once" measurement. */
async function revealAll() {
  const full = await api(`/api/full/${S.scenario}`);
  mergePayload(full);
  const m = await render({ reason: 'reveal-all' });
  return m;
}

async function toggleCollapse(id) {
  S.history.begin(`${S.collapsed.has(id) ? 'expand' : 'collapse'} ${labelOf(id)}`);
  if (S.collapsed.has(id)) S.collapsed.delete(id); else S.collapsed.add(id);
  await render({ reason: 'collapse ' + id });
}

async function collapseAll(on) {
  S.history.begin(on ? 'collapse all' : 'expand all');
  S.collapsed = new Set();
  if (on) {
    for (const id of S.visible) {
      if (childrenVisible(id).length && !parentOf(id)) S.collapsed.add(id);
    }
  }
  await render({ reason: on ? 'collapse-all' : 'expand-all' });
}

function select(id, kind = 'node') {
  S.selected = id;
  S.selectedKind = kind;
  cy.elements().unselect();
  const n = cy.getElementById(id);
  if (n.nonempty()) n.select();
  applyLabelPolicy(cy, { mode: S.labelMode, selected: id });
  compensateZoom(cy);
  paintInspector();
}

// ---------------------------------------------------------------- panels

function el(id) { return document.getElementById(id); }

/**
 * The toolbar's toggles are a VIEW of S, so every repaint re-reads S rather
 * than trusting the click that set them. Undo restores `S.bundle` from the
 * snapshot, and before this the `bundle x-container` button stayed lit while
 * the map had already gone back to individual edges.
 */
function syncToolbar() {
  const bb = document.getElementById('bundle');
  if (bb) bb.classList.toggle('on', !!S.bundle);
  const g = document.getElementById('grey');
  if (g) g.checked = !!S.greyInactive;
}

function paintPanels(view) {
  syncToolbar();
  paintHistory();
  paintHidden();
  el('findings').innerHTML = S.findings.length
    ? S.findings.map((f) => `<div class="finding ${f.severity}" data-n="${f.nodes.join(',')}">
        <span class="code">${f.severity}: ${f.code}</span>${f.message}</div>`).join('')
    : '<p class="empty">none yet — findings fire only when every node they mention is on the map</p>';

  const r = S.reach || {};
  const notReachable = (r.total || 0) - (r.reachable_relations_only || 0);
  const cls = notReachable === 0 ? 'zero' : 'warn';
  el('reach').innerHTML = `
    <div class="big ${cls}">${notReachable}</div>
    <div class="lbl">nodes <b>not reachable from here</b> by probing remotes / forks
      from what is on the map (${r.visible || 0} of ${r.total || 0} on map)</div>
    <ul>
      <li><span>reachable if <code>contains</code> counts</span><b>${r.reachable_with_contains || 0}/${r.total || 0}</b></li>
      <li><span>only reachable via <code>contains</code></span><b>${r.needs_contains || 0}</b></li>
      <li><span>unreachable even then</span><b>${r.unreachable || 0}</b></li>
    </ul>
    ${(r.unreached_roots || []).length ? `<ul>${(r.unreached_roots || []).map((x) =>
      `<li><span><code>${x.root}</code><br>${x.label} · ${x.size} nodes</span>
        <button data-root="${x.root}">reveal</button></li>`).join('')}</ul>`
      : '<p class="empty" style="margin:6px 0 0">every component root is on the map</p>'}`;
  el('reach').querySelectorAll('button[data-root]').forEach((b) => {
    b.onclick = () => revealRoot(b.dataset.root);
  });

  const m = S.lastMetrics;
  const st = view.stats;
  el('stats').innerHTML = `
    <div class="stat"><span>drawn nodes</span><b>${st.drawnNodes} / ${st.visibleNodes} visible</b></div>
    <div class="stat"><span>drawn edges</span><b>${st.drawnEdges} / ${st.rawEdges} raw</b></div>
    <div class="stat"><span>edges folded inside</span><b>${st.internalEdgesFolded}</b></div>
    <div class="stat"><span>tier-1 runs</span><b>${S.layout.tier1Runs}</b></div>
    <div class="stat"><span>tier-2 runs</span><b>${S.layout.tier2Runs}</b></div>
    ${m ? `<div class="stat"><span>last container max</span><b>${m.containers.max} px</b></div>
    <div class="stat"><span>last leaf max</span><b>${m.leaves.max} px</b></div>
    <div class="stat"><span>last layout</span><b>${m.totalMs} ms (worker)</b></div>` : ''}
    <div class="stat"><span>first paint</span><b>${S.timings.firstPaintMs || '?'} ms</b></div>
    <div class="stat"><span>graphviz wasm load</span><b>${S.layout.timings.gvLoadMs || '?'} ms</b></div>`;

  const containers = [...S.visible].filter((i) => model().childrenOf(i).length);
  el('containers').innerHTML = containers.length
    ? containers.sort().map((i) => `<div class="stat"><span>${i}</span>
        <button data-col="${i}" class="${S.collapsed.has(i) ? 'on' : ''}">${S.collapsed.has(i) ? 'collapsed' : 'open'}</button></div>`).join('')
    : '<p class="empty">no containers on the map yet</p>';
  el('containers').querySelectorAll('button[data-col]').forEach((b) => {
    b.onclick = () => toggleCollapse(b.dataset.col);
  });

  const dis = S.disagree || new Map();
  el('disagree').innerHTML = dis.size
    ? [...dis.entries()].map(([id, names]) => `<div class="finding warning" data-n="${id}">
        <span class="code">name disagreement</span>
        <b>${(S.byId[id] || {}).label || id}</b> is called
        ${names.map((n) => `<span class="n">${n.name}</span> by ${n.n}`).join(', ')}</div>`).join('')
    : '<p class="empty">no node is called by two different remote names yet</p>';

  el('foot').innerHTML = `scenario <b>${S.scenario}</b> · `
    + `tier1 graphviz over <b>${[...S.visible].filter((i) => !parentOf(i)).length}</b> boxes `
    + `(${S.layout.timings.gvMs || '?'} ms) · tier2 fcose per container · both in a Web Worker · `
    + `label policy <b>${S.labelMode}</b> · zoom <b>${cy.zoom().toFixed(3)}</b> · `
    + `edge labels rendered at <b>${compensateZoom(cy).renderedPx} px</b>`
    + (S.version ? ` · viewer <b>${S.version.viewer}</b>` : '')
    + (S.version && S.version.map ? ` · map by <b>${S.version.generator || 'unknown'}</b> `
        + `<b>${S.version.map}</b>` : '');

  el('findings').onclick = el('disagree').onclick = (ev) => {
    const t = ev.target.closest('.finding');
    if (!t) return;
    const ids = t.dataset.n.split(',');
    const eles = cy.nodes().filter((n) => ids.includes(n.id()));
    if (!eles.length) return;
    cy.fit(eles, 220);
    if (cy.zoom() > 1.4) { cy.zoom(1.4); cy.center(eles); }
    compensateZoom(cy);
    eles.addClass('hl');
    eles.connectedEdges().filter((e) => ids.includes(e.source().id()) && ids.includes(e.target().id())).addClass('hl lbl');
    compensateZoom(cy);
    setTimeout(() => { cy.elements().removeClass('hl'); }, 2600);
  };
}

function paintInspector() {
  const old = document.querySelector('.inspector');
  if (old) old.remove();
  if (!S.selected) return;
  if (S.selectedKind === 'edge') return paintEdgeInspector();
  const n = S.byId[S.selected];
  if (!n) return;
  const kv = [];
  const put = (k, v) => {
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) return;
    kv.push(`<span>${k}</span><div>${v}</div>`);
  };
  put('id', n.id); put('type', n.type); put('on host', n.on_host);
  put('vcs', n.vcs); put('layout', n.layout); put('annex', n.annex_mode);
  put('annex uuid', n.annex_uuid); put('dataset id', n.dataset_id);
  put('special', n.special_remote_type); put('trust', n.trust);
  put('branch', n.branch); put('result branch', n.result_branch);
  put('forge', n.forge); put('stars', n.stars);
  put('children', n.child_count || undefined);
  const done = new Set(S.expansions.filter((e) => e.node === n.id).map((e) => e.relation));
  const rels = Object.entries(n.rel_counts || {}).sort();
  const box = document.createElement('div');
  box.className = 'hud inspector';
  const dis = (S.disagree || new Map()).get(n.id);
  box.innerHTML = `<button class="close">×</button>
    <h3>${n.label || n.id}</h3>
    <div class="kind">${n.type}${n.is_seed ? ' · seed' : ''}${n.child_count ? ` · contains ${n.child_count}` : ''}</div>
    ${dis ? `<div class="names"><b style="color:var(--disagree)">called by ${dis.length} different names</b><br>
      ${dis.map((x) => `<span class="n">${x.name}</span> — by ${x.from.join(', ')}`).join('<br>')}</div>` : ''}
    <div class="kv">${kv.join('')}</div>
    <div class="rels">${rels.map(([k, v]) =>
      `<button data-rel="${k}" class="${done.has(k) ? 'done' : ''}">${k} ${v}</button>`).join('')}</div>
    ${n.child_count ? `<div class="rels"><button data-collapse="${n.id}">${S.collapsed.has(n.id) ? 'expand' : 'collapse'} container</button></div>` : ''}
    <div class="rels">
      <button data-hide="${n.id}">hide node</button>
      ${n.child_count ? `<button data-hideall="${n.id}">hide container (${n.descendant_count || n.child_count})</button>` : ''}
    </div>`;
  box.querySelector('.close').onclick = () => { S.selected = null; box.remove(); applyLabelPolicy(cy, { mode: S.labelMode }); };
  box.querySelectorAll('button[data-rel]').forEach((b) => {
    b.onclick = () => doExpand(n.id, b.dataset.rel);
  });
  const cb = box.querySelector('button[data-collapse]');
  if (cb) cb.onclick = () => toggleCollapse(n.id);
  const hb = box.querySelector('button[data-hide]');
  if (hb) hb.onclick = () => hideNode(n.id, false);
  const hab = box.querySelector('button[data-hideall]');
  if (hab) hab.onclick = () => hideNode(n.id, true);
  document.querySelector('.main').appendChild(box);
}


/**
 * Details for a RELATION, not for the repository at either end.
 *
 * Ordered by cost, which is the design rather than an implementation detail:
 * everything already crawled is shown immediately, anything needing a round
 * trip is offered as an explicit action, and anything expensive says so.
 * See issue-1/node-badges-and-relation-details.md part 2.
 */

/** Render a /api/relation result, always naming the command it came from. */
function renderRelationProbe(r) {
  if (!r) return '<p class="empty">no result</p>';
  const cmd = r.cmd ? `<div class="cmd"><code>${r.cmd}</code></div>` : '';
  if (r.error) return `${cmd}<p class="empty">${r.error}</p>`;
  if (r.rows) {
    if (!r.rows.length) return `${cmd}<p class="empty">no branches on either side</p>`;
    return cmd + `<table class="brtable"><tr><th>branch</th><th>here</th><th>there</th><th></th></tr>`
      + r.rows.map((x) => `<tr class="st-${x.state.replace(/ /g, '-')}">`
        + `<td>${x.branch}</td><td><code>${x.local || '—'}</code></td>`
        + `<td><code>${x.remote || '—'}</code></td><td>${x.state}</td></tr>`).join('')
      + '</table>';
  }
  if (r.sides) {
    const fmt = (s) => `${s.keys} keys · ${humanBytes(s.bytes) || '0B'}`;
    return cmd + '<div class="kv">'
      + Object.entries(r.sides).map(([k, v]) => `<span>${k}</span><div>${fmt(v)}</div>`).join('')
      + `</div><p class="empty">${r.note || ''}</p>`;
  }
  return `${cmd}<p class="empty">nothing to show</p>`;
}

function paintEdgeInspector() {
  const cyEdge = cy.getElementById(S.selected);
  let d;
  if (cyEdge && cyEdge.nonempty()) {
    d = cyEdge.data();
  } else {
    // a member of a bundle: not drawn on its own, but still inspectable
    const raw0 = S.edges.find((e) => e.id === S.selected);
    if (!raw0) return;
    d = { ...raw0, members: [raw0.id], count: 1 };
  }
  // aggregate() wraps EVERY edge, so a lone edge arrives with members:[oneId].
  // Only treat it as a summary when it actually summarises more than one.
  const memberIds = (d.members || []).filter(Boolean);
  const members = memberIds.length > 1 ? memberIds : null;
  const raw = members ? null
    : S.edges.find((e) => e.id === (memberIds[0] || d.id)) || d.raw || null;
  const srcN = S.byId[d.source] || {};
  const tgtN = S.byId[d.target] || {};

  const kv = [];
  const put = (k, v, cls = '') => {
    if (v === undefined || v === null || v === '') return;
    kv.push(`<span>${k}</span><div class="${cls}">${v}</div>`);
  };
  const ago = (ts) => {
    if (!ts) return null;
    const s = Math.max(0, Math.floor(Date.now() / 1000) - ts);
    if (s < 3600) return `${Math.floor(s / 60)} min ago`;
    if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
    return `${Math.floor(s / 86400)} d ago`;
  };

  // every name this peer is known by, across all clones on the map
  const names = new Map();
  for (const e of S.edges) {
    if (e.kind !== 'remote' || e.target !== d.target || !e.remote_name) continue;
    if (!names.has(e.remote_name)) names.set(e.remote_name, []);
    names.get(e.remote_name).push((S.byId[e.source] || {}).label || e.source);
  }

  let body = '';
  if (d.kind === 'contains') {
    put('relation', 'contains');
    put('path', raw && raw.path);
    body = '<p class="empty">Containment has no configuration — only a path.</p>';
  } else if (members) {
    // an aggregated / bundled arrow
    put('relation', `${d.kind} × ${d.count}`);
    put('bundled', S.bundle ? 'cross-container summary' : 'collapsed container summary');
    body = `<div class="rels">${members.slice(0, 12).map((mid) => {
      const me = S.edges.find((e) => e.id === mid) || {};
      const from = (S.byId[me.source] || {}).label || me.source || '?';
      return `<button data-edge="${mid}" title="${from}">${me.remote_name || me.kind || 'edge'}</button>`;
    }).join('')}</div>`
      + (members.length > 12 ? `<p class="empty">and ${members.length - 12} more</p>` : '');
  } else if (raw) {
    put('relation', raw.kind);
    put('remote name', raw.remote_name ? `<b>${raw.remote_name}</b>` : '<i>referenced by URL only</i>');
    put('url', raw.url);
    put('push url', raw.pushurl);
    put('resolution', raw.resolution);
    if (raw.annex_ignore) put('annex-ignore', 'yes — this clone will not ask it for content', 'warn');
    if (tgtN.annex_incapable_assumed) {
      put('assumed', 'host cannot carry annexed content over plain git <i>(assumption, not observed)</i>', 'muted');
    }
    put('recorded annex uuid', raw.annex_uuid || tgtN.annex_uuid);
    put('trust', tgtN.trust);
    if (typeof raw.ahead === 'number' || typeof raw.behind === 'number') {
      put('ahead / behind', `▲${raw.ahead ?? '?'} ▼${raw.behind ?? '?'} `
        + `<i>as of the last fetch${ago(raw.observed_at) ? ', observed ' + ago(raw.observed_at) : ''}</i>`);
    }
    put('observed via', raw.via);
    if (tgtN.special_remote_type) put('special remote', tgtN.special_remote_type);
    body = `<div class="rels">
        <button data-probe="branches" title="One git ls-remote round trip">branch table…</button>
        <button data-probe="content" title="git annex find --in=X --not --in=Y — expensive">content each side lacks…</button>
      </div>
      <div id="relresult"></div>`;
  }

  const box = document.createElement('div');
  box.className = 'hud inspector';
  box.innerHTML = `<button class="close">×</button>
    <h3>${srcN.label || d.source} → ${tgtN.label || d.target}</h3>
    <div class="kind">relation${d.count > 1 ? ` · ${d.count} bundled` : ''}</div>
    ${names.size > 1 ? `<div class="names"><b style="color:var(--disagree)">this peer is called ${names.size} different names</b><br>
      ${[...names].map(([nm, from]) => `<span class="n">${nm}</span> — by ${from.join(', ')}`).join('<br>')}</div>` : ''}
    <div class="kv">${kv.join('')}</div>
    ${body}
    <div class="rels">
      <button data-goto="${d.source}">← ${srcN.label ? 'source' : 'src'}</button>
      <button data-goto="${d.target}">target →</button>
    </div>`;
  box.querySelector('.close').onclick = () => {
    S.selected = null; box.remove(); applyLabelPolicy(cy, { mode: S.labelMode });
  };
  box.querySelectorAll('button[data-goto]').forEach((b) => {
    b.onclick = () => select(b.dataset.goto, 'node');
  });
  box.querySelectorAll('button[data-edge]').forEach((b) => {
    b.onclick = () => select(b.dataset.edge, 'edge');
  });
  box.querySelectorAll('button[data-probe]').forEach((b) => {
    b.onclick = async () => {
      const out = box.querySelector('#relresult');
      const edgeId = (raw && raw.id) || d.id;
      out.innerHTML = '<p class="empty">running…</p>';
      b.disabled = true;
      try {
        const r = await post('/api/relation', {
          scenario: S.scenario, edge_id: edgeId, what: b.dataset.probe,
        });
        out.innerHTML = renderRelationProbe(r);
      } catch (e) {
        out.innerHTML = `<p class="empty">failed: ${e.message}</p>`;
      } finally { b.disabled = false; }
    };
  });
  document.querySelector('.main').appendChild(box);
}

let toastTimer = null;
function toast(msg, busy = false) {
  let t = document.querySelector('.toast');
  if (!t) { t = document.createElement('div'); t.className = 'toast'; document.querySelector('.main').appendChild(t); }
  t.textContent = msg;
  t.classList.toggle('busy', busy);
  clearTimeout(toastTimer);
  if (!busy) toastTimer = setTimeout(() => t.remove(), 4200);
}

// ---------------------------------------------------------------- views

function viewPayload() {
  const top = [...S.visible].filter((i) => !parentOf(i));
  const containers = {};
  for (const id of top) {
    const c = S.layout.centre.get(id);
    const s = S.layout.size.get(id) || LEAF;
    if (c) containers[id] = { x: c.x, y: c.y, w: s.w, h: s.h };
  }
  const sizes = {};
  for (const id of S.visible) {
    const s = S.layout.size.get(id);
    if (s && (s.w !== LEAF.w || s.h !== LEAF.h) && !containers[id]) sizes[id] = { w: s.w, h: s.h };
  }
  const local = {};
  for (const id of S.visible) {
    if (containers[id]) continue;
    const l = S.layout.local.get(id);
    if (l) local[id] = { in: parentOf(id) || '', x: l.x, y: l.y };
  }
  return {
    scenario: S.scenario,
    visible: [...S.visible],
    collapsed: [...S.collapsed],
    expansions: S.expansions,
    containers, sizes, local,
    view: { theme: S.theme, zoom: cy.zoom(), pan: cy.pan(), labels: S.labelMode },
  };
}

async function saveView(name = 'default') {
  const r = await api(`/api/view/${S.scenario}?name=${name}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(viewPayload()),
  });
  toast(`saved ${r.saved} (${r.bytes} bytes, ${r.nodes} nodes)`);
  return r;
}

async function loadView(name = 'default') {
  const v = await api(`/api/view/${S.scenario}?name=${name}`);
  const p = await post('/api/materialize', { scenario: S.scenario, ids: v.visible });
  S.byId = {}; S.edges = []; S.visible = new Set();
  mergePayload(p);
  S.collapsed = new Set(v.collapsed || []);
  S.expansions = v.expansions || [];
  // restore both tiers verbatim: no layout engine runs on reload
  S.layout = new TwoTierLayout();
  for (const [id, b] of Object.entries(v.containers || {})) {
    S.layout.centre.set(id, { x: b.x, y: b.y, _w: b.w, _h: b.h });
    S.layout.size.set(id, { w: b.w, h: b.h, cols: 0, rows: 0, cell: LEAF, slots: 0, kids: 0 });
  }
  // Nested container boxes are saved in `sizes`, and reading them back is not
  // optional: without it a RIA store came back as a 210 x 76 leaf, its centre
  // 735.68 px from where it was saved, with its 40 children drawn outside it.
  for (const [id, b] of Object.entries(v.sizes || {})) {
    if (S.layout.size.has(id)) continue;
    S.layout.size.set(id, { w: b.w, h: b.h, cols: 0, rows: 0, cell: LEAF, slots: 0, kids: 0 });
  }
  for (const [id, l] of Object.entries(v.local || {})) S.layout.local.set(id, { x: l.x, y: l.y });
  S.layout.lastTop = new Set(Object.keys(v.containers || {}));
  for (const id of S.visible) {
    const kids = childrenVisible(id);
    if (kids.length) S.layout.lastKids.set(id, new Set(kids));
  }
  await render({ relayout: false, reason: 'restore' });
  // setTheme rebuilds the graph and restores the zoom it found on the way in;
  // the saved zoom has to be applied AFTER that, or the pre-load zoom wins and
  // a reloaded view comes back at the wrong scale (measured: saved 0.4821,
  // restored 1.6).
  await setTheme(v.view && v.view.theme ? v.view.theme : S.theme);
  if (v.view) { cy.zoom(v.view.zoom); cy.pan(v.view.pan); compensateZoom(cy); }
  toast(`restored view '${name}' — ${v.visible.length} nodes, no layout engine ran`);
  return v;
}

function setTheme(t) {
  S.theme = t;
  document.documentElement.dataset.theme = t;
  // cy.style(arr) on a populated graph silently drops every edge rule
  // (team A found this). Rebuild the elements instead of restyling in place.
  const z = cy.zoom(), p = cy.pan();
  cy.elements().remove();      // restyle an EMPTY graph, then rebuild
  cy.style(cyStyle(t));
  return render({ relayout: false, reason: 'theme' }).then(() => {
    cy.zoom(z); cy.pan(p); compensateZoom(cy);
  });
}

// ---------------------------------------------------------------- shell

function shell() {
  document.getElementById('app').innerHTML = `
  <aside class="side">
    <h1>worldmap <span class="tag">team D · two-tier</span></h1>
    <p class="sub" id="title"></p>
    <select id="scen">${SCENARIOS.map((s) => `<option value="${s}">${s}</option>`).join('')}</select>
    <h2>Reach</h2><div class="reach" id="reach"></div>
    <h2>Findings</h2><div id="findings"></div>
    <h2>Remote-name disagreement</h2><div id="disagree"></div>
    <h2>Containers</h2><div id="containers"></div>
    <h2>Hidden</h2><div id="hidden"></div>
    <h2>History</h2><div id="history"></div>
    <h2>Measurements</h2><div id="stats"></div>
    <h2>Legend</h2>
    <div class="legend">
      <div><i style="background:var(--panel2)"></i>container box — tier 1 (graphviz)</div>
      <div><i style="border-color:var(--store);border-style:dashed"></i>RIA store / superdataset</div>
      <div><i style="border-color:var(--accent);border-width:3px"></i>seed clone</div>
      <div><i style="border-color:var(--err);border-width:3px"></i>duplicate annex UUID</div>
      <div><i style="border-color:var(--disagree);border-width:3px"></i>two clones, two names</div>
      <div><i style="opacity:.4"></i>inactive / dead</div>
    </div>
  </aside>
  <main class="main">
    <div class="hud top">
      <button id="fit">fit everything</button>
      <button id="fitall">reading zoom</button>
      <div class="sep"></div>
      <span style="color:var(--sub)">labels</span>
      <button id="lbl-demand" class="on">on demand</button>
      <button id="lbl-all">all</button>
      <button id="lbl-none">none</button>
      <div class="sep"></div>
      <button id="collapse-all">collapse all</button>
      <button id="expand-all">expand all</button>
      <button id="bundle" title="Summarise edges between different containers into one arrow per pair">bundle x-container</button>
      <button id="reveal-all" title="Show every node already present in the crawled worldmap, without probing">reveal all</button>
      <span class="sep"></span><span class="lbl">badges</span>
      <span id="badge-toggles"></span>
      <span class="sep"></span>
      <button id="undo" title="Undo the last exploration step (Ctrl+Z)">↶ undo</button>
      <button id="redo" title="Redo (Ctrl+Shift+Z)">↷ redo</button>
      <div class="sep"></div>
      <label class="chk"><input type="checkbox" id="grey" checked> grey inactive</label>
      <div class="sep"></div>
      <button id="save">save view</button>
      <button id="load">load view</button>
      <button id="export">export html</button>
      <button id="theme">☀/☾</button>
    </div>
    <div id="cy"></div>
    <div class="hud bottom" id="foot"></div>
  </main>`;

  cy = makeCy(document.getElementById('cy'), S.theme);
  window.__cy = cy;   // exposed for the Playwright drivers
  wireDragging();
  window.__S = S;
  cy.on('tap', 'node', (ev) => select(ev.target.id(), 'node'));
  // A relation is a first-class thing in this model (RemoteLink is a reified
  // statement carrying its own data), so it must be inspectable in its own
  // right rather than falling through to the repository.
  cy.on('tap', 'edge', (ev) => { ev.stopPropagation(); select(ev.target.id(), 'edge'); });
  cy.on('dbltap', 'node', (ev) => {
    if (model().childrenOf(ev.target.id()).length || S.collapsed.has(ev.target.id())) {
      toggleCollapse(ev.target.id());
    }
  });
  cy.on('tap', (ev) => {
    if (ev.target === cy) { S.selected = null; paintInspector(); applyLabelPolicy(cy, { mode: S.labelMode }); compensateZoom(cy); }
  });
  let raf = null;
  cy.on('zoom pan', () => {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = null; compensateZoom(cy); });
  });

  document.getElementById('scen').onchange = (e) => loadScenario(e.target.value);
  document.getElementById('fit').onclick = () => fitAll();
  document.getElementById('fitall').onclick = () => focusFit();
  document.getElementById('grey').onchange = (e) => { S.greyInactive = e.target.checked; grey(); };
  document.getElementById('collapse-all').onclick = () => collapseAll(true);
  document.getElementById('expand-all').onclick = () => collapseAll(false);
  const bt = document.getElementById('badge-toggles');
  try {
    const saved = JSON.parse(localStorage.getItem('wm.badges') || 'null');
    if (saved) Object.assign(S.badges, saved);
  } catch (e) { /* private mode, defaults are fine */ }
  bt.innerHTML = Object.entries(GROUPS).map(([k, g]) =>
    `<button class="tgl" data-bg="${k}">${g.label}</button>`).join('');
  const syncBadgeBtns = () => bt.querySelectorAll('[data-bg]').forEach((b) => {
    b.classList.toggle('on', !!S.badges[b.dataset.bg]);
  });
  syncBadgeBtns();
  bt.querySelectorAll('[data-bg]').forEach((b) => {
    b.onclick = async () => {
      S.badges[b.dataset.bg] = !S.badges[b.dataset.bg];
      syncBadgeBtns();
      try { localStorage.setItem('wm.badges', JSON.stringify(S.badges)); } catch (e) { /* ignore */ }
      await render({ fit: false, reason: 'badges', relayout: false });
    };
  });
  const bb = document.getElementById('bundle');
  syncToolbar();
  bb.onclick = async () => {
    S.history.begin(S.bundle ? 'unbundle cross-container edges' : 'bundle cross-container edges');
    S.bundle = !S.bundle;
    syncToolbar();
    await render({ fit: false, reason: 'bundle', relayout: false });
    paintPanels(S.view);
  };
  document.getElementById('undo').onclick = doUndo;
  document.getElementById('redo').onclick = doRedo;
  window.addEventListener('keydown', (ev) => {
    const z = ev.key === 'z' || ev.key === 'Z';
    if (!(ev.ctrlKey || ev.metaKey) || !z) return;
    ev.preventDefault();
    if (ev.shiftKey) doRedo(); else doUndo();
  });
  // A CRAWLED worldmap is already entirely on disk, so probing one relation at
  // a time is theatre. This reveals everything that was crawled.
  document.getElementById('reveal-all').onclick = async () => {
    if (S.busy) return;
    S.busy = true;
    S.history.begin('reveal all');
    try {
      const p = await post('/api/materialize', { scenario: S.scenario, ids: '*' });
      mergePayload(p);
      await render({ fit: true, reason: 'reveal-all' });
      paintPanels(S.view);
    } catch (e) {
      console.error('reveal all failed', e);
    } finally { S.busy = false; }
  };
  document.getElementById('save').onclick = () => saveView('default');
  document.getElementById('load').onclick = () => loadView('default');
  document.getElementById('export').onclick = () => window.open(`/export/${S.scenario}?name=default`, '_blank');
  document.getElementById('theme').onclick = () => setTheme(S.theme === 'dark' ? 'light' : 'dark');
  for (const mode of ['demand', 'all', 'none']) {
    document.getElementById('lbl-' + mode).onclick = () => {
      S.labelMode = mode;
      ['demand', 'all', 'none'].forEach((k) => document.getElementById('lbl-' + k).classList.toggle('on', k === mode));
      applyLabelPolicy(cy, { mode, selected: S.selected });
      compensateZoom(cy);
      paintPanels(S.view);
    };
  }
}

// ---------------------------------------------------------------- boot

shell();
startWorker();
call('warm', {}).catch(() => {});
// Scenarios come from the server, so any directory holding a worldmap.json
// works -- including output of issue-1/tools/worldmap-crawl.py:
//     WORLDMAP_DIR=/tmp/wm ./run.sh
(async () => {
  try {
    const list = await api('/api/scenarios');
    if (Array.isArray(list) && list.length) {
      SCENARIOS = list.map((s) => (typeof s === 'string' ? s : s.id));
      const sel = document.getElementById('scen');
      if (sel) {
        sel.innerHTML = SCENARIOS
          .map((s) => `<option value="${s}">${s}</option>`).join('');
      }
    }
  } catch (e) {
    console.warn('scenario discovery failed, using built-in list', e);
  }
  const wanted = new URLSearchParams(location.search).get('scenario');
  loadScenario(SCENARIOS.includes(wanted) ? wanted : SCENARIOS[0]);
})();

window.__wm = {
  get cy() { return cy; },
  S, loadScenario, doExpand, render, revealRoot, toggleCollapse, collapseAll,
  saveView, loadView, setTheme, select, fitAll, focusFit, revealAll,
  measureRendered: () => measureRendered(cy),
  applyLabelPolicy: (o) => applyLabelPolicy(cy, o),
  compensateZoom: () => compensateZoom(cy),
  verifyCollapse: (collapsed) => verify(model(), S.visible, new Set(collapsed)),
  aggregate: (collapsed) => aggregate(model(), S.visible, new Set(collapsed || [])).stats,
  viewPayload,
  worldPositions,
  layoutMetrics: () => S.lastMetrics,
  setLayoutMode: (m) => { S.layoutMode = m; },
};
