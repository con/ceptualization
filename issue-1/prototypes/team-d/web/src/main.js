import './style.css';
import {
  makeCy, cyStyle, buildElements, duplicateUuids, nameDisagreements,
} from './graph.js';
import { TwoTierLayout, startWorker, call } from './layout.js';
import { aggregate, verify } from './collapse.js';
import { applyLabelPolicy, compensateZoom, measureRendered } from './labels.js';
import { worldPositions } from './viewpos.js';
import { LEAF } from './geometry.js';

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

const parentOf = (id) => {
  const n = S.byId[id];
  return n && n.parent && S.visible.has(n.parent) ? n.parent : null;
};
const childrenVisible = (id) => {
  if (S.collapsed.has(id)) return [];
  return [...S.visible].filter((k) => S.byId[k] && S.byId[k].parent === id).sort();
};
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
  const view = aggregate(m, S.visible, S.collapsed);

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
    const res = await S.layout.run(g, { mode: S.layoutMode, reason, inside, focus });
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
  S.byId = {}; S.edges = []; S.findings = []; S.visible = new Set();
  S.collapsed = new Set(); S.expansions = []; S.selected = null;
  S.layout = new TwoTierLayout();
  const t0 = performance.now();
  const p = await api(`/api/seed/${name}`);
  S.title = p.title; S.subtitle = p.subtitle || '';
  S.walkable = p.walkable;
  mergePayload(p);
  S.timings.seedMs = +(performance.now() - t0).toFixed(1);
  await render({ fit: true, reason: 'seed' });
  S.timings.firstPaintMs = +(performance.now() - t0).toFixed(1);
  document.getElementById('scen').value = name;
  document.getElementById('title').innerHTML = `<b>${S.title}</b><br>${S.subtitle || ''}`;
  paintPanels(S.view);
}

async function doExpand(nodeId, relation, opts = {}) {
  if (S.busy) return null;
  S.busy = true; toast(`probing ${relation} of ${nodeId}…`, true);
  const t0 = performance.now();
  try {
    const p = await post('/api/expand', {
      scenario: S.scenario, node_id: nodeId, relation,
      known: [...S.visible], nodelay: !!opts.nodelay,
    });
    const netMs = performance.now() - t0;
    const newIds = (p.nodes || []).map((n) => n.id);
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
  if (S.collapsed.has(id)) S.collapsed.delete(id); else S.collapsed.add(id);
  await render({ reason: 'collapse ' + id });
}

async function collapseAll(on) {
  S.collapsed = new Set();
  if (on) {
    for (const id of S.visible) {
      if (childrenVisible(id).length && !parentOf(id)) S.collapsed.add(id);
    }
  }
  await render({ reason: on ? 'collapse-all' : 'expand-all' });
}

function select(id) {
  S.selected = id;
  cy.elements().unselect();
  const n = cy.getElementById(id);
  if (n.nonempty()) n.select();
  applyLabelPolicy(cy, { mode: S.labelMode, selected: id });
  compensateZoom(cy);
  paintInspector();
}

// ---------------------------------------------------------------- panels

function el(id) { return document.getElementById(id); }

function paintPanels(view) {
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
    + `edge labels rendered at <b>${compensateZoom(cy).renderedPx} px</b>`;

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
    ${n.child_count ? `<div class="rels"><button data-collapse="${n.id}">${S.collapsed.has(n.id) ? 'expand' : 'collapse'} container</button></div>` : ''}`;
  box.querySelector('.close').onclick = () => { S.selected = null; box.remove(); applyLabelPolicy(cy, { mode: S.labelMode }); };
  box.querySelectorAll('button[data-rel]').forEach((b) => {
    b.onclick = () => doExpand(n.id, b.dataset.rel);
  });
  const cb = box.querySelector('button[data-collapse]');
  if (cb) cb.onclick = () => toggleCollapse(n.id);
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
  for (const [id, l] of Object.entries(v.local || {})) S.layout.local.set(id, { x: l.x, y: l.y });
  S.layout.lastTop = new Set(Object.keys(v.containers || {}));
  for (const id of S.visible) {
    const kids = childrenVisible(id);
    if (kids.length) S.layout.lastKids.set(id, new Set(kids));
  }
  await render({ relayout: false, reason: 'restore' });
  setTheme(v.view && v.view.theme ? v.view.theme : S.theme);
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
  render({ relayout: false, reason: 'theme' }).then(() => {
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
  cy.on('tap', 'node', (ev) => select(ev.target.id()));
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
