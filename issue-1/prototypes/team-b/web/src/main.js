import './viewer.css';
import cytoscape from 'cytoscape';
import elk from 'cytoscape-elk';
import { Graphviz } from '@hpcc-js/wasm/graphviz';
import {
  makeCy, cyStyle, buildElements, duplicateUuids, parseGraphvizJson,
  applyPositions, layoutChurn, applyRoutes, applySavedRoutes, regularizeGrids,
} from './graph.js';

cytoscape.use(elk);

const API = '';               // same origin; the server serves this bundle
const $ = (s) => document.querySelector(s);

const S = {
  scenario: 's1-spacetop',
  model: { nodes: [], edges: [], findings: [] },
  meta: {},
  expansions: [],
  positions: { map: {}, lineage: {} },
  pinned: {},
  mode: 'map',
  theme: 'dark',
  timings: {},
  elkOk: true,
};
let cy = null;
let graphviz = null;

// ------------------------------------------------------------------ helpers
const byId = () => Object.fromEntries(S.model.nodes.map((n) => [n.id, n]));
const visibleIds = () => S.model.nodes.map((n) => n.id);

function remainingRelations(n) {
  const seen = {};
  for (const e of S.model.edges) {
    if (e.source === n.id || e.target === n.id) seen[e.kind] = (seen[e.kind] || 0) + 1;
  }
  const out = [];
  for (const [k, total] of Object.entries(n.rel_counts || {})) {
    const rem = total - (seen[k] || 0);
    out.push({ kind: k, total, remaining: rem });
  }
  // containment children that are not yet on screen
  return out.sort((a, b) => b.remaining - a.remaining || a.kind.localeCompare(b.kind));
}

function toast(msg, ms = 2600) {
  const el = document.createElement('div');
  el.className = 'toast'; el.textContent = msg;
  $('#overlay').appendChild(el);
  setTimeout(() => el.remove(), ms);
}
function busy(on, label = 'probing…') {
  const o = $('#overlay');
  const ex = o.querySelector('.busy');
  if (!on) { if (ex) ex.remove(); return; }
  if (ex) { ex.querySelector('.pill').textContent = label; return; }
  const d = document.createElement('div');
  d.className = 'busy'; d.innerHTML = `<div class="pill">${label}</div>`;
  o.appendChild(d);
}

async function jget(u) { const r = await fetch(API + u); if (!r.ok) throw new Error(await r.text()); return r.json(); }
async function jpost(u, b) {
  const r = await fetch(API + u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
  if (!r.ok) throw new Error(await r.text()); return r.json();
}

// ------------------------------------------------------------------- layout

async function graphvizPositions(ids) {
  const t0 = performance.now();
  const dot = await (await fetch(`${API}/api/dot/${S.scenario}?ids=${encodeURIComponent(ids.join(','))}`)).text();
  const tDot = performance.now() - t0;
  if (!graphviz) {
    const tw = performance.now();
    graphviz = await Graphviz.load();
    S.timings.wasmLoadMs = Math.round(performance.now() - tw);
  }
  const t1 = performance.now();
  const raw = graphviz.layout(dot, 'json', 'dot');
  const gvMs = performance.now() - t1;
  const parsed = parseGraphvizJson(raw);
  parsed.gridded = regularizeGrids(parsed.nodes);
  S.timings.dotFetchMs = Math.round(tDot);
  S.timings.gvMs = Math.round(gvMs);
  S.timings.dotBytes = dot.length;
  S.lastDot = dot;
  return parsed;
}

async function elkPositions() {
  // Take the fans out of ELK's hands first. ELK layered is correct and useless
  // for a 60-way fan -- it puts all 60 forks in one 4500px-tall layer and then
  // strands the rest of the graph at the far end of that column. So: detect
  // fans, remove them, lay out the skeleton, put the fans back as grids.
  const fans = detectFans(cy);
  const fanIds = new Set(fans.flatMap((f) => f.members.map((n) => n.id())));
  // Lay the skeleton out in a throwaway headless cytoscape instance rather
  // than removing elements from the live graph: removing and restoring under
  // the canvas renderer leaves stale edge caches and throws.
  const els = cy.elements().jsons().filter((el) => (el.group === 'nodes'
    ? !fanIds.has(el.data.id)
    : !fanIds.has(el.data.source) && !fanIds.has(el.data.target)));
  const tmp = cytoscape({
    headless: true, styleEnabled: true, elements: els,
    style: [{ selector: 'node', style: { width: 188, height: 54, shape: 'round-rectangle' } }],
  });

  const t0 = performance.now();
  const l = tmp.layout({
    name: 'elk',
    fit: false,
    elk: {
      algorithm: 'layered',
      'elk.direction': 'RIGHT',
      'elk.spacing.nodeNode': 34,
      'elk.layered.spacing.nodeNodeBetweenLayers': 150,
      'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
      'elk.edgeRouting': 'ORTHOGONAL',
    },
  });
  await l.run().promiseOn('layoutstop');
  S.timings.elkMs = Math.round(performance.now() - t0);

  const pos = {};
  tmp.nodes().forEach((n) => { pos[n.id()] = { ...n.position() }; });
  const skelY2 = tmp.nodes().length ? tmp.elements().boundingBox().y2 : 0;
  tmp.destroy();
  gridFans(pos, fans, skelY2 + 90);
  return pos;
}

/** A fan: every node whose only lineage edge lands on the same neighbour. */
function detectFans(c) {
  const groups = new Map();
  c.nodes().forEach((n) => {
    if (n.isParent()) return;
    const es = n.connectedEdges();
    if (es.length !== 1) return;
    const e = es[0];
    const other = e.source().id() === n.id() ? e.target() : e.source();
    const key = other.id() + '|' + ((e.data('raw') || {}).kind || '');
    if (!groups.has(key)) groups.set(key, { other, members: [] });
    groups.get(key).members.push(n);
  });
  return [...groups.values()].filter((g) => g.members.length >= 12);
}

/** Grid a fan next to its hub, most-active first and nearest the hub. */
function gridFans(pos, fans, gridTop) {
  const activity = (n) => {
    const d = n.data('raw') || {};
    if (typeof d.ahead_of_upstream === 'number') return d.ahead_of_upstream;
    const e = n.connectedEdges()[0];
    const r = e && e.data('raw');
    return (r ? (r.ahead || 0) : 0) + (d.merged === false ? 0.5 : 0);
  };
  const ROWS = 8, COLW = 214, ROWH = 66;
  for (const { other, members } of fans) {
    members.sort((a, b) => activity(b) - activity(a) || a.id().localeCompare(b.id()));
    const op = pos[other.id()] || other.position();
    // Below the skeleton, not on top of it: the lineage chain stays readable
    // and the fan reads as "…and these N others".
    const top = Math.max(gridTop, op.y - ((ROWS - 1) / 2) * ROWH);
    members.forEach((n, i) => {
      const c = Math.floor(i / ROWS), r = i % ROWS;
      pos[n.id()] = { x: op.x - 330 - c * COLW, y: top + r * ROWH };
    });
    S.timings.fan = `${members.length}\u2192${Math.ceil(members.length / ROWS)}\u00d7${ROWS} grid`;
  }
}

/** Graphviz `dot` with no clusters and TB ranking — the fallback lineage. */
async function graphvizLineagePositions(ids) {
  const dot = await (await fetch(`${API}/api/dot/${S.scenario}?ids=${encodeURIComponent(ids.join(','))}`)).text();
  const flat = dot.replace(/subgraph cluster_[^ ]* \{/g, '{').replace(/rankdir=LR/, 'rankdir=LR');
  if (!graphviz) graphviz = await Graphviz.load();
  return parseGraphvizJson(graphviz.layout(flat, 'json', 'dot')).nodes;
}

// ------------------------------------------------------------------- render

async function render({ anchor = null, animate = true } = {}) {
  const dup = duplicateUuids(S.model.nodes);
  const els = buildElements(S.model, { mode: S.mode, dupUuids: dup });
  const prev = { ...S.positions[S.mode] };

  cy.startBatch();
  cy.elements().remove();
  cy.add(els);
  cy.endBatch();

  let next = {};
  if (S.mode === 'map') {
    const g = await graphvizPositions(visibleIds());
    next = Object.fromEntries(Object.entries(g.nodes).map(([k, v]) => [k, { x: v.x, y: v.y }]));
    S.timings.bb = `${Math.round(g.bb.w)}×${Math.round(g.bb.h)}`;
    S.gvEdges = g.edges;
    S.gridded = g.gridded;
    if (g.gridded && g.gridded.size) S.timings.grid = `${g.gridded.size} nodes snapped to grid`;
    else delete S.timings.grid;
  } else {
    // seed with graphviz so ELK starts from something sane, then run ELK
    try {
      applyPositions(cy, await graphvizLineagePositions(visibleIds()));
      next = await elkPositions();
      S.elkOk = true;
    } catch (err) {
      console.warn('ELK failed, falling back to graphviz layered', err);
      S.elkOk = false;
      next = await graphvizLineagePositions(visibleIds());
      S.timings.elkMs = null;
    }
  }

  // Anchor: keep the node the user clicked at the same place on screen, so the
  // whole map does not slide out from under them after a re-layout.
  if (anchor && prev[anchor] && next[anchor]) {
    const dx = prev[anchor].x - next[anchor].x;
    const dy = prev[anchor].y - next[anchor].y;
    for (const k of Object.keys(next)) { next[k] = { x: next[k].x + dx, y: next[k].y + dy }; }
  }

  const churn = layoutChurn(prev, next);
  S.timings.churn = churn;

  // "keep placed nodes": pre-existing nodes hold their old coordinates and only
  // newly discovered ones take the Graphviz position.
  const keep = $('#opt-preserve').checked;
  const final = {};
  for (const [k, v] of Object.entries(next)) final[k] = (keep && prev[k]) ? prev[k] : v;
  for (const [k, v] of Object.entries(S.pinned)) if (final[k]) final[k] = v;

  S.positions[S.mode] = final;

  if (animate && Object.keys(prev).length) {
    cy.nodes().forEach((n) => {
      const p = final[n.id()];
      if (!p || n.isParent()) return;
      if (prev[n.id()]) { n.position(prev[n.id()]); n.animate({ position: p }, { duration: 420, easing: 'ease-out-cubic' }); }
      else n.position(p);
    });
  } else {
    applyPositions(cy, final);
  }

  // Replay Graphviz's own edge routing as cytoscape segments, so the picture
  // keeps dot's orthogonal-ish channels instead of a straight-line hairball.
  if (S.mode === 'map' && S.gvEdges && $('#opt-routes').checked && !keep) {
    S.routes = S.mapRoutes = applyRoutes(cy, S.gvEdges, final, S.gridded);
  } else if (S.mode === 'map' && S.routes && $('#opt-routes').checked) {
    applySavedRoutes(cy, S.routes);
    S.mapRoutes = S.routes;
  } else {
    S.routes = null;
    cy.edges().removeClass('routed');
  }

  applyGrey();
  paintFindings();
  paintUnreachable();
  paintStats();
  paintTimings();
}

/** Some worldmaps are not one connected component. s3-forks has a second one
 *  (the template-sibling trap), and no amount of clicking "expand" from the
 *  seed will ever reach it -- an honest limit of expansion-only UIs. Offer the
 *  entry point explicitly instead of pretending the graph is connected. */
function paintUnreachable() {
  const box = $('#unreach'); const head = $('#unreach-h');
  const have = new Set(visibleIds());
  const roots = (S.otherRoots || []).filter((r) => !have.has(r.root));
  head.style.display = roots.length ? '' : 'none';
  box.innerHTML = '';
  if (!roots.length) return;
  for (const r of roots) {
    const b = document.createElement('button');
    b.style.cssText = 'width:100%;text-align:left;margin-bottom:4px;line-height:1.35';
    b.innerHTML = `<b>${r.label}</b><br><span style="color:var(--muted);font-size:10.5px;font-family:var(--mono)">`
      + `separate component · ${r.size} nodes · reveal root</span>`;
    b.onclick = () => revealRoot(r.root);
    box.appendChild(b);
  }
}

async function revealRoot(id) {
  busy(true, 'revealing component root…');
  try {
    const mat = await jpost('/api/materialize', { scenario: S.scenario, ids: visibleIds().concat([id]) });
    S.model = { nodes: mat.nodes, edges: mat.edges, findings: mat.findings };
    S.expansions.push({ node: id, relation: 'reveal-root' });
    await render({ anchor: null, animate: false });
    toast(`revealed ${id} — expansion from the seed cannot reach it`);
  } catch (err) { toast('reveal failed: ' + err.message, 4000); }
  finally { busy(false); }
}

function applyGrey() {
  const grey = $('#opt-grey').checked;
  cy.nodes('.inactive').style('opacity', grey ? 0.6 : 1);
  cy.edges('.inactive').style('opacity', grey ? 0.18 : 0.8);
}

// -------------------------------------------------------------------- panels

function paintFindings() {
  const box = $('#findings');
  if (!S.model.findings.length) { box.innerHTML = '<p class="empty">nothing yet — explore</p>'; return; }
  box.innerHTML = '';
  for (const f of S.model.findings) {
    const d = document.createElement('div');
    d.className = 'finding ' + f.severity;
    d.innerHTML = `<span class="code">${f.severity}: ${f.code}</span>${f.message}`;
    d.onclick = () => {
      const eles = cy.nodes().filter((n) => f.nodes.includes(n.id()));
      if (!eles.length) return;
      // A finding often names two nodes; fitting to two boxes would slam the
      // viewport to 300%. Cap it and keep the surroundings in frame.
      cy.animate({ fit: { eles, padding: 160 } }, { duration: 420, complete: () => {
        if (cy.zoom() > 1) { cy.zoom(1); cy.center(eles); }
      } });
      eles.addClass('hl'); setTimeout(() => eles.removeClass('hl'), 2200);
    };
    box.appendChild(d);
  }
}

function paintStats() {
  const t = S.meta.total || { nodes: 0, edges: 0 };
  const nDist = S.model.nodes.filter((n) => n.type !== 'host').length;
  const unexp = S.model.nodes.filter((n) => remainingRelations(n).some((r) => r.remaining > 0)).length;
  $('#stats').innerHTML = `
    <div class="stat"><span>discovered</span><b>${S.model.nodes.length} / ${t.nodes} nodes</b></div>
    <div class="stat"><span>relations</span><b>${S.model.edges.length} / ${t.edges} edges</b></div>
    <div class="stat"><span>distributions</span><b>${nDist}</b></div>
    <div class="stat"><span>expansions</span><b>${S.expansions.length}</b></div>
    <div class="stat"><span>with more to probe</span><b>${unexp}</b></div>`;
}

function paintTimings() {
  const t = S.timings;
  const bits = [];
  if (t.wasmLoadMs != null) bits.push(`wasm load <b>${t.wasmLoadMs}ms</b>`);
  if (S.mode === 'map') {
    bits.push(`DOT <b>${t.dotBytes || 0}B</b> in <b>${t.dotFetchMs}ms</b>`);
    bits.push(`graphviz dot <b>${t.gvMs}ms</b>`);
    if (t.bb) bits.push(`bb <b>${t.bb}</b>`);
    if (t.grid) bits.push(t.grid);
  } else {
    bits.push(S.elkOk ? `elk layered <b>${t.elkMs}ms</b>` : `<b>elk failed → graphviz fallback</b>`);
    if (t.fan) bits.push(`fan regrid <b>${t.fan}</b>`);
  }
  if (t.probeMs) bits.push(`probe <b>${t.probeMs}ms</b>`);
  if (t.churn) bits.push(`churn med <b>${t.churn.median}px</b> max <b>${t.churn.max}px</b> (${t.churn.moved}/${t.churn.n} moved)`);
  if (t.firstRenderMs) bits.push(`first render <b>${t.firstRenderMs}ms</b>`);
  $('#timings').innerHTML = bits.join(' · ');
}

function inspector(node) {
  const old = $('#overlay .inspector'); if (old) old.remove();
  if (!node) return;
  const n = node.data('raw');
  const box = document.createElement('div');
  box.className = 'hud inspector';
  const rels = remainingRelations(n);
  const kv = [];
  const put = (k, v) => { if (v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length)) kv.push(`<span>${k}</span><div>${v}</div>`); };
  put('id', n.id); put('on host', n.on_host); put('vcs', n.vcs); put('layout', n.layout);
  put('annex', n.annex_mode); put('annex uuid', n.annex_uuid); put('dataset id', n.dataset_id);
  put('special', n.special_remote_type); put('trust', n.trust); put('branch', n.branch);
  put('result br', n.result_branch); put('merged', n.result_branch ? String(!!n.merged) : undefined);
  put('forge', n.forge); put('stars', n.stars);
  put('ahead of upstream', n.ahead_of_upstream); put('behind upstream', n.behind_upstream);
  put('packaging', (n.packaging || []).join(', '));
  box.innerHTML = `<button class="close">×</button>
    <h3>${n.label || n.id}</h3><div class="kind">${n.type}${n.is_seed ? ' · seed' : ''}</div>
    <div class="kv">${kv.join('')}</div>
    <div style="font-size:10.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.07em">expand along</div>
    <div class="expandbtns"></div>`;
  const btns = box.querySelector('.expandbtns');
  if (!rels.length) btns.innerHTML = '<p class="empty">no relations recorded</p>';
  for (const r of rels) {
    const b = document.createElement('button');
    b.innerHTML = `<span>${r.kind.replace(/_/g, ' ')}</span><span class="n">${r.remaining ? '+' + r.remaining : 'all shown'} / ${r.total}</span>`;
    b.disabled = r.remaining <= 0;
    b.onclick = () => doExpand(n.id, r.kind);
    btns.appendChild(b);
  }
  box.querySelector('.close').onclick = () => box.remove();
  $('#overlay').appendChild(box);
}

// ------------------------------------------------------------------- actions

async function doExpand(nodeId, relation) {
  busy(true, `probing ${relation} on ${nodeId}…`);
  const t0 = performance.now();
  try {
    const res = await jpost('/api/expand', {
      scenario: S.scenario, node_id: nodeId, relation, known: visibleIds(),
    });
    S.timings.probeMs = res.probe_ms;
    S.timings.expandRoundTripMs = Math.round(performance.now() - t0);
    const have = new Set(visibleIds());
    const added = res.nodes.filter((n) => !have.has(n.id));
    S.model.nodes = S.model.nodes.concat(added);
    const eh = new Set(S.model.edges.map((e) => e.id));
    S.model.edges = S.model.edges.concat(res.edges.filter((e) => !eh.has(e.id)));
    S.model.findings = res.findings;
    S.otherRoots = res.other_roots || S.otherRoots;
    S.expansions.push({ node: nodeId, relation });
    await render({ anchor: nodeId });
    const el = cy.getElementById(nodeId);
    if (el.length) inspector(el);
    toast(added.length ? `+${added.length} nodes discovered via ${relation}` : `nothing new via ${relation}`);
  } catch (err) {
    toast('expand failed: ' + err.message, 5000);
    console.error(err);
  } finally { busy(false); }
}

async function expandWave() {
  const targets = S.model.nodes.filter((n) => n.type !== 'host');
  let total = 0;
  busy(true, 'probing every visible node…');
  for (const n of targets) {
    for (const r of remainingRelations(n)) {
      if (r.remaining <= 0) continue;
      try {
        const res = await jpost('/api/expand', { scenario: S.scenario, node_id: n.id, relation: r.kind, known: visibleIds() });
        const have = new Set(visibleIds());
        const added = res.nodes.filter((x) => !have.has(x.id));
        S.model.nodes = S.model.nodes.concat(added);
        const eh = new Set(S.model.edges.map((e) => e.id));
        S.model.edges = S.model.edges.concat(res.edges.filter((e) => !eh.has(e.id)));
        S.model.findings = res.findings;
        S.expansions.push({ node: n.id, relation: r.kind });
        total += added.length;
      } catch (e) { console.warn(e); }
    }
  }
  busy(false);
  await render({ animate: false });
  fitCapped(40);
  toast(`wave complete: +${total} nodes`);
}

async function loadScenario(id, { fit = true } = {}) {
  S.scenario = id;
  busy(true, 'loading seed…');
  const t0 = performance.now();
  const seed = await jget(`/api/seed/${id}`);
  S.meta = seed;
  S.model = { nodes: seed.nodes, edges: seed.edges, findings: seed.findings };
  S.otherRoots = seed.other_roots || [];
  S.expansions = []; S.positions = { map: {}, lineage: {} }; S.pinned = {};
  $('#scen-sub').innerHTML = `<b>${seed.title}</b><br>${seed.subtitle}`;
  await render({ animate: false });
  S.timings.firstRenderMs = Math.round(performance.now() - t0);
  if (fit) fitCapped(60);
  busy(false);
  paintScenarios(); await refreshViewNames(); paintTimings();
}

async function saveView(name) {
  const body = {
    scenario: S.scenario,
    view: { mode: S.mode, theme: S.theme, zoom: cy.zoom(), pan: cy.pan() },
    visible: visibleIds(),
    expansions: S.expansions,
    pinned: S.pinned,
    positions: S.positions,
    routes: S.mapRoutes || {},
  };
  const r = await fetch(`${API}/api/view/${S.scenario}?name=${encodeURIComponent(name)}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const j = await r.json();
  if (!r.ok) { toast('save failed: ' + (j.error || r.status), 4000); return null; }
  toast(`saved ${j.saved} (${j.bytes} B, ${j.nodes} nodes)`);
  await refreshViewNames(name);
  return j;
}

async function loadView(name) {
  busy(true, 'restoring view…');
  try {
    const v = await jget(`/api/view/${S.scenario}?name=${encodeURIComponent(name)}`);
    const mat = await jpost('/api/materialize', { scenario: S.scenario, ids: v.visible });
    S.meta = mat;
    S.model = { nodes: mat.nodes, edges: mat.edges, findings: mat.findings };
    S.expansions = v.expansions || [];
    S.positions = { map: v.positions?.map || {}, lineage: v.positions?.lineage || {} };
    S.pinned = v.pinned || {};
    setMode(v.view?.mode || 'map', false);
    setTheme(v.view?.theme || S.theme);
    // Rebuild elements and apply the *saved* coordinates verbatim — no layout.
    const dup = duplicateUuids(S.model.nodes);
    cy.startBatch(); cy.elements().remove();
    cy.add(buildElements(S.model, { mode: S.mode, dupUuids: dup })); cy.endBatch();
    applyPositions(cy, S.positions[S.mode]);
    S.routes = S.mapRoutes = v.routes || null;
    if (S.mode === 'map' && S.routes) applySavedRoutes(cy, S.routes);
    cy.zoom(v.view?.zoom || 1); cy.pan(v.view?.pan || { x: 0, y: 0 });
    applyGrey(); paintFindings(); paintUnreachable(); paintStats(); paintTimings();
    toast(`restored ${v.visible.length} nodes from ${name} — layout not recomputed`);
  } catch (err) { toast('load failed: ' + err.message, 4500); }
  finally { busy(false); }
}

async function refreshViewNames(select) {
  try {
    const j = await jget(`/api/views/${S.scenario}`);
    const sel = $('#viewname');
    sel.innerHTML = j.names.map((n) => `<option${n === select ? ' selected' : ''}>${n}</option>`).join('')
      || '<option value="">(none saved)</option>';
    $('#btn-load').disabled = !j.names.length;
  } catch { /* ignore */ }
}

/** cy.fit() on two nodes zooms to 300%. Cap it so the seed looks like a map. */
function fitCapped(pad = 55, maxZoom = 1.0) {
  cy.fit(undefined, pad);
  if (cy.zoom() > maxZoom) { const c = { x: cy.width() / 2, y: cy.height() / 2 }; cy.zoom({ level: maxZoom, renderedPosition: c }); cy.center(); }
}

function setMode(m, rerender = true) {
  S.mode = m;
  $('#mode-map').classList.toggle('on', m === 'map');
  $('#mode-lineage').classList.toggle('on', m === 'lineage');
  if (rerender) render({ animate: false }).then(() => fitCapped(50));
}

function setTheme(t) {
  S.theme = t;
  document.documentElement.dataset.theme = t;
  cy.style(cyStyle(t));
  applyGrey();
}

function paintScenarios() {
  const box = $('#scenlist');
  box.innerHTML = '';
  for (const s of S.scenarios) {
    const b = document.createElement('button');
    b.className = s.id === S.scenario ? 'on' : '';
    b.innerHTML = `<b>${s.id}</b><span>${s.stats.nodes} nodes · ${s.stats.edges} edges</span>`;
    b.onclick = () => loadScenario(s.id);
    box.appendChild(b);
  }
}

function paintLegend() {
  const rows = [
    ['host cluster', 'background:var(--panel2);border-color:var(--line)'],
    ['forge cluster', 'border-color:#a371f7'],
    ['RIA / container', 'border-style:dashed;border-color:#39c5cf'],
    ['seed clone', 'border-color:#58a6ff;border-width:3px'],
    ['duplicate annex UUID', 'border-color:#f85149;border-width:3px;background:#3d1416'],
    ['dead / inactive', 'opacity:.4'],
  ];
  $('#legend').innerHTML = rows.map(([t, s]) => `<div><i style="${s}"></i>${t}</div>`).join('')
    + '<div style="margin-top:5px">edge label = <b>remote name</b> · ▲ahead ▼behind</div>';
}

// ---------------------------------------------------------------------- boot

async function main() {
  cy = makeCy($('#cy'), S.theme);
  cy.on('tap', 'node', (ev) => inspector(ev.target));
  cy.on('tap', (ev) => { if (ev.target === cy) inspector(null); });
  cy.on('dbltap', 'node.dist', (ev) => {
    const rels = remainingRelations(ev.target.data('raw')).filter((r) => r.remaining > 0);
    if (rels.length) doExpand(ev.target.id(), rels[0].kind);
  });
  cy.on('dragfree', 'node', (ev) => {
    const n = ev.target; if (n.isParent()) return;
    S.pinned[n.id()] = { ...n.position() };
    S.positions[S.mode][n.id()] = { ...n.position() };
    toast(`pinned ${n.id()}`);
  });

  S.scenarios = await jget('/api/scenarios');
  paintLegend();
  $('#mode-map').onclick = () => setMode('map');
  $('#mode-lineage').onclick = () => setMode('lineage');
  $('#btn-fit').onclick = () => fitCapped(50);
  $('#btn-theme').onclick = () => setTheme(S.theme === 'dark' ? 'light' : 'dark');
  $('#btn-expand-all').onclick = expandWave;
  $('#opt-grey').onchange = applyGrey;
  $('#opt-routes').onchange = () => render({ animate: false });
  $('#btn-save').onclick = () => saveView($('#newname').value.trim() || 'default');
  $('#btn-load').onclick = () => loadView($('#viewname').value);
  $('#dlg-close').onclick = () => $('#dlg').close();
  $('#btn-dot').onclick = async () => {
    const dot = await (await fetch(`${API}/api/dot/${S.scenario}?ids=${encodeURIComponent(visibleIds().join(','))}`)).text();
    $('#dlg-title').textContent = `DOT for ${S.scenario} (${S.model.nodes.length} visible nodes, ${dot.length} B)`;
    $('#dlg-body').textContent = dot;
    $('#dlg-note').textContent =
      'Server-side worldmap.json → DOT. The browser runs this exact text through @hpcc-js/wasm '
      + "Graphviz (format 'json'), reads node pos= and cluster bb=, and feeds them to cytoscape as a preset layout.";
    $('#dlg').showModal();
  };
  $('#btn-export').onclick = async () => {
    const name = $('#newname').value.trim() || 'default';
    const saved = await saveView(name);
    if (!saved) return;
    window.open(`${API}/export/${S.scenario}?name=${encodeURIComponent(name)}`, '_blank');
  };

  await loadScenario('s1-spacetop');
  window.__wm = { S, cy, render, doExpand, loadScenario, saveView, loadView, setMode, setTheme, expandWave, revealRoot };
}
main();
