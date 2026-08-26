import * as api from "./api.js";
import { state, resetGraph } from "./state.js";
import { byId, PERSPECTIVES } from "./perspectives.js";
import {
  initSigma, ingest, applyLayout, applyView, renderer, setTheme,
  collapseGroup, expandGroup, benchmark, collapsibleGroups, fitCamera, setCollapsed,
} from "./render.js";
import * as ui from "./ui.js";

const SEM_ZOOM_THRESHOLD = 1.55;   // camera.ratio above this = "zoomed out"
let scenarioList = [];
let bootT0 = performance.now();

/* --------------------------------------------------------------- actions */
const actions = {
  loadScenario, setPerspective, viewChanged, expandNode, toggleGroup,
  collapseAll, expandAll, focusNodes, loadSynthetic, bench, semanticZoom,
  fitAll: () => fitCamera(null, { animate: true }),
  setTheme: (t) => { setTheme(t); redrawChrome(); },
};

/* ------------------------------------------------------------------ boot */
async function boot() {
  setTheme("dark");
  initSigma(document.getElementById("sigma"));
  ui.mountUI(actions);
  wireSigma();
  startFpsMeter();
  scenarioList = (await api.listScenarios()).scenarios;
  ui.renderScenarios(scenarioList);
  await loadScenario("s1-spacetop");
}

function wireSigma() {
  renderer.on("clickNode", ({ node }) => {
    const a = state.graph.getNodeAttributes(node);
    if (a._meta) { toggleGroup(node); return; }
    state.selected = node;
    applyView();
    ui.renderInspector();
  });
  renderer.on("doubleClickNode", ({ node, event }) => {
    event.preventSigmaDefault();
    expandNode(node, "*");
  });
  renderer.on("enterNode", ({ node }) => { state.hovered = node; renderer.refresh({ skipIndexation: true }); });
  renderer.on("leaveNode", () => { state.hovered = null; renderer.refresh({ skipIndexation: true }); });
  renderer.on("clickStage", () => { state.selected = null; applyView(); ui.renderInspector(); });
  let t = null;
  renderer.getCamera().on("updated", () => {
    clearTimeout(t);
    t = setTimeout(() => semanticZoom(false), 130);
  });
}

/* ------------------------------------------------------------- scenarios */
async function loadScenario(id) {
  ui.toast("probing seed…", true);
  state.scenario = id; state.synthetic = false;
  const t0 = performance.now();
  const payload = await api.getSeed(id);
  resetGraph();
  renderer.setGraph(state.graph);
  state.meta = payload;
  state.findings = payload.findings || [];
  state.filters.kinds = new Set(byId(state.perspective).kinds);
  state.filters.hosts = new Set();
  ingest(payload, { reset: true });
  applyLayout({ warm: false });
  applyView();
  fitCamera();
  state.perf.firstRenderMs = performance.now() - t0;
  ui.toast(null);
  redrawChrome();
  ui.renderScenarios(scenarioList);
  document.title = payload.title + " — worldmap";
}

async function loadSynthetic(n) {
  ui.toast("generating synthetic " + n + "-node fixture…", true);
  state.synthetic = true;
  const t0 = performance.now();
  const payload = await api.getSynthetic(n);
  resetGraph();
  renderer.setGraph(state.graph);
  state.meta = payload;
  state.findings = payload.findings || [];
  state.filters.hosts = new Set();
  ingest(payload, { reset: true });
  const lay = applyLayout({ warm: false });
  applyView();
  fitCamera();
  state.perf.firstRenderMs = performance.now() - t0;
  ui.toast(null);
  redrawChrome();
  ui.renderScenarios(scenarioList);
  document.getElementById("bench-out").textContent =
    `synthetic ${payload.nodes.length} nodes / ${payload.edges.length} edges\n` +
    `layout ${lay.ms.toFixed(0)} ms · load+render ${state.perf.firstRenderMs.toFixed(0)} ms`;
}

/* ----------------------------------------------------------- perspective */
function setPerspective(id) {
  const t0 = performance.now();
  state.perspective = id;
  state.filters.kinds = new Set(byId(id).kinds);
  const ms = applyView();
  state.perf.lastSwitchMs = performance.now() - t0;
  ui.renderPerspectives();
  ui.renderFilters();
  ui.renderLegend();
  ui.renderHud();
  return ms;
}

function viewChanged() {
  applyView();
  ui.renderCounters();
  ui.renderHud();
}

/* --------------------------------------------------------------- expand */
let expanding = false;
async function expandNode(nodeId, relation) {
  if (expanding || state.synthetic) return;
  expanding = true;
  const label = state.graph.getNodeAttribute(nodeId, "label");
  ui.toast(`probing ${label} · ${relation === "*" ? "all relations" : relation}…`, true);
  const known = state.graph.nodes();
  const t0 = performance.now();
  try {
    const res = await api.expand(state.scenario, nodeId, relation, known);
    state.lastProbeMs = res.probe_ms;
    if (!res.nodes.length) {
      ui.toast(`nothing new behind ${label} (${res.probe_ms} ms)`, false);
      setTimeout(() => ui.toast(null), 1400);
    } else {
      ingest(res, {});
      applyLayout({ warm: true });
      applyView();
      fitCamera(null, { animate: true, duration: 450 });
      ui.toast(`+${res.nodes.length} nodes, +${res.edges.length} edges in ${res.probe_ms} ms`, false);
      setTimeout(() => ui.toast(null), 1600);
    }
    if (state.semanticZoom) semanticZoom(false);
  } catch (e) {
    ui.toast("expand failed: " + e.message, false);
    console.error(e);
  } finally {
    expanding = false;
    state.perf.lastExpandMs = performance.now() - t0;
    redrawChrome();
  }
}

/* ------------------------------------------------------------- grouping */
function toggleGroup(id) {
  if (state.collapsed.has(id)) expandGroup(id); else collapseGroup(id);
  applyView();
  redrawChrome();
}

function collapseAll() {
  setCollapsed(collapsibleGroups()
    .filter((gr) => (gr.depth || 0) === 0 || gr.members.length >= 6)
    .map((gr) => gr.id));
  applyView(); redrawChrome();
}
function expandAll() {
  setCollapsed([]);
  applyView(); redrawChrome();
}

let semTimer = null, semState = null;
function semanticZoom(force) {
  if (!state.semanticZoom) {
    if (semState === "collapsed" && force) { expandAll(); semState = null; }
    return;
  }
  const ratio = renderer.getCamera().ratio;
  const want = ratio > SEM_ZOOM_THRESHOLD ? "collapsed" : "expanded";
  if (want === semState && !force) return;
  semState = want;
  clearTimeout(semTimer);
  semTimer = setTimeout(() => {
    if (want === "collapsed") {
      setCollapsed(collapsibleGroups().filter((gr) => (gr.depth || 0) === 0).map((gr) => gr.id));
    } else {
      setCollapsed([]);
    }
    applyView(); redrawChrome();
  }, 40);
}

/* ---------------------------------------------------------------- focus */
function focusNodes(ids) {
  const g = state.graph;
  const live = ids.filter((i) => g.hasNode(i));
  if (!live.length) return;
  state.selected = live[0];
  applyView();
  fitCamera(live, { animate: true, pad: 220 });
  ui.renderInspector();
}

/* ------------------------------------------------------------ benchmark */
async function bench() {
  const btn = document.getElementById("bench");
  btn.disabled = true;
  const out = document.getElementById("bench-out");
  out.textContent = "running 3 s camera sweep…";
  const r = await benchmark(3000);
  out.textContent =
    `${r.nodes} nodes / ${r.edges} edges\n` +
    `mean ${r.meanMs} ms  (${r.fps} fps)\n` +
    `median ${r.medianMs} ms · p95 ${r.p95Ms} ms\n` +
    `layout ${state.perf.lastLayoutMs.toFixed(0)} ms · first render ${(state.perf.firstRenderMs || 0).toFixed(0)} ms`;
  btn.disabled = false;
  window.__bench = r;
  return r;
}

/* ---------------------------------------------------------------- chrome */
function redrawChrome() {
  ui.renderPerspectives();
  ui.renderFilters();
  ui.renderLegend();
  ui.renderFindings();
  ui.renderInspector();
  ui.renderCounters();
  ui.renderHud();
}

function startFpsMeter() {
  let last = performance.now(), acc = 0, n = 0;
  function tick(now) {
    const d = now - last; last = now;
    acc += d; n++;
    if (acc > 500) {
      state.perf.frameMs = acc / n;
      state.perf.fps = 1000 / (acc / n);
      acc = 0; n = 0;
      ui.renderHud();
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

/* ------------------------------------------------ test/automation hooks */
window.__sigmaG2V = (pt) => renderer.graphToViewport(pt);
Object.defineProperty(window, "__sig", { get: () => renderer });
window.__app = {
  state, api, actions,
  perspectives: PERSPECTIVES.map((p) => p.id),
  bench, benchmark,
  ready: () => !!renderer && state.graph.order > 0,
  counts: () => ({
    nodes: state.graph.order, edges: state.graph.size,
    drawn: state.graph.nodes().filter((n) => {
      const d = renderer.getNodeDisplayData(n); return d && !d.hidden;
    }).length,
    collapsed: [...state.collapsed],
    bootMs: performance.now() - bootT0,
  }),
  switchTimings: () => {
    const out = {};
    for (const p of PERSPECTIVES) {
      const t0 = performance.now();
      setPerspective(p.id);
      out[p.id] = +(performance.now() - t0).toFixed(2);
    }
    return out;
  },
};

boot().catch((e) => {
  console.error(e);
  ui.toast("boot failed: " + e.message, false);
});
