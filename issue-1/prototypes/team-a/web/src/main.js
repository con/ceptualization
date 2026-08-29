import './style.css';
import { api } from './api.js';
import {
  S,
  initCy,
  restyle,
  loadScenario,
  expand,
  expandAll,
  fullRelayout,
  revealAll,
  recomputeDerived,
  applyFindings,
  reapplyFilters,
  focusNodes,
  toggleCollapse,
  badgeBackend,
  filters
} from './graph.js';
import {
  ui,
  renderTabs,
  renderScenario,
  renderProgress,
  renderFindings,
  renderLegend,
  renderHud,
  renderInspector,
  pushLog,
  toast,
  wireFilters
} from './ui.js';
import { toEdgeEl } from './model.js';

const $ = (s) => document.querySelector(s);
let scenarios = [];
let busy = false;

function refreshAll() {
  renderProgress();
  renderFindings();
  renderHud();
  const sel = S.cy.nodes(':selected');
  if (sel.length === 1) renderInspector(sel);
}

S.hooks.onChange = refreshAll;
S.hooks.onLog = (rec) => pushLog(rec);
S.hooks.onToast = (msg, sticky) => toast(msg, sticky);

// ------------------------------------------------------------------ theme ---

function setTheme(t) {
  document.documentElement.dataset.theme = t;
  localStorage.setItem('teamA.theme', t);
  restyle();
  renderLegend();
  recomputeDerived();
}

// ------------------------------------------------------------- expansion ----

async function doExpand(nodeId, relation) {
  if (busy) return null;
  busy = true;
  try {
    return await expand(nodeId, relation, api);
  } catch (err) {
    toast('probe failed: ' + err.message);
    console.error(err);
    return null;
  } finally {
    busy = false;
  }
}

async function doExpandAll(nodeId) {
  if (busy) return [];
  busy = true;
  try {
    return await expandAll(nodeId, api);
  } finally {
    busy = false;
  }
}

ui.onExpand = doExpand;
ui.onAddRemote = (forkId) => {
  const cy = S.cy;
  const seedId = S.meta.seed_ids?.[0];
  const fork = cy.$id(forkId);
  if (!seedId || fork.length === 0) return;
  const owner = String(fork.data('fullLabel') || fork.id()).split('/')[0];
  const id = `local:remote:${seedId}->${forkId}`;
  if (cy.$id(id).length === 0) {
    cy.add(
      toEdgeEl({
        id,
        source: seedId,
        target: forkId,
        kind: 'remote',
        remote_name: owner,
        resolution: 'resolved',
        ahead: 0,
        behind: fork.data('ahead_of_upstream') || 0,
        local: true
      })
    );
  }
  fork.data('added_as_remote', true);
  fork.addClass('added-remote').removeClass('inactive preview');
  recomputeDerived();
  reapplyFilters();
  renderInspector(fork);
  pushLog({
    node: forkId,
    relation: `local: git remote add ${owner}`,
    latencyMs: 0,
    newNodes: 0,
    newEdges: 1,
    layoutMs: 0,
    pinned: S.pin,
    displacement: { n: 0, mean: 0, max: 0, p95: 0 },
    frames: { fps: 0 }
  });
};

// ---------------------------------------------------------------- scenario --

async function pick(id) {
  if (busy) return;
  busy = true;
  toast('loading ' + id, true);
  try {
    $('#log').innerHTML = '';
    $('#log-summary').textContent = '';
    await loadScenario(id, api);
    renderTabs(scenarios, id, pick);
    renderScenario(S.meta);
    $('#filter-inactive').checked = false;
    filters.hideInactive = false;
    refreshAll();
    renderInspector(null);
    toast(null);
  } catch (err) {
    toast('load failed: ' + err.message);
    console.error(err);
  } finally {
    busy = false;
  }
}

// -------------------------------------------------------------------- boot --

async function boot() {
  const cy = initCy($('#cy'));

  cy.on('tap', 'node', (evt) => {
    const n = evt.target;
    cy.nodes().unselect();
    n.select();
    renderInspector(n);
  });
  cy.on('dbltap', 'node', async (evt) => {
    const n = evt.target;
    const fr = S.frontier[n.id()];
    if (n.isParent() && (!fr || fr.hidden === 0)) {
      toggleCollapse(n);
      renderInspector(n);
      return;
    }
    await doExpandAll(n.id());
    renderInspector(n);
  });
  cy.on('tap', (evt) => {
    if (evt.target === cy) {
      cy.elements().removeClass('highlight dimmed');
      renderInspector(null);
    }
  });

  $('#btn-theme').onclick = () =>
    setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  $('#btn-fit').onclick = () => cy.animate({ fit: { eles: cy.elements().filter((e) => e.visible()), padding: 40 }, duration: 300 });
  $('#btn-reset').onclick = () => pick(S.scenario);
  $('#btn-relayout').onclick = async () => {
    if (busy) return;
    busy = true;
    toast('full unpinned re-layout', true);
    try {
      await fullRelayout();
    } finally {
      busy = false;
      toast(null);
      refreshAll();
    }
  };
  $('#pin-layout').onchange = (e) => {
    S.pin = e.target.checked;
  };
  wireFilters();
  renderLegend();

  setTheme(localStorage.getItem('teamA.theme') || 'dark');

  scenarios = await api.scenarios();
  const start = new URLSearchParams(location.search).get('scenario') || scenarios[0].id;
  await pick(start);

  // Playwright / benchmark hooks.
  window.__teamA = {
    ready: true,
    badgeBackend,
    S,
    cy,
    api,
    expand: doExpand,
    expandAll: doExpandAll,
    revealAll: async () => {
      busy = true;
      try {
        return await revealAll(api);
      } finally {
        busy = false;
        refreshAll();
      }
    },
    relayout: fullRelayout,
    restyle,
    pick,
    setTheme,
    setSeparate: (v) => {
      S.separate = v;
      $('#opt-separate').checked = v;
    },
    setPin: (v) => {
      S.pin = v;
      $('#pin-layout').checked = v;
    },
    setHideInactive: (v) => {
      $('#filter-inactive').checked = v;
      filters.hideInactive = v;
      reapplyFilters();
      recomputeDerived();
      renderHud();
    },
    select: (id) => {
      const n = cy.$id(id);
      if (n.length) {
        cy.nodes().unselect();
        n.select();
        renderInspector(n);
      }
      return n.length > 0;
    },
    focus: focusNodes,
    clearFocus: () => cy.elements().removeClass('highlight dimmed'),
    fit: () => {
      try {
        cy.stop(); // a queued panToNew animation must not race the explicit fit
        cy.fit(cy.elements().filter((e) => e.visible()), 40);
        return true;
      } catch (err) {
        console.error('fit failed', err);
        return false;
      }
    },
    metrics: () => JSON.parse(JSON.stringify(S.metrics)),
    frontier: () => JSON.parse(JSON.stringify(S.frontier)),
    idle: () => !busy,
    positions: () =>
      Object.fromEntries(cy.nodes().map((n) => [n.id(), { x: +n.position('x').toFixed(2), y: +n.position('y').toFixed(2) }]))
  };
  document.body.dataset.ready = '1';
}

boot().catch((err) => {
  console.error(err);
  document.body.insertAdjacentHTML(
    'afterbegin',
    `<pre style="position:fixed;inset:0;z-index:999;background:#300;color:#fff;padding:20px;white-space:pre-wrap">BOOT FAILED\n${err.stack || err}</pre>`
  );
});

void applyFindings;
