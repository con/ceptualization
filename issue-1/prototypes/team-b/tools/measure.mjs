// Timing benchmark: Graphviz WASM layout cost per scenario at full size,
// and the layout churn (how far already-placed nodes move) per expansion.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const B = 'http://127.0.0.1:8391';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
await p.goto(B, { waitUntil: 'networkidle' });
await p.waitForFunction(() => window.__wm, { timeout: 20000 });

// simpler: drive the app itself and read its own timings
const rows = [];
for (const [scen, steps] of Object.entries({
  's1-spacetop': [['d:lena', 'remote'], ['d:smaug', 'remote'], ['d:typhon', 'remote'],
                  ['d:rolando-x', 'remote'], ['d:discovery', 'same_annex_uuid'], ['d:rolando', 'remote']],
  's2-babs-ria': [['d:super', 'subdataset'], ['d:super', 'remote'], ['d:super', 'worktree_of'], ['d:ria', 'part']],
  's3-forks': [['d:mine', 'remote'], ['d:upstream', 'fork_of'], ['d:proj-a', 'shares_history_with'],
               ['d:proj-a', 'candidate_same_as']],
})) {
  await p.evaluate((x) => window.__wm.loadScenario(x), scen);
  await p.waitForTimeout(900);
  for (const [id, rel] of steps) {
    const t0 = Date.now();
    await p.evaluate(([i, r]) => window.__wm.doExpand(i, r), [id, rel]);
    await p.waitForTimeout(150);
    const t = await p.evaluate(() => JSON.parse(JSON.stringify(window.__wm.S.timings)));
    const n = await p.evaluate(() => window.__wm.cy.nodes().length);
    rows.push({ scen, step: `${id} ${rel}`, nodes: n, wallMs: Date.now() - t0,
      probeMs: t.probeMs, dotFetchMs: t.dotFetchMs, gvMs: t.gvMs, dotBytes: t.dotBytes,
      churn: t.churn });
  }
  // 10 repeat layouts at full size
  const rep = await p.evaluate(async () => {
    const times = [];
    for (let i = 0; i < 10; i++) {
      const t0 = performance.now();
      await window.__wm.render({ animate: false });
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    return { fullRenderMedianMs: Math.round(times[5]), min: Math.round(times[0]), max: Math.round(times[9]),
      gvMs: window.__wm.S.timings.gvMs, nodes: window.__wm.cy.nodes().length };
  });
  rows.push({ scen, repeatRender: rep });
}
console.log(JSON.stringify(rows, null, 1));
await b.close();
