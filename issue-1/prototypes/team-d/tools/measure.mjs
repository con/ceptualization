// Team D measurement harness. Everything in COMPARISON.md comes from the JSON
// this writes to tools/last-metrics.json. Nothing here is hand-typed.
//
//   node tools/measure.mjs            (server must already be running)
//
// Metrics, in the order the mandate asks for them:
//   1 container displacement + leaf displacement, per expansion, per mode
//   2 view-diff line churn between two consecutive saves
//   3 edge count before/after collapse
//   4 first paint
//   5 frame time at 68 nodes, at DPR 1 and DPR 2
//   6 rendered edge-label px at fit zoom
//   7 nodes reachable from the seed

import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const B = process.env.WM_BASE || 'http://127.0.0.1:8861';
const OUT = { base: B, when: new Date().toISOString(), runs: [], notes: [] };

const SEQ = {
  's1-spacetop': [
    ['d:lena', 'remote:out'],
    ['d:typhon', 'remote:out'],
    ['d:rolando', 'remote:in'],
    ['d:smaug', 'remote:out'],
    ['d:discovery', 'same_annex_uuid:out'],
    ['h:github', 'contains:out'],
  ],
  's2-babs-ria': [
    ['d:super', 'subdataset:out'],
    ['d:super', 'worktree_of:in'],
    ['d:super', 'remote:out'],
    ['d:ria', 'part:out'],          // <- the 980 px test: 40 children at once
    ['d:ria-sub-001', 'remote:out'],
  ],
  's3-forks': [
    ['d:mine', 'remote:out'],
    ['d:upstream', 'fork_of:in'],   // <- 60 forks at once
    ['h:lena', 'contains:out'],
    ['d:proj-a-clone', 'remote:out'],
    ['d:proj-a', 'shares_history_with:out'],
    ['d:tpl', 'shares_history_with:in'],
  ],
};

const browser = await chromium.launch();

async function page(dpr = 1) {
  const p = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: dpr });
  p.on('pageerror', (e) => OUT.notes.push('PAGEERROR ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error') OUT.notes.push('CONSOLE ' + m.text()); });
  await p.goto(B, { waitUntil: 'networkidle' });
  await p.waitForFunction(() => window.__wm && window.__wm.cy && window.__wm.cy.nodes().length > 0,
    { timeout: 30000 });
  return p;
}

const load = async (p, s) => {
  await p.evaluate((x) => window.__wm.loadScenario(x), s);
  await p.waitForFunction((x) => window.__wm.S.scenario === x && !window.__wm.S.busy, s, { timeout: 20000 });
  await p.waitForTimeout(250);
};
const expand = (p, id, rel) => p.evaluate(([i, r]) => window.__wm.doExpand(i, r, { nodelay: true }), [id, rel]);

async function frameSample(p, fn) {
  await p.evaluate(() => {
    window.__F = []; window.__stopF = false;
    let last = performance.now();
    const tick = (t) => { window.__F.push(t - last); last = t; if (!window.__stopF) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });
  const r = await fn();
  await p.waitForTimeout(400);
  const f = await p.evaluate(() => {
    window.__stopF = true;
    const a = window.__F.slice(1).sort((x, y) => x - y);
    if (!a.length) return null;
    return {
      frames: a.length,
      medianMs: +a[a.length >> 1].toFixed(1),
      longestMs: +a[a.length - 1].toFixed(1),
      fps: +(1000 / (a.reduce((x, y) => x + y, 0) / a.length)).toFixed(1),
    };
  });
  return { frames: f, result: r };
}

// ------------------------------------------------------------ 1 displacement
for (const mode of ['sticky', 'full']) {
  for (const [scen, seq] of Object.entries(SEQ)) {
    const p = await page(1);
    await p.evaluate((m) => window.__wm.setLayoutMode(m), mode);
    const t0 = Date.now();
    await load(p, scen);
    const firstPaint = await p.evaluate(() => window.__wm.S.timings.firstPaintMs);
    const run = { scenario: scen, mode, firstPaintMs: firstPaint, coldLoadMs: Date.now() - t0, expansions: [] };
    for (const [id, rel] of seq) {
      const m = await expand(p, id, rel);
      if (!m) { run.expansions.push({ key: `${id}|${rel}`, failed: true }); continue; }
      run.expansions.push({
        key: m.key, newNodes: m.newNodes, tier1Ran: m.tier1Ran,
        layoutMs: m.totalMs, netMs: m.netMs,
        containers: m.containers, containersCorner: m.containersCorner,
        containersAnchor: m.containersAnchor,
        containersOther: m.containersOther, grown: m.grown, focus: m.focus,
        leaves: m.leaves,
        leavesInside: m.leavesInside, leavesOutside: m.leavesOutside,
        tier2: m.tier2,
      });
    }
    run.final = await p.evaluate(() => ({
      nodes: window.__wm.cy.nodes().length,
      edges: window.__wm.cy.edges().length,
      tier1Runs: window.__wm.S.layout.tier1Runs,
      tier2Runs: window.__wm.S.layout.tier2Runs,
      reach: window.__wm.S.reach,
    }));
    OUT.runs.push(run);
    await p.close();
    console.log(`[displacement] ${mode} ${scen}: ${run.expansions.length} expansions`);
  }
}

// ------------------------------- 1b layout invariants: containment + overlap
{
  const p = await page(1);
  OUT.invariants = {};
  for (const [scen, seq] of Object.entries(SEQ)) {
    await load(p, scen);
    for (const [id, rel] of seq) await expand(p, id, rel);
    OUT.invariants[scen] = await p.evaluate(() => {
      const cy = window.__wm.cy, S = window.__wm.S;
      const box = (n) => { const q = n.position(), w = n.data('w'), h = n.data('h');
        return { x1: q.x - w / 2, x2: q.x + w / 2, y1: q.y - h / 2, y2: q.y + h / 2 }; };
      const ov = (a, b) => a.x1 < b.x2 - 0.5 && b.x1 < a.x2 - 0.5 && a.y1 < b.y2 - 0.5 && b.y1 < a.y2 - 0.5;
      const nodes = cy.nodes().map((n) => ({ id: n.id(), b: box(n),
        parent: (S.byId[n.id()] || {}).parent, isC: n.data('isContainer') }));
      const anc = (id, want) => { let cur = (S.byId[id] || {}).parent, g = 0;
        while (cur && g++ < 12) { if (cur === want) return true; cur = (S.byId[cur] || {}).parent; } return false; };
      const viol = [], overlaps = [];
      for (const n of nodes) {
        if (!n.parent) continue;
        const par = nodes.find((x) => x.id === n.parent);
        if (!par) continue;
        if (!(n.b.x1 >= par.b.x1 - 0.5 && n.b.x2 <= par.b.x2 + 0.5
          && n.b.y1 >= par.b.y1 - 0.5 && n.b.y2 <= par.b.y2 + 0.5)) viol.push(n.id + ' escapes ' + par.id);
      }
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i], c = nodes[j];
          if (a.isC && anc(c.id, a.id)) continue;
          if (c.isC && anc(a.id, c.id)) continue;
          if (ov(a.b, c.b)) overlaps.push(a.id + ' n ' + c.id);
        }
      }
      return { nodes: nodes.length, containmentViolations: viol.length,
        overlappingPairs: overlaps.length, sample: overlaps.slice(0, 5).concat(viol.slice(0, 5)) };
    });
    console.log(`[invariants] ${scen}`, JSON.stringify(OUT.invariants[scen]));
  }
  await p.close();
}

// -------------------------------------------------- 3 collapse edge counts
{
  const p = await page(1);
  OUT.collapse = {};
  for (const [scen, seq] of Object.entries(SEQ)) {
    await load(p, scen);
    for (const [id, rel] of seq) await expand(p, id, rel);
    const containers = await p.evaluate(() => [...window.__wm.S.visible]
      .filter((i) => window.__wm.S.byId[i] && [...window.__wm.S.visible]
        .some((k) => window.__wm.S.byId[k].parent === i)));
    const each = {};
    for (const c of containers) {
      each[c] = await p.evaluate((x) => window.__wm.verifyCollapse([x]), c);
    }
    const all = await p.evaluate((cs) => window.__wm.verifyCollapse(cs), containers);
    OUT.collapse[scen] = { containers, each, all };
    console.log(`[collapse] ${scen}: all ->`, JSON.stringify(all));
  }
  await p.close();
}

// -------------------------- 3b collapse -> expand round trip must be 0 px
{
  const p = await page(1);
  OUT.collapseRoundTrip = [];
  for (const [scen, seq, target] of [
    ['s2-babs-ria', SEQ['s2-babs-ria'], 'd:ria'],
    ['s3-forks', SEQ['s3-forks'], 'h:github'],
  ]) {
    await load(p, scen);
    for (const [id, rel] of seq) await expand(p, id, rel);
    const snap = () => p.evaluate(() => {
      const o = {}; window.__wm.cy.nodes().forEach((n) => { o[n.id()] = n.position(); }); return o;
    });
    const before = await snap();
    await p.evaluate((t) => window.__wm.toggleCollapse(t), target);
    await p.waitForTimeout(600);
    const collapsed = await p.evaluate(() => ({
      nodes: window.__wm.cy.nodes().length, edges: window.__wm.cy.edges().length }));
    await p.evaluate((t) => window.__wm.toggleCollapse(t), target);
    await p.waitForTimeout(600);
    const after = await snap();
    let worst = 0, worstId = null, n = 0;
    for (const k of Object.keys(before)) {
      if (!after[k]) continue;
      n += 1;
      const d = Math.hypot(after[k].x - before[k].x, after[k].y - before[k].y);
      if (d > worst) { worst = d; worstId = k; }
    }
    const rec = { scenario: scen, container: target, nodes: n,
      maxDriftPx: +worst.toFixed(3), worstId, whileCollapsed: collapsed };
    OUT.collapseRoundTrip.push(rec);
    console.log('[collapse round trip]', JSON.stringify(rec));
  }
  await p.close();
}

// ------------------------------------- 5 frame time revealing 68 nodes, DPR 1/2
// Team A's comparable number: reveal all 68 s3 nodes at once -> 6.2 fps,
// 416.6 ms longest frame (DPR unstated, software WebGL).
OUT.reveal = [];
for (const dpr of [1, 2]) {
  for (const scen of ['s3-forks', 's2-babs-ria']) {
    const p = await page(dpr);
    await load(p, scen);
    const s = await frameSample(p, () => p.evaluate(() => window.__wm.revealAll()));
    const after = await p.evaluate(() => ({
      nodes: window.__wm.cy.nodes().length, edges: window.__wm.cy.edges().length,
    }));
    OUT.reveal.push({ scenario: scen, dpr, ...after, frames: s.frames,
      layoutMs: s.result && s.result.totalMs,
      containers: s.result && s.result.containers, leaves: s.result && s.result.leaves });
    console.log(`[frames] ${scen} dpr=${dpr}`, JSON.stringify(s.frames), JSON.stringify(after));
    await p.close();
  }
}

// --------------------------------- 6 rendered label px at fit zoom, all scenarios
OUT.labels = {};
{
  const p = await page(1);
  for (const [scen, seq] of Object.entries(SEQ)) {
    await load(p, scen);
    for (const [id, rel] of seq) await expand(p, id, rel);
    await p.evaluate(() => window.__wm.fitAll());
    await p.waitForTimeout(200);
    const demand = await p.evaluate(() => window.__wm.measureRendered());
    await p.evaluate(() => { window.__wm.applyLabelPolicy({ mode: 'all' }); window.__wm.compensateZoom(); });
    const all = await p.evaluate(() => window.__wm.measureRendered());
    await p.evaluate(() => { window.__wm.applyLabelPolicy({ mode: 'demand' }); window.__wm.compensateZoom(); });
    // select the node the issue is about and read its incident edge labels
    const sel = { 's1-spacetop': 'd:rolando-x', 's2-babs-ria': 'd:super', 's3-forks': 'd:proj-a' }[scen];
    let selected = null;
    if (sel) {
      await p.evaluate((x) => window.__wm.select(x), sel);
      selected = await p.evaluate(() => window.__wm.measureRendered());
    }
    OUT.labels[scen] = {
      fitZoom: demand.zoom,
      demand: { labelled: demand.labelledEdges, total: demand.totalEdges,
        renderedPx: demand.edges.map((e) => e.renderedPx),
        nodeFindingPx: demand.nodes.map((n) => n.renderedPx),
        plainNodePx: demand.plainNodePx },
      all: { labelled: all.labelledEdges, renderedPxSample: all.edges.slice(0, 5).map((e) => e.renderedPx) },
      selected: selected && { node: sel, labelled: selected.labelledEdges,
        renderedPx: selected.edges.map((e) => ({ label: e.label, px: e.renderedPx })) },
    };
    console.log(`[labels] ${scen} fitZoom=${demand.zoom} demandPx=${JSON.stringify(OUT.labels[scen].demand.renderedPx)}`);
  }
  await p.close();
}

// ---------------------------------------------- 2 view diff churn + persistence
{
  const p = await page(1);
  await load(p, 's1-spacetop');
  for (const [id, rel] of SEQ['s1-spacetop'].slice(0, 4)) await expand(p, id, rel);
  await p.evaluate(() => window.__wm.fitAll());
  await p.evaluate(() => window.__wm.saveView('step1'));
  await p.waitForTimeout(200);
  // save the identical state twice: a stable generator must produce 0 changed lines
  await p.evaluate(() => window.__wm.saveView('step1b'));
  await p.waitForTimeout(200);
  await expand(p, 'd:discovery', 'same_annex_uuid:out');
  await p.evaluate(() => window.__wm.fitAll());
  await p.evaluate(() => window.__wm.saveView('step2'));
  await p.waitForTimeout(300);

  const f = (n) => resolve(ROOT, 'views', `s1-spacetop.${n}.view.json`);
  const lines = (n) => readFileSync(f(n), 'utf8').split('\n').length;
  const diffCount = (a, b) => {
    try {
      execSync(`diff -u ${f(a)} ${f(b)} > /tmp/wm-diff.txt`, { stdio: 'ignore' });
      return 0;
    } catch (e) {
      const d = readFileSync('/tmp/wm-diff.txt', 'utf8').split('\n');
      return d.filter((l) => (l.startsWith('+') || l.startsWith('-'))
        && !l.startsWith('+++') && !l.startsWith('---')).length;
    }
  };
  // saved_at differs between two saves of the same state; count it and subtract
  OUT.viewDiff = {
    step1Lines: lines('step1'),
    step2Lines: lines('step2'),
    identicalStateChangedLines: diffCount('step1', 'step1b'),
    oneExpansionChangedLines: diffCount('step1', 'step2'),
    note: 'changed lines counted as +/- lines in `diff -u`, including the 2 lines of saved_at timestamp',
  };
  console.log('[viewdiff]', JSON.stringify(OUT.viewDiff));

  // persistence: reload the saved view and compare world positions, 0 px expected
  const before = await p.evaluate(() => {
    const w = {};
    window.__wm.cy.nodes().forEach((n) => { w[n.id()] = n.position(); });
    return w;
  });
  await p.evaluate(() => window.__wm.loadView('step2'));
  await p.waitForTimeout(600);
  const after = await p.evaluate(() => {
    const w = {};
    window.__wm.cy.nodes().forEach((n) => { w[n.id()] = n.position(); });
    return w;
  });
  const drift = [];
  for (const [id, q] of Object.entries(before)) {
    if (!after[id]) continue;
    drift.push(Math.hypot(after[id].x - q.x, after[id].y - q.y));
  }
  drift.sort((a, b) => a - b);
  OUT.reloadDrift = {
    n: drift.length,
    maxPx: +(drift[drift.length - 1] || 0).toFixed(3),
    medianPx: +(drift[drift.length >> 1] || 0).toFixed(3),
  };
  console.log('[reload drift]', JSON.stringify(OUT.reloadDrift));
  await p.close();
}

// ------------------------------------------------- 4 cold first paint, 5 samples
{
  OUT.coldBoot = { samples: [], note: 'fresh browser context (empty cache) each sample, '
    + 'navigate -> first frame with a painted seed node' };
  for (let i = 0; i < 5; i++) {
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    const pg = await ctx.newPage();
    const t = Date.now();
    await pg.goto(B, { waitUntil: 'commit' });
    await pg.waitForFunction(() => window.__wm && window.__wm.cy && window.__wm.cy.nodes().length > 0,
      { timeout: 30000 });
    OUT.coldBoot.samples.push(Date.now() - t);
    await ctx.close();
  }
  OUT.coldBoot.samples.sort((a, b2) => a - b2);
  OUT.coldBoot.medianMs = OUT.coldBoot.samples[2];
  console.log('[coldboot]', JSON.stringify(OUT.coldBoot));
}

// ---------------------------------------------------------------- 7 reachability
{
  OUT.reach = {};
  for (const s of Object.keys(SEQ)) {
    const r = await (await fetch(`${B}/api/roots/${s}`)).json();
    OUT.reach[s] = {
      total: r.total,
      componentsRelationsOnly: r.components_relations_only,
      componentsWithContains: r.components_with_contains,
      reachableFromSeedRelationsOnly: r.reachable_relations_only,
      reachableWithContains: r.reachable_with_contains,
      needsContains: r.needs_contains,
      roots: r.roots.map((x) => ({ root: x.root, size: x.size, hasSeed: x.has_seed })),
    };
  }
  console.log('[reach]', JSON.stringify(OUT.reach, null, 1).slice(0, 800));
}

await browser.close();
writeFileSync(resolve(ROOT, 'tools', 'last-metrics.json'), JSON.stringify(OUT, null, 2) + '\n');
console.log('\nwrote tools/last-metrics.json  notes:', OUT.notes.length);
if (OUT.notes.length) console.log(OUT.notes.slice(0, 10).join('\n'));
