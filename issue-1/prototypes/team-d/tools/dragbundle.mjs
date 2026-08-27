// UX probe: drag x bundle x collapse x undo x hide x save/load.
//
// Every number in UX-DRAG-BUNDLE.md is produced here, by driving the real app
// with a real mouse. Nothing is simulated by poking S.layout directly: a drag
// is mouse.down / mouse.move / mouse.up over the canvas, so the cytoscape
// `grab` / `dragfree` path is the one under test.
//
//   node tools/dragbundle.mjs            (server must already be running)
//   WM_BASE=http://127.0.0.1:8899 node tools/dragbundle.mjs

import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = resolve(ROOT, 'screenshots');
mkdirSync(SHOTS, { recursive: true });
const B = process.env.WM_BASE || 'http://127.0.0.1:8899';
const ONLY = process.env.WM_ONLY || '';
const R = [];               // the result log
const say = (...a) => console.log(...a);

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});
const page = await browser.newPage({ viewport: { width: 1680, height: 1000 }, deviceScaleFactor: 1 });
let errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message));

await page.goto(B, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__wm && window.__wm.cy && window.__wm.cy.nodes().length > 0,
  { timeout: 30000 });

// ------------------------------------------------------------------ helpers

const idle = async (ms = 260) => page.waitForTimeout(ms);
const settle = async () => {
  await page.waitForFunction(() => !window.__wm.S.busy, { timeout: 30000 });
  // render() awaits the worker before touching cytoscape, so "not busy" is not
  // "painted". Wait until the canvas actually holds the shown set.
  await page.waitForFunction(() => window.__wm.S.view
    && window.__wm.cy.nodes().length === window.__wm.S.view.stats.drawnNodes,
  { timeout: 30000 });
  await idle(220);
};
const fit = async () => { await page.evaluate(() => window.__wm.fitAll()); await idle(200); };
const load = async (s) => {
  errs = [];
  await page.evaluate((x) => window.__wm.loadScenario(x), s);
  await page.waitForFunction((x) => window.__wm.S.scenario === x && !window.__wm.S.busy, s,
    { timeout: 30000 });
  await idle(320);
};
const revealAll = async () => {
  await page.evaluate(() => window.__wm.revealAll());
  await settle();
  await fit();
};
const expand = async (id, rel) => {
  await page.evaluate(([i, r]) => window.__wm.doExpand(i, r, { nodelay: true }), [id, rel]);
  await settle();
};
const shot = async (name) => {
  await idle(320);
  await page.screenshot({ path: `${SHOTS}/dragbundle-${name}.png` });
};

/** World position of every drawn node, straight out of cytoscape. */
const worlds = () => page.evaluate(() => {
  const o = {};
  window.__wm.cy.nodes().forEach((n) => { const p = n.position(); o[n.id()] = { x: p.x, y: p.y }; });
  return o;
});
const stats = () => page.evaluate(() => ({
  ...window.__wm.S.view.stats,
  drawnEdgeIds: window.__wm.cy.edges().map((e) => e.id()).sort(),
  cyNodes: window.__wm.cy.nodes().length,
  cyEdges: window.__wm.cy.edges().length,
  bundle: window.__wm.S.bundle,
  bundleBtnOn: !!document.getElementById('bundle').classList.contains('on'),
  collapsed: [...window.__wm.S.collapsed].sort(),
  hidden: [...window.__wm.S.hidden].sort(),
  moved: [...window.__wm.S.moved].sort(),
}));
/** Max / which node moved between two world snapshots, over a chosen id set. */
function drift(a, b, ids) {
  const keys = ids || Object.keys(a).filter((k) => b[k]);
  let max = 0, who = null, n = 0, movedN = 0;
  for (const k of keys) {
    if (!a[k] || !b[k]) continue;
    n += 1;
    const d = Math.hypot(b[k].x - a[k].x, b[k].y - a[k].y);
    if (d > 0.5) movedN += 1;
    if (d > max) { max = d; who = k; }
  }
  return { max: +max.toFixed(2), who, n, movedN };
}

/** Screen point for a node's centre. */
const screenOf = (id) => page.evaluate((i) => {
  const cy = window.__wm.cy;
  const n = cy.getElementById(i);
  if (!n || n.empty()) return null;
  const p = n.renderedPosition();
  const box = document.getElementById('cy').getBoundingClientRect();
  return { x: box.x + p.x, y: box.y + p.y, w: n.renderedWidth(), h: n.renderedHeight() };
}, id);

/** A REAL drag: grab the node at its rendered centre and drop it dx,dy away.
 *  `dx,dy` are SCREEN px; the world delta is dx/zoom. Fits first so the grab
 *  point is on the canvas. Returns the zoom used. */
async function drag(id, dx, dy, opt = {}) {
  const steps = opt.steps || 12;
  await fit();
  let s = await screenOf(id);
  if (!s) throw new Error('no such drawn node ' + id);
  const vp = page.viewportSize();
  const off = () => {
    // a container box grabbed at its centre grabs the CHILD drawn on top of
    // it, so containers are grabbed on their title strip, as a user must.
    const gy = opt.header ? s.y - s.h / 2 + 14 : s.y;
    return { x: s.x, y: gy };
  };
  // The two floating HUD strips are opaque to the mouse (top 10-85 px,
  // bottom 943-990 px, full canvas width), so a grab point inside them never
  // reaches cytoscape. Pan the map until the grab point is in the live band.
  const SAFE = { top: 100, bottom: 930, left: 360, right: vp.width - 20 };
  let g = off();
  for (let tries = 0; tries < 4; tries++) {
    const dxp = g.x < SAFE.left ? SAFE.left - g.x : (g.x > SAFE.right ? SAFE.right - g.x : 0);
    const dyp = g.y < SAFE.top ? SAFE.top - g.y : (g.y > SAFE.bottom ? SAFE.bottom - g.y : 0);
    if (!dxp && !dyp) break;
    await page.evaluate(([a, c]) => { window.__wm.cy.panBy({ x: a, y: c }); }, [dxp, dyp]);
    await idle(120);
    s = await screenOf(id);
    g = off();
  }
  const grabbed = await page.evaluate(([x, y]) => {
    // which element is actually under that point, per cytoscape
    const cy = window.__wm.cy;
    const box = document.getElementById('cy').getBoundingClientRect();
    const rp = { x: x - box.x, y: y - box.y };
    const w = { x: (rp.x - cy.pan().x) / cy.zoom(), y: (rp.y - cy.pan().y) / cy.zoom() };
    let hit = null;
    cy.nodes().forEach((n) => {
      const p = n.position();
      if (Math.abs(w.x - p.x) <= n.width() / 2 && Math.abs(w.y - p.y) <= n.height() / 2) {
        if (!hit || n.width() * n.height() < hit.a) hit = { id: n.id(), a: n.width() * n.height() };
      }
    });
    return hit && hit.id;
  }, [g.x, g.y]);
  await page.evaluate(() => {
    if (!window.__grabLog) {
      window.__grabLog = [];
      window.__wm.cy.on('grab', 'node', (e) => window.__grabLog.push('grab:' + e.target.id()));
      window.__wm.cy.on('dragfree', 'node', (e) => window.__grabLog.push('free:' + e.target.id()));
    }
    window.__grabLog.length = 0;
  });
  await page.mouse.move(g.x, g.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(g.x + (dx * i) / steps, g.y + (dy * i) / steps);
  }
  await page.mouse.up();
  await settle();
  const log = await page.evaluate(() => window.__grabLog.slice());
  if (!log.length && !opt.allowMiss) throw new Error(`drag of ${id} grabbed nothing (point ${g.x},${g.y})`);
  return { grabbed, events: log, zoom: await zoomNow() };
}

const zoomNow = () => page.evaluate(() => +window.__wm.cy.zoom().toFixed(4));
const clickBtn = async (id) => { await page.click('#' + id); await settle(); };
const undo = async () => {
  if (await page.evaluate(() => document.getElementById('undo').disabled)) return false;
  await page.click('#undo'); await settle(); return true;
};
const redo = async () => {
  if (await page.evaluate(() => document.getElementById('redo').disabled)) return false;
  await page.click('#redo'); await settle(); return true;
};
const bundleOn = async () => { await page.click('#bundle'); await settle(); };
/** Put the bundle toggle in a known state (it is NOT reset by a scenario change). */
const setBundle = async (on) => {
  const cur = await page.evaluate(() => !!window.__wm.S.bundle);
  if (cur !== on) await bundleOn();
};
const collapse = async (id) => {
  await page.evaluate((i) => window.__wm.toggleCollapse(i), id);
  await settle();
};
const hide = async (id, all) => page.evaluate(([i, a]) => {
  window.__wm.select(i);
  const b = document.querySelector(a ? `button[data-hideall="${i}"]` : `button[data-hide="${i}"]`);
  if (!b) throw new Error('no hide button for ' + i);
  b.click();
}, [id, !!all]).then(settle);
const showAll = async () => {
  await page.evaluate(() => {
    const b = document.querySelector('#hidden .histrow[data-all]');
    if (b) b.click();
  });
  await settle();
};

const rec = (test, o) => {
  const e = { test, ...o, errs: errs.slice() };
  R.push(e);
  say(`\n### ${test}\n` + JSON.stringify(o, null, 1).slice(0, 1800));
  if (errs.length) say('  !! console errors: ' + JSON.stringify(errs));
  errs = [];
  return e;
};

const want = (id) => ONLY === '' || ONLY.split(',').includes(id);

// =====================================================================
// T1  drag x bundle  (s1-spacetop)
// =====================================================================
if (want('t1')) {
  await load('s1-spacetop');
  await revealAll();
  await setBundle(false);
  const tops = await page.evaluate(() => [...window.__wm.S.visible]
    .filter((i) => !(window.__wm.S.byId[i] || {}).parent).sort());
  const leaves = await page.evaluate(() => [...window.__wm.S.visible]
    .filter((i) => (window.__wm.S.byId[i] || {}).parent).sort());
  const before = await worlds();
  const s0 = await stats();

  // drag one container and one leaf
  const dg1 = await drag(tops[0], 190, -120, { header: true });
  const afterC = await worlds();
  const contDelta = Math.hypot(afterC[tops[0]].x - before[tops[0]].x,
    afterC[tops[0]].y - before[tops[0]].y);
  // everything not under tops[0] must be 0 px
  const kidsOfTop0 = await page.evaluate((t) => [...window.__wm.S.visible]
    .filter((i) => (window.__wm.S.byId[i] || {}).parent === t), tops[0]);
  const outside = Object.keys(before).filter((k) => k !== tops[0] && !kidsOfTop0.includes(k));
  const outDrift = drift(before, afterC, outside);
  const kidDrift = drift(before, afterC, kidsOfTop0);

  const leafIn0 = kidsOfTop0[0];
  await drag(leafIn0, 60, 55);
  const afterL = await worlds();
  const leafOthers = Object.keys(afterC).filter((k) => k !== leafIn0);
  const leafOtherDrift = drift(afterC, afterL, leafOthers);
  await shot('t1-01-dragged-s1');

  // now bundle
  const preBundle = await worlds();
  await bundleOn();
  const s1 = await stats();
  const postBundle = await worlds();
  const bundlePosDrift = drift(preBundle, postBundle, Object.keys(preBundle));
  await shot('t1-02-bundled-s1');

  // and unbundle
  await bundleOn();
  const s2 = await stats();
  const postUn = await worlds();
  const unbundlePosDrift = drift(preBundle, postUn, Object.keys(preBundle));
  const sameEdges = JSON.stringify(s0.drawnEdgeIds) === JSON.stringify(s2.drawnEdgeIds);
  await shot('t1-03-unbundled-s1');

  rec('T1 drag x bundle (s1)', {
    containerDragged: tops[0], grabbedInstead: dg1.grabbed, zoom: dg1.zoom,
    containerMovedPx: +contDelta.toFixed(2),
    childrenFollowed: kidDrift, outsideDrift: outDrift,
    leafDragged: leafIn0, leafDragOthersDrift: leafOtherDrift,
    edgesOpen: s0.drawnEdges, edgesBundled: s1.drawnEdges, edgesUnbundled: s2.drawnEdges,
    rawEdges: s0.rawEdges, foldedBundled: s1.internalEdgesFolded,
    bundlePositionDrift: bundlePosDrift, unbundlePositionDrift: unbundlePosDrift,
    unbundleRestoresExactEdgeSet: sameEdges,
    edgeCountAccounting: {
      bundled: `${s1.drawnEdges} drawn + ${s1.internalEdgesFolded} folded = ${s1.drawnEdges + s1.internalEdgesFolded} vs ${s1.rawEdges} raw`,
      bundledSumsToRaw: null,   // drawn edges carry counts; see memberTotal below
    },
    memberTotalBundled: await page.evaluate(() =>
      window.__wm.S.view.edges.reduce((a, e) => a + e.count, 0)),
    memberTotalOpen: null,
  });
}

// =====================================================================
// T2  drag x collapse  (s2-babs-ria)
// =====================================================================
if (want('t2')) {
  await load('s2-babs-ria');
  await revealAll();
  const tops = await page.evaluate(() => [...window.__wm.S.visible]
    .filter((i) => !(window.__wm.S.byId[i] || {}).parent).sort());
  // a container with children
  const conts = await page.evaluate(() => [...window.__wm.S.visible]
    .filter((i) => [...window.__wm.S.visible].some((k) => (window.__wm.S.byId[k] || {}).parent === i))
    .sort());
  const top0 = tops[0];
  const b0 = await worlds();
  const dg2 = await drag(top0, 150, 90, { header: true });
  const b1 = await worlds();
  const movedTo = b1[top0];
  await collapse(top0);
  const b2 = await worlds();
  await collapse(top0);
  const b3 = await worlds();
  const roundTrip = Math.hypot(b3[top0].x - b1[top0].x, b3[top0].y - b1[top0].y);
  const allRoundTrip = drift(b1, b3, Object.keys(b1));
  await shot('t2-01-container-drag-collapse-expand');

  // leaf drag, collapse parent, expand
  const kidsOf = async (c) => page.evaluate((x) => [...window.__wm.S.visible]
    .filter((i) => (window.__wm.S.byId[i] || {}).parent === x).sort(), c);
  const parentWithKids = conts.find((c) => c !== top0) || conts[0];
  const kids = await kidsOf(parentWithKids);
  const leaf = kids[0];
  const c0 = await worlds();
  await drag(leaf, 40, 130);
  const c1 = await worlds();
  const leafPlaced = c1[leaf];
  await collapse(parentWithKids);
  await collapse(parentWithKids);
  const c2 = await worlds();
  const leafReturn = c2[leaf]
    ? Math.hypot(c2[leaf].x - leafPlaced.x, c2[leaf].y - leafPlaced.y) : null;
  await shot('t2-02-leaf-drag-collapse-expand');

  rec('T2 drag x collapse (s2)', {
    container: top0, grabbed: dg2.grabbed, containerMovedTo: movedTo,
    containerCollapseExpandRoundTripPx: +roundTrip.toFixed(2),
    allNodesRoundTrip: allRoundTrip,
    leafParent: parentWithKids, leaf,
    leafPlacedAt: leafPlaced, leafAfterCollapseExpand: c2[leaf],
    leafReturnErrorPx: leafReturn === null ? null : +leafReturn.toFixed(2),
  });
}

// =====================================================================
// T3  bundle x collapse  (s3-forks)
// =====================================================================
if (want('t3')) {
  await load('s3-forks');
  await revealAll();
  await setBundle(false);
  const s_open = await stats();
  const memOpen = await page.evaluate(() =>
    window.__wm.S.view.edges.reduce((a, e) => a + e.count, 0));
  await bundleOn();
  const s_b = await stats();
  const memB = await page.evaluate(() =>
    window.__wm.S.view.edges.reduce((a, e) => a + e.count, 0));
  await shot('t3-01-bundled-open-s3');
  await clickBtn('collapse-all');
  const s_bc = await stats();
  const memBC = await page.evaluate(() =>
    window.__wm.S.view.edges.reduce((a, e) => a + e.count, 0));
  await shot('t3-02-bundled-collapsed-s3');
  await bundleOn();               // off, still collapsed
  const s_c = await stats();
  const memC = await page.evaluate(() =>
    window.__wm.S.view.edges.reduce((a, e) => a + e.count, 0));
  await shot('t3-03-collapsed-only-s3');
  await clickBtn('expand-all');
  const s_back = await stats();

  const labels = await page.evaluate(() => window.__wm.cy.edges()
    .map((e) => ({ id: e.id(), label: e.data('label') || '', count: e.data('count') }))
    .slice(0, 12));

  rec('T3 bundle x collapse (s3)', {
    open: { drawn: s_open.drawnEdges, raw: s_open.rawEdges, folded: s_open.internalEdgesFolded, members: memOpen },
    bundled: { drawn: s_b.drawnEdges, raw: s_b.rawEdges, folded: s_b.internalEdgesFolded, members: memB },
    bundledAndCollapsed: { drawn: s_bc.drawnEdges, folded: s_bc.internalEdgesFolded, members: memBC },
    collapsedOnly: { drawn: s_c.drawnEdges, folded: s_c.internalEdgesFolded, members: memC },
    backToOpen: { drawn: s_back.drawnEdges, raw: s_back.rawEdges },
    conservation: {
      openMembersPlusFolded: memOpen + s_open.internalEdgesFolded,
      bundledMembersPlusFolded: memB + s_b.internalEdgesFolded,
      bundledCollapsedMembersPlusFolded: memBC + s_bc.internalEdgesFolded,
      raw: s_open.rawEdges,
    },
    sampleLabels: labels,
    bundleStillOnAfterExpandAll: s_back.bundle,
  });
}

// =====================================================================
// T4  drag x expand  (s1)
// =====================================================================
if (want('t4')) {
  await load('s1-spacetop');
  await expand('d:lena', 'remote:out');
  const tops = await page.evaluate(() => [...window.__wm.S.visible]
    .filter((i) => !(window.__wm.S.byId[i] || {}).parent).sort());
  const dg4 = await drag(tops[0], 220, 140, { header: true });
  const a0 = await worlds();
  const draggedAt = a0[tops[0]];
  // expand something in another container
  const cand = await page.evaluate(() => {
    const S = window.__wm.S;
    for (const id of [...S.visible].sort()) {
      const n = S.byId[id];
      if (!n || !n.rel_counts) continue;
      const done = new Set(S.expansions.filter((e) => e.node === id).map((e) => e.relation));
      for (const k of Object.keys(n.rel_counts)) if (!done.has(k)) return { id, rel: k };
    }
    return null;
  });
  let afterExp = null, expDrift = null, draggedDrift = null;
  if (cand) {
    await expand(cand.id, cand.rel);
    afterExp = await worlds();
    draggedDrift = +Math.hypot(afterExp[tops[0]].x - draggedAt.x,
      afterExp[tops[0]].y - draggedAt.y).toFixed(2);
    expDrift = drift(a0, afterExp, Object.keys(a0));
  }
  await shot('t4-01-drag-then-expand');
  rec('T4 drag x expand (s1)', {
    dragged: tops[0], grabbed: dg4.grabbed, expandedNode: cand,
    draggedContainerDriftPx: draggedDrift,
    everythingDrift: expDrift,
    metrics: await page.evaluate(() => {
      const m = window.__wm.layoutMetrics();
      return m ? { containers: m.containers, leaves: m.leaves, tier1Ran: m.tier1Ran } : null;
    }),
  });
}

// =====================================================================
// T5  drag x undo / redo  (s1)
// =====================================================================
if (want('t5')) {
  await load('s1-spacetop');
  await revealAll();
  const tops = await page.evaluate(() => [...window.__wm.S.visible]
    .filter((i) => !(window.__wm.S.byId[i] || {}).parent).sort());
  const p0 = await worlds();
  const dg5 = await drag(tops[0], 170, -90, { header: true });
  const p1 = await worlds();
  await undo();
  const p2 = await worlds();
  const undoDrift = drift(p0, p2, Object.keys(p0));
  await redo();
  const p3 = await worlds();
  const redoDrift = drift(p1, p3, Object.keys(p1));

  // interleave: drag, collapse, drag, undo x3
  await drag(tops[0], -60, 40, { header: true });
  const q1 = await worlds();
  await collapse(tops[0]);
  await drag(tops.length > 1 ? tops[1] : tops[0], 80, 80, { header: true });
  await undo(); await undo(); await undo();
  const q2 = await worlds();
  const interleaveDrift = drift(p3, q2, Object.keys(p3));

  // bundle toggle then undo: does the button follow?
  await bundleOn();
  const bOn = await stats();
  await undo();
  const bUndo = await stats();
  await shot('t5-01-undo-redo');

  rec('T5 drag x undo/redo (s1)', {
    dragged: tops[0], grabbed: dg5.grabbed,
    undoRestoresPx: undoDrift, redoRestoresPx: redoDrift,
    interleaveBackToPx: interleaveDrift,
    bundleToggleThenUndo: {
      afterToggle: { S: bOn.bundle, btn: bOn.bundleBtnOn, edges: bOn.drawnEdges },
      afterUndo: { S: bUndo.bundle, btn: bUndo.bundleBtnOn, edges: bUndo.drawnEdges },
      buttonMatchesState: bUndo.bundle === bUndo.bundleBtnOn,
    },
    historyLabels: await page.evaluate(() =>
      [...document.querySelectorAll('#history .histrow span')].map((s) => s.textContent)),
  });
}

// =====================================================================
// T6  drag x hide  (s2)
// =====================================================================
if (want('t6')) {
  await load('s2-babs-ria');
  await revealAll();
  const conts = await page.evaluate(() => [...window.__wm.S.visible]
    .filter((i) => [...window.__wm.S.visible].some((k) => (window.__wm.S.byId[k] || {}).parent === i))
    .sort());
  const kids = await page.evaluate((c) => [...window.__wm.S.visible]
    .filter((i) => (window.__wm.S.byId[i] || {}).parent === c).sort(), conts[0]);
  const leaf = kids[0];
  const h0 = await worlds();
  await drag(leaf, 70, 90);
  const h1 = await worlds();
  const placed = h1[leaf];
  await hide(leaf, false);
  const h2 = await worlds();
  const othersAfterHide = drift(h1, h2, Object.keys(h2).filter((k) => k !== leaf));
  await showAll();
  const h3 = await worlds();
  const back = h3[leaf] ? +Math.hypot(h3[leaf].x - placed.x, h3[leaf].y - placed.y).toFixed(2) : null;
  await shot('t6-01-drag-hide-show');

  // hide a CONTAINER but not its children
  const cont = conts.find((c) => c !== conts[0]) || conts[0];
  const k0 = await worlds();
  let containerHideNote = null;
  try {
    await hide(cont, false);
    const k1 = await worlds();
    containerHideNote = {
      container: cont,
      driftOfEverythingElse: drift(k0, k1, Object.keys(k1).filter((x) => x !== cont)),
      childrenStillDrawn: await page.evaluate((c) => window.__wm.cy.nodes()
        .filter((n) => (window.__wm.S.byId[n.id()] || {}).parent === c).length, cont),
      tier1RunsAfter: await page.evaluate(() => window.__wm.S.layout.tier1Runs),
    };
    await shot('t6-02-container-hidden-children-orphaned');
    await showAll();
    const k2 = await worlds();
    containerHideNote.afterShowAllDrift = drift(k0, k2, Object.keys(k0));
  } catch (e) { containerHideNote = { error: String(e) }; }

  rec('T6 drag x hide (s2)', {
    leaf, placedAt: placed, afterShowAt: h3[leaf],
    positionPreservedPx: back,
    othersMovedWhenLeafHidden: othersAfterHide,
    hideContainerOnly: containerHideNote,
  });
}

// =====================================================================
// T7  drag x save / load  (s2)
// =====================================================================
if (want('t7')) {
  await load('s2-babs-ria');
  await revealAll();
  const tops = await page.evaluate(() => [...window.__wm.S.visible]
    .filter((i) => !(window.__wm.S.byId[i] || {}).parent).sort());
  const conts = await page.evaluate(() => [...window.__wm.S.visible]
    .filter((i) => [...window.__wm.S.visible].some((k) => (window.__wm.S.byId[k] || {}).parent === i))
    .sort());
  const nested = conts.filter((c) => !tops.includes(c));
  const kids = await page.evaluate((c) => [...window.__wm.S.visible]
    .filter((i) => (window.__wm.S.byId[i] || {}).parent === c).sort(), conts[0]);
  const dg7 = await drag(tops[0], 120, -80, { header: true });
  await drag(kids[0], 55, 60);
  const before = await worlds();
  const v1 = await page.evaluate(() => window.__wm.saveView('dragtest'));
  const payload1 = await page.evaluate(() => JSON.stringify(window.__wm.viewPayload()));
  await load('s2-babs-ria');
  await page.evaluate(() => window.__wm.loadView('dragtest'));
  await settle();
  const after = await worlds();
  const reloadDrift = drift(before, after, Object.keys(before).filter((k) => after[k]));
  const missing = Object.keys(before).filter((k) => !after[k]);
  await shot('t7-01-after-reload');
  // one more drag, save again, diff the two CANONICAL FILES on disk (the API
  // returns compact json, which would make every diff one line)
  await drag(tops[0], 40, 0, { header: true });
  await page.evaluate(() => window.__wm.saveView('dragtest2'));
  const readView = (n) => readFileSync(resolve(ROOT, `views/s2-babs-ria.${n}.view.json`), 'utf8');
  const a = readView('dragtest').split('\n'), bl = readView('dragtest2').split('\n');
  let diffLines = 0;
  for (let i = 0; i < Math.max(a.length, bl.length); i++) if (a[i] !== bl[i]) diffLines += 1;
  // and the control: a save / drag / save with NO reload in between
  await page.evaluate(() => window.__wm.saveView('noreloada'));
  await drag(tops[0], 35, 25, { header: true });
  await page.evaluate(() => window.__wm.saveView('noreloadb'));
  const c1 = readView('noreloada').split('\n'), c2 = readView('noreloadb').split('\n');
  let diffLinesNoReload = 0;
  for (let i = 0; i < Math.max(c1.length, c2.length); i++) if (c1[i] !== c2[i]) diffLinesNoReload += 1;
  rec('T7 drag x save/load (s2)', {
    saved: v1, grabbed: dg7.grabbed,
    nestedContainers: nested,
    nestedSizesInPayload: JSON.parse(payload1).sizes,
    reloadDriftPx: reloadDrift,
    missingAfterReload: missing.length,
    nestedBoxSizeAfterReload: await page.evaluate((n) => n.map((i) => {
      const el = window.__wm.cy.getElementById(i);
      return el.empty() ? null : { id: i, w: el.width(), h: el.height() };
    }), nested),
    nestedBoxSizeInLayout: await page.evaluate((n) => n.map((i) =>
      ({ id: i, size: window.__wm.S.layout.size.get(i) || null })), nested),
    viewFileLines: a.length,
    diffLinesForOneMoveAfterReload: diffLines,
    viewFileLinesNoReload: c1.length,
    diffLinesForOneMoveNoReload: diffLinesNoReload,
  });
}

// =====================================================================
// T8  edge cases
// =====================================================================
if (want('t8')) {
  await load('s2-babs-ria');
  await revealAll();
  const tops = await page.evaluate(() => [...window.__wm.S.visible]
    .filter((i) => !(window.__wm.S.byId[i] || {}).parent).sort());
  const conts = await page.evaluate(() => [...window.__wm.S.visible]
    .filter((i) => [...window.__wm.S.visible].some((k) => (window.__wm.S.byId[k] || {}).parent === i))
    .sort());
  const kids = await page.evaluate((c) => [...window.__wm.S.visible]
    .filter((i) => (window.__wm.S.byId[i] || {}).parent === c).sort(), conts[0]);

  // (a) drag a leaf far outside its container box
  const leaf = kids[0];
  const box = await page.evaluate((c) => {
    const n = window.__wm.cy.getElementById(c);
    return { x: n.position().x, y: n.position().y, w: n.width(), h: n.height() };
  }, conts[0]);
  await drag(leaf, 900, 500);
  const esc = await page.evaluate(([l, c]) => {
    const cy = window.__wm.cy;
    const n = cy.getElementById(l), p = cy.getElementById(c);
    const np = n.position(), pp = p.position();
    const inside = Math.abs(np.x - pp.x) <= p.width() / 2 && Math.abs(np.y - pp.y) <= p.height() / 2;
    return {
      leafPos: np, boxCentre: pp, boxW: p.width(), boxH: p.height(), inside,
      overflowX: +(Math.abs(np.x - pp.x) - p.width() / 2).toFixed(1),
      overflowY: +(Math.abs(np.y - pp.y) - p.height() / 2).toFixed(1),
      local: window.__wm.S.layout.local.get(l),
    };
  }, [leaf, conts[0]]);
  await shot('t8-01-leaf-clamped-not-escaped');

  // (b) drag a container onto another container
  let overlapNote = null;
  if (tops.length > 1) {
    const a = await screenOf(tops[0]), b2 = await screenOf(tops[1]);
    await drag(tops[0], b2.x - a.x, b2.y - a.y, { header: true });
    overlapNote = await page.evaluate(([p, q]) => {
      const cy = window.__wm.cy;
      const A = cy.getElementById(p), Bn = cy.getElementById(q);
      const ap = A.position(), bp = Bn.position();
      const ax1 = ap.x - A.width() / 2, ax2 = ap.x + A.width() / 2;
      const ay1 = ap.y - A.height() / 2, ay2 = ap.y + A.height() / 2;
      const bx1 = bp.x - Bn.width() / 2, bx2 = bp.x + Bn.width() / 2;
      const by1 = bp.y - Bn.height() / 2, by2 = bp.y + Bn.height() / 2;
      const ovX = Math.min(ax2, bx2) - Math.max(ax1, bx1);
      const ovY = Math.min(ay2, by2) - Math.max(ay1, by1);
      return { a: p, b: q, overlapW: +ovX.toFixed(1), overlapH: +ovY.toFixed(1),
        overlapping: ovX > 0 && ovY > 0 };
    }, [tops[0], tops[1]]);
    await shot('t8-02-containers-overlapping');
  }

  // (c) drag a collapsed container
  await load('s2-babs-ria');
  await revealAll();
  const t2 = await page.evaluate(() => [...window.__wm.S.visible]
    .filter((i) => !(window.__wm.S.byId[i] || {}).parent).sort());
  await collapse(t2[0]);
  const g0 = await worlds();
  const dg8 = await drag(t2[0], 130, 110, { header: true });
  const g1 = await worlds();
  const collapsedDrag = +Math.hypot(g1[t2[0]].x - g0[t2[0]].x, g1[t2[0]].y - g0[t2[0]].y).toFixed(2);
  await collapse(t2[0]);
  const g2 = await worlds();
  const afterExpandDrift = +Math.hypot(g2[t2[0]].x - g1[t2[0]].x, g2[t2[0]].y - g1[t2[0]].y).toFixed(2);
  await shot('t8-03-collapsed-container-dragged');

  // (d) drag while a probe is in flight
  await load('s1-spacetop');
  const t3 = await page.evaluate(() => [...window.__wm.S.visible]
    .filter((i) => !(window.__wm.S.byId[i] || {}).parent).sort());
  const histBefore = await page.evaluate(() => window.__wm.S.history.past.length);
  // fire a SLOW probe (no nodelay) and drag while it runs
  await page.evaluate(() => { window.__wm.doExpand('d:lena', 'remote:out'); });
  await page.waitForFunction(() => window.__wm.S.busy, { timeout: 5000 });
  const busyAtGrab = await page.evaluate(() => window.__wm.S.busy);
  const dg8d = await drag(t3[0], 80, 60, { header: true });
  await settle();
  const histAfter = await page.evaluate(() => window.__wm.S.history.past.length);
  const histLabels = await page.evaluate(() =>
    window.__wm.S.history.past.map((e) => e.label));
  await shot('t8-04-drag-during-probe');

  // (e) rapid successive drags
  await load('s1-spacetop');
  await revealAll();
  const t4 = await page.evaluate(() => [...window.__wm.S.visible]
    .filter((i) => !(window.__wm.S.byId[i] || {}).parent).sort());
  const r0 = await worlds();
  for (let i = 0; i < 5; i++) await drag(t4[0], 30, 20, { header: true, steps: 4 });
  const r1 = await worlds();
  const netMove = +Math.hypot(r1[t4[0]].x - r0[t4[0]].x, r1[t4[0]].y - r0[t4[0]].y).toFixed(2);
  const histRapid = await page.evaluate(() => window.__wm.S.history.past.length);

  // (f) drag the seed
  const seed = await page.evaluate(() => [...window.__wm.S.visible]
    .find((i) => (window.__wm.S.byId[i] || {}).is_seed));
  let seedNote = null;
  if (seed) {
    const s0 = await worlds();
    await drag(seed, 90, -70);
    const s1 = await worlds();
    seedNote = { seed, movedPx: +Math.hypot(s1[seed].x - s0[seed].x, s1[seed].y - s0[seed].y).toFixed(2) };
  }

  rec('T8 edge cases', {
    leafDraggedFarOutside: esc,
    containerOntoContainer: overlapNote,
    collapsedContainerDragPx: collapsedDrag, collapsedGrabbed: dg8.grabbed,
    probeGrabbed: dg8d.grabbed,
    collapsedThenExpandedShiftPx: afterExpandDrift,
    dragDuringProbe: { busyAtGrab, histBefore, histAfter, histLabels },
    rapidDrags: { count: 5, expectedPx: null, netMovePx: netMove, historyEntries: histRapid },
    seedDrag: seedNote,
  });
}

// =====================================================================
// T9  bundle x grey-inactive x badges  (s3)
// =====================================================================
if (want('t9')) {
  await load('s3-forks');
  await revealAll();
  await bundleOn();
  const g = await page.evaluate(() => {
    const cy = window.__wm.cy;
    return {
      inactiveEdges: cy.edges('.inactive').length,
      totalEdges: cy.edges().length,
      inactiveOpacity: cy.edges('.inactive').length
        ? cy.edges('.inactive')[0].style('opacity') : null,
      aggregatedInactive: cy.edges('.inactive').filter((e) => (e.data('count') || 1) > 1).length,
      labels: cy.edges().map((e) => ({ id: e.id(), lbl: e.data('label'), n: e.data('count') }))
        .filter((x) => (x.n || 1) > 1).slice(0, 10),
    };
  });
  await page.uncheck('#grey'); await idle(200);
  const g2 = await page.evaluate(() => ({
    inactiveOpacity: window.__wm.cy.edges('.inactive').length
      ? window.__wm.cy.edges('.inactive')[0].style('opacity') : null,
  }));
  await page.check('#grey'); await idle(200);
  await shot('t9-01-bundled-grey-s3');
  // badge toggle while bundled
  await page.click('[data-bg="health"]'); await settle();
  const afterBadge = await stats();
  await page.click('[data-bg="health"]'); await settle();
  rec('T9 bundle x grey/badges (s3)', {
    greyOn: g, greyOffOpacity: g2.inactiveOpacity,
    edgesAfterBadgeToggle: afterBadge.drawnEdges,
    bundleSurvivesBadgeToggle: afterBadge.bundle,
  });
}


// =====================================================================
// T10 an empty probe abandons the WRONG history entry
// =====================================================================
if (want('t10')) {
  await load('s1-spacetop');
  await revealAll();               // everything is on the map already
  const tops = await page.evaluate(() => [...window.__wm.S.visible]
    .filter((i) => !(window.__wm.S.byId[i] || {}).parent).sort());
  const p0 = await worlds();
  await drag(tops[0], 150, 90, { header: true });
  const p1 = await worlds();
  const h1 = await page.evaluate(() => window.__wm.S.history.past.map((e) => e.label));
  // a probe that can return nothing new: everything is already revealed
  await expand('d:lena', 'remote:out');
  const h2 = await page.evaluate(() => window.__wm.S.history.past.map((e) => e.label));
  const canUndo = await page.evaluate(() => window.__wm.S.history.canUndo());
  await undo();
  const p2 = await worlds();
  rec('T10 empty probe abandons the wrong entry', {
    historyAfterDrag: h1, historyAfterEmptyProbe: h2,
    dragEntryStillThere: h2.some((l) => l.startsWith('move ')),
    canUndo,
    undoAfterEmptyProbeGoesBackTo: {
      vsBeforeDrag: drift(p0, p2, Object.keys(p0)),
      vsAfterDrag: drift(p1, p2, Object.keys(p1)),
    },
  });
}

// =====================================================================
// T11 bundling numbers + label sanity on all three fixtures
// =====================================================================
if (want('t11')) {
  const out = {};
  for (const sc of ['s1-spacetop', 's2-babs-ria', 's3-forks']) {
    await load(sc);
    await revealAll();
    await setBundle(false);
    const open = await stats();
    await bundleOn();
    const bun = await stats();
    const members = await page.evaluate(() =>
      window.__wm.S.view.edges.reduce((a, e) => a + e.count, 0));
    const lab = await page.evaluate(() => window.__wm.cy.edges()
      .map((e) => ({ id: e.id(), n: e.data('count') || 1, len: (e.data('label') || '').length,
        label: e.data('label') || '' }))
      .filter((x) => x.n > 1).sort((a, b) => b.len - a.len));
    const crossPairs = await page.evaluate(() => {
      const S = window.__wm.S;
      const topOf = (id) => { let c = id, g = 0;
        for (;;) { const n = S.byId[c]; const par = n && n.parent && S.visible.has(n.parent) ? n.parent : null;
          if (!par || g++ > 24) return c; c = par; } };
      let cross = 0;
      for (const e of S.edges) {
        if (e.kind === 'contains') continue;
        if (!S.visible.has(e.source) || !S.visible.has(e.target)) continue;
        if (topOf(e.source) !== topOf(e.target)) cross += 1;
      }
      return cross;
    });
    await setBundle(false);
    out[sc] = {
      openDrawn: open.drawnEdges, bundledDrawn: bun.drawnEdges,
      raw: open.rawEdges, crossContainerRawEdges: crossPairs,
      reductionPct: +(100 * (1 - bun.drawnEdges / open.drawnEdges)).toFixed(1),
      crossEdgesDrawnWhenBundled: bun.drawnEdges - (open.drawnEdges - crossPairs),
      conservation: `${members} members + ${bun.internalEdgesFolded} folded = ${members + bun.internalEdgesFolded} vs ${open.rawEdges} raw`,
      aggregatedEdges: lab.length,
      longestLabel: lab[0] || null,
    };
  }
  rec('T11 bundling on all three fixtures', out);
}

// =====================================================================
// T12 bundle x hide-a-container, and inactive class on a bundle
// =====================================================================
if (want('t12')) {
  await load('s3-forks');
  await revealAll();
  await setBundle(true);
  const b0 = await stats();
  const inactiveMembers = await page.evaluate(() => {
    const S = window.__wm.S;
    return S.view.edges.filter((e) => e.count > 1).map((e) => ({
      id: e.id, count: e.count,
      membersInactive: e.members.filter((m) => {
        const raw = S.edges.find((x) => x.id === m);
        return raw && S.byId[raw.source] && S.byId[raw.source].inactive;
      }).length,
      drawnInactive: window.__wm.cy.getElementById(e.id).hasClass('inactive'),
    }));
  });
  await shot('t12-01-bundle-inactive-s3');
  rec('T12 bundle x inactive', {
    bundledDrawn: b0.drawnEdges,
    aggregatedEdgeInactivity: inactiveMembers,
  });
}


// =====================================================================
// T13 drag WHILE a no-op probe is in flight -> abandon() pops the drag
// =====================================================================
if (want('t13')) {
  await load('s1-spacetop');
  await revealAll();                    // so any probe can return nothing new
  const tops = await page.evaluate(() => [...window.__wm.S.visible]
    .filter((i) => !(window.__wm.S.byId[i] || {}).parent).sort());
  const p0 = await worlds();
  // Pre-compute the grab point, THEN fire a slow probe (no `nodelay`, so
  // 300-900 ms) and drag inside that window with no awaits in between, so the
  // mouse-up provably lands while S.busy is true.
  await fit();
  const gp = await page.evaluate((i) => {
    const cy = window.__wm.cy, n = cy.getElementById(i);
    const r = n.renderedPosition(), bx = document.getElementById('cy').getBoundingClientRect();
    return { x: bx.x + r.x, y: bx.y + r.y - n.renderedHeight() / 2 + 14 };
  }, tops[0]);
  if (gp.y < 100) { await page.evaluate(() => window.__wm.cy.panBy({ x: 0, y: 140 })); await idle(150); }
  const gp2 = await page.evaluate((i) => {
    const cy = window.__wm.cy, n = cy.getElementById(i);
    const r = n.renderedPosition(), bx = document.getElementById('cy').getBoundingClientRect();
    return { x: bx.x + r.x, y: bx.y + r.y - n.renderedHeight() / 2 + 14 };
  }, tops[0]);
  await page.evaluate(() => { window.__wm.doExpand('d:lena', 'remote:out'); });
  await page.mouse.move(gp2.x, gp2.y);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(gp2.x + (160 * i) / 6, gp2.y + (90 * i) / 6);
  const busyAtDrop = await page.evaluate(() => window.__wm.S.busy);
  await page.mouse.up();
  await settle();
  const p1 = await worlds();
  const h = await page.evaluate(() => window.__wm.S.history.past.map((e) => e.label));
  const moved = drift(p0, p1, Object.keys(p0));
  const undoRan = await undo();
  const p2 = await worlds();
  rec('T13 drag during a no-op probe', {
    busyAtDrop, undoWasAvailable: undoRan,
    dragActuallyMoved: moved,
    historyAfter: h,
    dragIsUndoable: h.some((l) => l.startsWith('move ')),
    undoWentBackTo: { vsBeforeAll: drift(p0, p2, Object.keys(p0)), vsAfterDrag: drift(p1, p2, Object.keys(p1)) },
  });
}

// =====================================================================
// T14 drag a LEAF, then expand something into the same container
// =====================================================================
if (want('t14')) {
  await load('s2-babs-ria');
  const seed = await page.evaluate(() => [...window.__wm.S.visible]
    .find((i) => (window.__wm.S.byId[i] || {}).is_seed));
  for (const rel of ['remote:out', 'subdataset:out', 'contains:out']) {
    const has = await page.evaluate(([i, r]) =>
      !!((window.__wm.S.byId[i] || {}).rel_counts || {})[r], [seed, rel]);
    if (has) await expand(seed, rel);
  }
  const conts = await page.evaluate(() => [...window.__wm.S.visible]
    .filter((i) => [...window.__wm.S.visible].some((k) => (window.__wm.S.byId[k] || {}).parent === i))
    .sort());
  let result = { note: 'no container with an unwalked relation inside it' };
  for (const c of conts) {
    const kids = await page.evaluate((x) => [...window.__wm.S.visible]
      .filter((i) => (window.__wm.S.byId[i] || {}).parent === x).sort(), c);
    if (kids.length < 1) continue;
    // find a relation that will add a node INSIDE this container
    const cand = await page.evaluate((x) => {
      const S = window.__wm.S;
      const kids2 = [...S.visible].filter((i) => (S.byId[i] || {}).parent === x);
      for (const id of kids2) {
        const n = S.byId[id];
        if (!n || !n.rel_counts) continue;
        const done = new Set(S.expansions.filter((e) => e.node === id).map((e) => e.relation));
        for (const k of Object.keys(n.rel_counts)) if (!done.has(k)) return { id, rel: k };
      }
      return null;
    }, c);
    if (!cand) continue;
    const leaf = kids[0];
    await drag(leaf, 55, 70);
    const a0 = await worlds();
    const placed = a0[leaf];
    await expand(cand.id, cand.rel);
    const a1 = await worlds();
    const after = a1[leaf];
    result = {
      container: c, leaf, expanded: cand,
      placedAt: placed, afterExpandAt: after,
      leafDriftPx: after ? +Math.hypot(after.x - placed.x, after.y - placed.y).toFixed(2) : null,
      allDrift: drift(a0, a1, Object.keys(a0)),
      tier2Log: await page.evaluate(() => {
        const m = window.__wm.layoutMetrics();
        return m ? m.tier2 : null;
      }),
      movedSetHonoured: await page.evaluate(() => [...window.__wm.S.moved]),
    };
    await shot('t14-01-leaf-drag-then-expand-inside');
    break;
  }
  rec('T14 leaf drag then expansion inside the same container', result);
}


// =====================================================================
// T15 drag a leaf, then add a SIBLING to the same container
// =====================================================================
if (want('t15')) {
  await load('s1-spacetop');
  await expand('d:lena', 'remote:out');
  // find a container that already has >= 1 child and can gain another
  const plan = await page.evaluate(() => {
    const S = window.__wm.S;
    const kidsOf = (c) => [...S.visible].filter((i) => (S.byId[i] || {}).parent === c);
    for (const c of [...S.visible].sort()) {
      const kids = kidsOf(c);
      if (!kids.length) continue;
      // any unwalked relation anywhere that could land a node in c
      for (const id of [...S.visible].sort()) {
        const n = S.byId[id];
        if (!n || !n.rel_counts) continue;
        const done = new Set(S.expansions.filter((e) => e.node === id).map((e) => e.relation));
        for (const k of Object.keys(n.rel_counts)) if (!done.has(k)) return { c, kids, from: id, rel: k };
      }
    }
    return null;
  });
  let out = { note: 'no plan' };
  if (plan) {
    const leaf = plan.kids[0];
    await drag(leaf, 40, 45);
    const a0 = await worlds();
    const placed = a0[leaf];
    const localBefore = await page.evaluate((l) => window.__wm.S.layout.local.get(l), leaf);
    // keep expanding until that container actually gains a child
    let gained = null;
    for (let i = 0; i < 6 && !gained; i++) {
      const cand = await page.evaluate(() => {
        const S = window.__wm.S;
        for (const id of [...S.visible].sort()) {
          const n = S.byId[id];
          if (!n || !n.rel_counts) continue;
          const done = new Set(S.expansions.filter((e) => e.node === id).map((e) => e.relation));
          for (const k of Object.keys(n.rel_counts)) if (!done.has(k)) return { id, rel: k };
        }
        return null;
      });
      if (!cand) break;
      const kb = await page.evaluate((c) => [...window.__wm.S.visible]
        .filter((i) => (window.__wm.S.byId[i] || {}).parent === c).length, plan.c);
      await expand(cand.id, cand.rel);
      const ka = await page.evaluate((c) => [...window.__wm.S.visible]
        .filter((i) => (window.__wm.S.byId[i] || {}).parent === c).length, plan.c);
      if (ka > kb) gained = { cand, kb, ka };
    }
    const a1 = await worlds();
    out = {
      container: plan.c, leaf, gained,
      localBefore, localAfter: await page.evaluate((l) => window.__wm.S.layout.local.get(l), leaf),
      leafDriftPx: a1[leaf] ? +Math.hypot(a1[leaf].x - placed.x, a1[leaf].y - placed.y).toFixed(2) : null,
      tier2Log: await page.evaluate(() => {
        const m = window.__wm.layoutMetrics(); return m ? m.tier2 : null;
      }),
      metrics: await page.evaluate(() => {
        const m = window.__wm.layoutMetrics();
        return m ? { leaves: m.leaves, leavesInside: m.leavesInside, leavesOutside: m.leavesOutside } : null;
      }),
    };
    await shot('t15-01-leaf-drag-then-sibling-added');
  }
  rec('T15 leaf drag then a sibling arrives', out);
}


// =====================================================================
// T16 does `fixed` really pin a dragged sibling when tier 2 re-runs?
//     drag leaf A, hide leaf B, show leaf B -> tier 2 re-runs on the box
// =====================================================================
if (want('t16')) {
  await load('s2-babs-ria');
  await revealAll();
  const kids = await page.evaluate(() => [...window.__wm.S.visible]
    .filter((i) => (window.__wm.S.byId[i] || {}).parent === 'd:ria').sort());
  const A = kids[0], Bk = kids[1];
  await drag(A, 60, 80);
  const a0 = await worlds();
  const placedA = a0[A];
  await hide(Bk, false);
  await showAll();
  const a1 = await worlds();
  const siblings = kids.filter((k) => k !== Bk);
  rec('T16 pinning of a dragged sibling across a tier-2 re-run', {
    container: 'd:ria', dragged: A, hiddenThenShown: Bk,
    draggedLeafDriftPx: a1[A] ? +Math.hypot(a1[A].x - placedA.x, a1[A].y - placedA.y).toFixed(2) : null,
    otherSiblingsDrift: drift(a0, a1, siblings),
    hiddenLeafDrift: a1[Bk] && a0[Bk]
      ? +Math.hypot(a1[Bk].x - a0[Bk].x, a1[Bk].y - a0[Bk].y).toFixed(2) : null,
    tier2Log: await page.evaluate(() => {
      const m = window.__wm.layoutMetrics(); return m ? m.tier2 : null;
    }),
  });
  await shot('t16-01-pin-across-tier2');
}


// =====================================================================
// T17 how much room does the clamp actually leave a leaf?
// =====================================================================
if (want('t17')) {
  const freedom = {};
  for (const sc of ['s1-spacetop', 's2-babs-ria', 's3-forks']) {
    await load(sc);
    await revealAll();
    freedom[sc] = await page.evaluate(() => {
      const S = window.__wm.S;
      const PAD = { top: 48, side: 30, bottom: 30 };
      const rows = [];
      for (const c of [...S.visible]) {
        const kids = [...S.visible].filter((i) => (S.byId[i] || {}).parent === c);
        if (!kids.length) continue;
        const box = S.layout.size.get(c);
        const kid = S.layout.size.get(kids[0]) || { w: 210, h: 76 };
        rows.push({
          container: c, kids: kids.length, box: { w: box.w, h: box.h },
          freedomX: Math.max(0, box.w - 2 * PAD.side - kid.w),
          freedomY: Math.max(0, box.h - PAD.top - PAD.bottom - kid.h),
        });
      }
      return {
        containers: rows.length,
        zeroFreedomBoth: rows.filter((r) => !r.freedomX && !r.freedomY).length,
        zeroFreedomX: rows.filter((r) => !r.freedomX).length,
        rows: rows.sort((a, b) => a.freedomX - b.freedomX).slice(0, 4),
      };
    });
  }
  // and drive one of the zero-freedom cases for real
  await load('s1-spacetop');
  await revealAll();
  const before = await worlds();
  const hBefore = await page.evaluate(() => window.__wm.S.history.past.length);
  let toastText = null;
  try {
    await drag('d:lena', 120, 90);
    toastText = await page.evaluate(() => {
      const t = document.querySelector('.toast'); return t ? t.textContent : null;
    });
  } catch (e) { toastText = 'DRAG THREW: ' + String(e).slice(0, 120); }
  const after = await worlds();
  await shot('t17-01-leaf-clamped-in-its-box');
  rec('T17 clamp leaves how much room', {
    freedom,
    zeroFreedomDrive: {
      node: 'd:lena',
      movedPx: drift(before, after, ['d:lena']).max,
      historyEntriesBefore: hBefore,
      historyEntriesAfter: await page.evaluate(() => window.__wm.S.history.past.length),
      toast: toastText,
    },
  });
}


// =====================================================================
// T18 save -> load -> save must be a fixpoint
// =====================================================================
if (want('t18')) {
  await load('s2-babs-ria');
  await revealAll();
  const tops = await page.evaluate(() => [...window.__wm.S.visible]
    .filter((i) => !(window.__wm.S.byId[i] || {}).parent).sort());
  const conts = await page.evaluate(() => [...window.__wm.S.visible]
    .filter((i) => [...window.__wm.S.visible].some((k) => (window.__wm.S.byId[k] || {}).parent === i))
    .sort());
  const kids = await page.evaluate((c) => [...window.__wm.S.visible]
    .filter((i) => (window.__wm.S.byId[i] || {}).parent === c).sort(), conts[0]);
  await drag(tops[0], 110, -70, { header: true });
  await drag(kids[0], 45, 50);
  await page.evaluate(() => window.__wm.saveView('fixa'));
  await load('s2-babs-ria');
  await page.evaluate(() => window.__wm.loadView('fixa'));
  await settle();
  await page.evaluate(() => window.__wm.saveView('fixb'));
  const read = (n) => readFileSync(resolve(ROOT, `views/s2-babs-ria.${n}.view.json`), 'utf8').split('\n');
  const A = read('fixa'), Bv = read('fixb');
  const diffs = [];
  for (let i = 0; i < Math.max(A.length, Bv.length); i++) {
    if (A[i] !== Bv[i]) diffs.push({ line: i + 1, a: A[i], b: Bv[i] });
  }
  rec('T18 save -> load -> save fixpoint', {
    linesA: A.length, linesB: Bv.length,
    differingLines: diffs.length,
    differences: diffs.slice(0, 8),
    onlyTimestamp: diffs.every((d) => (d.a || '').includes('saved_at')),
  });
}

writeFileSync(resolve(ROOT, 'tools/last-dragbundle.json'), JSON.stringify(R, null, 2));
say('\n\nwrote tools/last-dragbundle.json');
await browser.close();
