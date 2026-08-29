// Entry point for the self-contained single-file HTML export.
// No fetch, no server, no layout engine: the saved view already carries the
// Graphviz-computed coordinates, which is the whole point of treating layout
// as data. Interaction (pan, zoom, select, inspect, theme, view switch) is live.
import cytoscape from 'cytoscape';
import { makeCy, cyStyle, buildElements, duplicateUuids, applyPositions, applySavedRoutes } from './graph.js';

const P = JSON.parse(document.getElementById('worldmap-data').textContent);
const positions = (P.view && P.view.positions) || {};
const saved = (P.view && P.view.view) || {};
let theme = saved.theme || 'dark';
let mode = positions[saved.mode || 'map'] ? (saved.mode || 'map') : (positions.map ? 'map' : 'lineage');

const app = document.getElementById('app');
app.innerHTML = `
  <aside class="side">
    <h1>worldmap <span class="tag">exported · offline</span></h1>
    <p class="sub"><b>${P.title || P.scenario}</b><br>${P.subtitle || ''}</p>
    <h2>Findings</h2><div id="findings"></div>
    <h2>Snapshot</h2><div id="stats"></div>
    <h2>Legend</h2>
    <div class="legend">
      <div><i style="background:var(--panel2);border-color:var(--line)"></i>host cluster</div>
      <div><i style="border-color:#39c5cf;border-style:dashed"></i>RIA / container</div>
      <div><i style="border-color:#58a6ff;border-width:3px"></i>seed clone</div>
      <div><i style="border-color:#f85149;border-width:3px;background:#3d1416"></i>duplicate annex UUID</div>
      <div><i style="opacity:.4"></i>dead / inactive</div>
      <div style="margin-top:5px">edge label = <b>remote name</b> · ▲ahead ▼behind</div>
    </div>
  </aside>
  <main class="main">
    <div class="hud top">
      <button id="m-map">cluster map</button>
      <button id="m-lin">layered lineage</button>
      <button id="fit">fit</button>
      <label class="chk"><input type="checkbox" id="grey" checked> grey inactive</label>
      <button id="th">☀/☾</button>
    </div>
    <div id="cy"></div>
    <div class="hud bottom" id="foot"></div>
    <div id="overlay"></div>
  </main>`;

document.documentElement.dataset.theme = theme;
const cy = makeCy(document.getElementById('cy'), theme);
const model = { nodes: P.nodes, edges: P.edges, findings: P.findings || [] };

function paint(fit = true) {
  const dup = duplicateUuids(model.nodes);
  cy.startBatch(); cy.elements().remove();
  cy.add(buildElements(model, { mode, dupUuids: dup })); cy.endBatch();
  applyPositions(cy, positions[mode] || {});
  if (mode === 'map') applySavedRoutes(cy, (P.view && P.view.routes) || null);
  grey();
  document.getElementById('m-map').classList.toggle('on', mode === 'map');
  document.getElementById('m-lin').classList.toggle('on', mode === 'lineage');
  document.getElementById('m-lin').disabled = !positions.lineage || !Object.keys(positions.lineage).length;
  if (fit) { cy.fit(undefined, 50); if (cy.zoom() > 1) { cy.zoom(1); cy.center(); } }
}
function grey() {
  const on = document.getElementById('grey').checked;
  cy.nodes('.inactive').style('opacity', on ? 0.6 : 1);
  cy.edges('.inactive').style('opacity', on ? 0.18 : 0.8);
}
function inspector(node) {
  const old = document.querySelector('#overlay .inspector'); if (old) old.remove();
  if (!node) return;
  const n = node.data('raw'); const kv = [];
  const put = (k, v) => { if (v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length)) kv.push(`<span>${k}</span><div>${v}</div>`); };
  put('id', n.id); put('on host', n.on_host); put('vcs', n.vcs); put('layout', n.layout);
  put('annex', n.annex_mode); put('annex uuid', n.annex_uuid); put('dataset id', n.dataset_id);
  put('special', n.special_remote_type); put('trust', n.trust); put('branch', n.branch);
  put('result br', n.result_branch); put('forge', n.forge); put('stars', n.stars);
  put('ahead of upstream', n.ahead_of_upstream); put('behind upstream', n.behind_upstream);
  const box = document.createElement('div');
  box.className = 'hud inspector';
  box.innerHTML = `<button class="close">×</button><h3>${n.label || n.id}</h3>
    <div class="kind">${n.type}${n.is_seed ? ' · seed' : ''}</div><div class="kv">${kv.join('')}</div>
    <p class="empty">static export — expansion needs the walker</p>`;
  box.querySelector('.close').onclick = () => box.remove();
  document.getElementById('overlay').appendChild(box);
}

document.getElementById('findings').innerHTML = model.findings.length
  ? model.findings.map((f) => `<div class="finding ${f.severity}" data-n="${f.nodes.join(',')}">
      <span class="code">${f.severity}: ${f.code}</span>${f.message}</div>`).join('')
  : '<p class="empty">none in this snapshot</p>';
document.getElementById('findings').onclick = (ev) => {
  const el = ev.target.closest('.finding'); if (!el) return;
  const ids = el.dataset.n.split(',');
  const eles = cy.nodes().filter((n) => ids.includes(n.id()));
  if (eles.length) {
    cy.animate({ fit: { eles, padding: 160 } }, { duration: 400, complete: () => {
      if (cy.zoom() > 1) { cy.zoom(1); cy.center(eles); }
    } });
    eles.addClass('hl'); setTimeout(() => eles.removeClass('hl'), 2000);
  }
};
document.getElementById('stats').innerHTML = `
  <div class="stat"><span>nodes</span><b>${model.nodes.length}</b></div>
  <div class="stat"><span>edges</span><b>${model.edges.length}</b></div>
  <div class="stat"><span>view saved</span><b>${(P.view && P.view.saved_at) || '?'}</b></div>
  <div class="stat"><span>exported</span><b>${P.exported_at || '?'}</b></div>
  <div class="stat"><span>layout</span><b>${(P.view && P.view.layout_engine) || 'preset'}</b></div>`;
document.getElementById('foot').innerHTML =
  `positions restored from the saved view — <b>no layout engine in this file</b> · `
  + `scenario <b>${P.scenario}</b> · offline, file:// safe`;

document.getElementById('m-map').onclick = () => { mode = 'map'; paint(); };
document.getElementById('m-lin').onclick = () => { mode = 'lineage'; paint(); };
document.getElementById('fit').onclick = () => { cy.fit(undefined, 50); if (cy.zoom() > 1) { cy.zoom(1); cy.center(); } };
document.getElementById('grey').onchange = grey;
document.getElementById('th').onclick = () => {
  theme = theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
  cy.style(cyStyle(theme)); grey();
};
cy.on('tap', 'node', (ev) => inspector(ev.target));
cy.on('tap', (ev) => { if (ev.target === cy) inspector(null); });

paint();
window.__wm = { cy, model, positions };
