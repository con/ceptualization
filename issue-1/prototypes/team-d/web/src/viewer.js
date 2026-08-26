// Entry point for the self-contained single-file HTML export.
// Adapted from team-b/web/src/viewer.js (same repo, same licence).
//
// No fetch, no server, no layout engine: the saved view carries tier-1 boxes
// and tier-2 offsets, and world positions are reconstructed from them here.
// Interaction (pan, zoom, select, inspect, collapse, label-on-demand, theme)
// is live.
import { makeCy, cyStyle, buildElements, duplicateUuids, nameDisagreements } from './graph.js';
import { aggregate } from './collapse.js';
import { applyLabelPolicy, compensateZoom, measureRendered } from './labels.js';
import { worldPositions, sizesFromView } from './viewpos.js';

const P = JSON.parse(document.getElementById('worldmap-data').textContent);
const V = P.view || {};
const saved = V.view || {};
let theme = saved.theme || 'dark';
let labelMode = saved.labels || 'demand';
let selected = null;

const byId = Object.fromEntries(P.nodes.map((n) => [n.id, n]));
const visible = new Set(P.nodes.map((n) => n.id));
let collapsed = new Set(V.collapsed || []);
const model = {
  byId,
  edges: P.edges,
  childrenOf: (id) => P.nodes.filter((n) => n.parent === id).map((n) => n.id).sort(),
};
const world = worldPositions(V);
const sizeMap = sizesFromView(V);
const sizes = {
  get: (id) => sizeMap[id] || { w: 210, h: 76 },
};

const app = document.getElementById('app');
app.innerHTML = `
  <aside class="side">
    <h1>worldmap <span class="tag">exported · offline</span></h1>
    <p class="sub"><b>${P.title || P.scenario}</b><br>${P.subtitle || ''}</p>
    <h2>Reach</h2><div class="reach" id="reach"></div>
    <h2>Findings</h2><div id="findings"></div>
    <h2>Remote-name disagreement</h2><div id="disagree"></div>
    <h2>Snapshot</h2><div id="stats"></div>
    <h2>Legend</h2>
    <div class="legend">
      <div><i style="background:var(--panel2)"></i>container box (tier 1)</div>
      <div><i style="border-color:var(--store);border-style:dashed"></i>RIA store / superdataset</div>
      <div><i style="border-color:var(--accent);border-width:3px"></i>seed clone</div>
      <div><i style="border-color:var(--err);border-width:3px"></i>duplicate annex UUID</div>
      <div><i style="border-color:var(--disagree);border-width:3px"></i>two clones, two names</div>
    </div>
  </aside>
  <main class="main">
    <div class="hud top">
      <button id="fit">fit</button>
      <span style="color:var(--sub)">labels</span>
      <button id="lbl-demand">on demand</button>
      <button id="lbl-all">all</button>
      <button id="lbl-none">none</button>
      <button id="th">☀/☾</button>
    </div>
    <div id="cy"></div>
    <div class="hud bottom" id="foot"></div>
  </main>`;

document.documentElement.dataset.theme = theme;
const cy = makeCy(document.getElementById('cy'), theme);

function paint() {
  const view = aggregate(model, visible, collapsed);
  const dis = nameDisagreements(P.nodes, P.edges, view.shown);
  const els = buildElements(view, model, sizes, {
    dupUuids: duplicateUuids(P.nodes),
    disagree: dis,
    collapsed,
  });
  cy.startBatch();
  cy.elements().remove();
  cy.add(els);
  cy.nodes().forEach((n) => { const p = world[n.id()]; if (p) n.position(p); });
  cy.endBatch();
  applyLabelPolicy(cy, { mode: labelMode, selected });
  compensateZoom(cy);
  document.getElementById('disagree').innerHTML = dis.size
    ? [...dis.entries()].map(([id, names]) => `<div class="finding warning">
        <span class="code">name disagreement</span><b>${(byId[id] || {}).label || id}</b> is called
        ${names.map((x) => `<span style="color:var(--disagree)">${x.name}</span> by ${x.n}`).join(', ')}</div>`).join('')
    : '<p class="empty">none in this snapshot</p>';
  document.getElementById('stats').innerHTML = `
    <div class="stat"><span>drawn nodes</span><b>${view.stats.drawnNodes}</b></div>
    <div class="stat"><span>drawn edges</span><b>${view.stats.drawnEdges} / ${view.stats.rawEdges} raw</b></div>
    <div class="stat"><span>view saved</span><b>${V.saved_at || '?'}</b></div>
    <div class="stat"><span>exported</span><b>${P.exported_at || '?'}</b></div>`;
  document.getElementById('foot').innerHTML =
    'tier-1 boxes and tier-2 offsets restored from the saved view — '
    + `<b>no layout engine in this file</b> · scenario <b>${P.scenario}</b> · file:// safe · `
    + `edge labels rendered at <b>${compensateZoom(cy).renderedPx} px</b>`;
  ['demand', 'all', 'none'].forEach((k) => document.getElementById('lbl-' + k).classList.toggle('on', k === labelMode));
}

const r = P.reach || {};
document.getElementById('reach').innerHTML = `
  <div class="big ${(r.total - r.reachable_relations_only) ? 'warn' : 'zero'}">${(r.total || 0) - (r.reachable_relations_only || 0)}</div>
  <div class="lbl">nodes not reachable from this snapshot by probing relations
    (${r.visible || 0} of ${r.total || 0} on map)</div>
  <ul><li><span>only reachable via <code>contains</code></span><b>${r.needs_contains || 0}</b></li></ul>`;

document.getElementById('findings').innerHTML = (P.findings || []).length
  ? P.findings.map((f) => `<div class="finding ${f.severity}" data-n="${f.nodes.join(',')}">
      <span class="code">${f.severity}: ${f.code}</span>${f.message}</div>`).join('')
  : '<p class="empty">none in this snapshot</p>';
document.getElementById('findings').onclick = (ev) => {
  const t = ev.target.closest('.finding');
  if (!t) return;
  const ids = t.dataset.n.split(',');
  const eles = cy.nodes().filter((n) => ids.includes(n.id()));
  if (!eles.length) return;
  cy.fit(eles, 200);
  if (cy.zoom() > 1.4) { cy.zoom(1.4); cy.center(eles); }
  compensateZoom(cy);
  eles.addClass('hl');
  setTimeout(() => cy.elements().removeClass('hl'), 2500);
};

function inspector(node) {
  const old = document.querySelector('.inspector');
  if (old) old.remove();
  if (!node) return;
  const n = node.data('raw');
  if (!n) return;
  const kv = [];
  const put = (k, v) => { if (v !== undefined && v !== null && v !== '') kv.push(`<span>${k}</span><div>${v}</div>`); };
  put('id', n.id); put('on host', n.on_host); put('vcs', n.vcs); put('layout', n.layout);
  put('annex', n.annex_mode); put('annex uuid', n.annex_uuid); put('dataset id', n.dataset_id);
  put('special', n.special_remote_type); put('trust', n.trust); put('branch', n.branch);
  put('result branch', n.result_branch); put('forge', n.forge); put('stars', n.stars);
  const box = document.createElement('div');
  box.className = 'hud inspector';
  box.innerHTML = `<button class="close">×</button><h3>${n.label || n.id}</h3>
    <div class="kind">${n.type}${n.is_seed ? ' · seed' : ''}</div><div class="kv">${kv.join('')}</div>
    <p class="empty">static export — expansion needs the walker</p>`;
  box.querySelector('.close').onclick = () => box.remove();
  document.querySelector('.main').appendChild(box);
}

cy.on('tap', 'node', (ev) => { selected = ev.target.id(); applyLabelPolicy(cy, { mode: labelMode, selected }); compensateZoom(cy); inspector(ev.target); });
cy.on('dbltap', 'node', (ev) => {
  const id = ev.target.id();
  if (model.childrenOf(id).length) {
    if (collapsed.has(id)) collapsed.delete(id); else collapsed.add(id);
    paint();
  }
});
cy.on('tap', (ev) => { if (ev.target === cy) { selected = null; applyLabelPolicy(cy, { mode: labelMode }); compensateZoom(cy); inspector(null); } });
let raf = null;
cy.on('zoom pan', () => { if (raf) return; raf = requestAnimationFrame(() => { raf = null; compensateZoom(cy); }); });

document.getElementById('fit').onclick = () => { cy.fit(undefined, 55); if (cy.zoom() > 1.4) { cy.zoom(1.4); cy.center(); } compensateZoom(cy); };
document.getElementById('th').onclick = () => {
  theme = theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
  const z = cy.zoom(), p = cy.pan();
  cy.elements().remove();      // restyle an EMPTY graph, then rebuild
  cy.style(cyStyle(theme));
  paint();
  cy.zoom(z); cy.pan(p); compensateZoom(cy);
};
for (const k of ['demand', 'all', 'none']) {
  document.getElementById('lbl-' + k).onclick = () => { labelMode = k; paint(); };
}

paint();
if (saved.zoom && saved.pan) { cy.zoom(saved.zoom); cy.pan(saved.pan); compensateZoom(cy); }
else { cy.fit(undefined, 55); compensateZoom(cy); }

window.__wm = { cy, P, measureRendered: () => measureRendered(cy) };
