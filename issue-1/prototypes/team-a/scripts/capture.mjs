/**
 * Team A — Playwright capture + measurement harness.
 *
 *   node scripts/capture.mjs            # screenshots into screenshots/ + metrics to stdout
 *   node scripts/capture.mjs --metrics  # measurement runs only
 *
 * Requires the app to be running (./run.sh) on http://127.0.0.1:8848.
 * Never run `playwright install` — chromium already lives in PLAYWRIGHT_BROWSERS_PATH.
 */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = `${ROOT}/screenshots`;
const URL = process.env.WORLDMAP_URL || 'http://127.0.0.1:8848/';
const VIEW = { width: 1600, height: 1000 };
const onlyMetrics = process.argv.includes('--metrics');

mkdirSync(SHOTS, { recursive: true });

const problems = [];
const results = { firstRender: {}, runs: [], revealAll: [], relayout: [] };

function newPage(browser) {
  return browser.newPage({ viewport: VIEW, deviceScaleFactor: 1 });
}

async function boot(browser) {
  const page = await newPage(browser);
  page.setDefaultTimeout(25000);
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push('console.error: ' + m.text());
  });
  page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
  const t0 = Date.now();
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__teamA?.ready === true, { timeout: 30000 });
  await page.waitForFunction(() => window.__teamA.cy.nodes().length > 0);
  results.navToSeedMs = Date.now() - t0;
  return page;
}

const shot = async (page, name) => {
  if (onlyMetrics) return;
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
  process.stdout.write(`  shot ${name}.png\n`);
};

async function pick(page, id) {
  await page.evaluate((s) => window.__teamA.pick(s), id);
  await page.waitForTimeout(500);
  const m = await page.evaluate(() => window.__teamA.metrics());
  results.firstRender[id] = m.firstRenderMs;
}

async function expand(page, node, rel) {
  const rec = await page.evaluate(([n, r]) => window.__teamA.expand(n, r), [node, rel]);
  await page.waitForTimeout(450);
  return rec;
}

// A fixed, realistic click path per scenario.
const PATHS = {
  's1-spacetop': [
    ['d:lena', 'remote:out'],
    ['d:typhon', 'remote:out'],
    ['d:rolando', 'remote:out'],
    ['d:smaug', 'remote:out'],
    ['d:discovery', 'same_annex_uuid:out'],
    ['d:rolando-x', 'remote:in'],
    ['d:typhon-bare', 'remote:out']
  ],
  's2-babs-ria': [
    ['d:super', 'subdataset:out'],
    ['d:super', 'remote:out'],
    ['d:ria', 'part:out'],
    ['d:super', 'worktree_of:in'],
    ['d:ria-sub-001', 'remote:out'],
    ['d:ria-sub-002', 'remote:out']
  ],
  's3-forks': [
    ['d:mine', 'remote:out'],
    ['d:upstream', 'fork_of:in'],
    ['h:lena', 'host_scan:out'],
    ['d:proj-a-clone', 'candidate_same_as:out'],
    ['d:proj-a', 'candidate_same_as:out'],
    ['d:proj-a', 'shares_history_with:out']
  ]
};

async function runPath(page, scenario, { pin = true } = {}) {
  await pick(page, scenario);
  await page.evaluate((v) => window.__teamA.setPin(v), pin);
  for (const [n, r] of PATHS[scenario]) await expand(page, n, r);
  const m = await page.evaluate(() => window.__teamA.metrics());
  results.runs.push({ scenario, pin, expansions: m.expansions });
  return m;
}

const browser = await chromium.launch();
let page = await boot(browser);

/** Run a section on a fresh page so a hang in one scenario cannot lose the rest. */
async function section(name, fn) {
  process.stdout.write(name + '\n');
  try {
    await withTimeout(fn(), 180000, name);
  } catch (err) {
    problems.push(`section ${name} failed: ${err.message}`);
    process.stdout.write(`  !! ${name}: ${err.message}\n`);
    try { await page.close(); } catch { /* ignore */ }
    page = await boot(browser);
  }
}
function withTimeout(promise, ms, what) {
  let t;
  return Promise.race([
    promise.finally(() => clearTimeout(t)),
    new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`${what} timed out after ${ms}ms`)), ms); })
  ]);
}


// ---------------------------------------------------------------- s1 --------
await section('s1-spacetop', async () => {
  await pick(page, 's1-spacetop');
  await shot(page, 's1-01-seed-dark');

  // mid-expansion: fire the probe, screenshot while it is still in flight
  await page.evaluate(() => {
    window.__teamA.expand('d:lena', 'remote:out');
  });
  await page.waitForTimeout(260);
  await shot(page, 's1-02-probing-in-flight');
  await page.waitForFunction(() => window.__teamA.idle(), { timeout: 20000 });
  await page.waitForTimeout(700);

  for (const [n, r] of PATHS['s1-spacetop'].slice(1)) await expand(page, n, r);
  await page.evaluate(() => window.__teamA.fit());
  await page.waitForTimeout(600);
  await shot(page, 's1-03-expanded-dark');

  const m = await page.evaluate(() => window.__teamA.metrics());
  results.runs.push({ scenario: 's1-spacetop', pin: true, expansions: m.expansions });

  await page.evaluate(() => window.__teamA.focus(['d:discovery', 'd:discovery-copy']));
  await page.waitForTimeout(900);
  await shot(page, 's1-04-duplicate-annex-uuid-error');

  await page.evaluate(() => {
    window.__teamA.clearFocus();
    window.__teamA.select('d:lena');
    window.__teamA.fit();
  });
  await page.waitForTimeout(400);
  await shot(page, 's1-05-inspector-seed');

  await page.evaluate(() => {
    window.__teamA.clearFocus();
    window.__teamA.setTheme('light');
  });
  await page.waitForTimeout(300);
  await page.evaluate(() => window.__teamA.fit());
  await page.waitForTimeout(700);
  await shot(page, 's1-06-expanded-light');
  await page.evaluate(() => window.__teamA.setTheme('dark'));
});

// ---------------------------------------------------------------- s2 --------
await section('s2-babs-ria', async () => {
  await pick(page, 's2-babs-ria');
  await shot(page, 's2-01-seed-dark');
  for (const [n, r] of PATHS['s2-babs-ria']) await expand(page, n, r);
  await page.evaluate(() => window.__teamA.fit());
  await page.waitForTimeout(700);
  await shot(page, 's2-02-ria-store-expanded');
  const m = await page.evaluate(() => window.__teamA.metrics());
  results.runs.push({ scenario: 's2-babs-ria', pin: true, expansions: m.expansions });

  await page.evaluate(() => window.__teamA.select('d:ria'));
  await page.waitForTimeout(250);
  if (!(await page.locator('[data-collapse]').count())) throw new Error('no collapse control on d:ria');
  await page.locator('[data-collapse]').first().click();
  await page.waitForTimeout(500);
  await page.evaluate(() => window.__teamA.fit());
  await page.waitForTimeout(600);
  await shot(page, 's2-03-ria-store-collapsed');

  await page.evaluate(() => window.__teamA.select('d:ria'));
  await page.waitForTimeout(250);
  await page.locator('[data-collapse]').first().click();
  await page.waitForTimeout(500);
  await page.evaluate(() => window.__teamA.setTheme('light'));
  await page.waitForTimeout(300);
  await page.evaluate(() => window.__teamA.fit());
  await page.waitForTimeout(700);
  await shot(page, 's2-04-deep-nesting-light');
  await page.evaluate(() => window.__teamA.setTheme('dark'));
});

// ---------------------------------------------------------------- s3 --------
await section('s3-forks', async () => {
  await pick(page, 's3-forks');
  await shot(page, 's3-01-seed-dark');
  for (const [n, r] of PATHS['s3-forks']) await expand(page, n, r);
  await page.evaluate(() => window.__teamA.fit());
  await page.waitForTimeout(700);
  await shot(page, 's3-02-forks-greyed-out');
  const m = await page.evaluate(() => window.__teamA.metrics());
  results.runs.push({ scenario: 's3-forks', pin: true, expansions: m.expansions });

  await page.evaluate(() => window.__teamA.select('d:fork-yarikoptic'));
  await page.waitForTimeout(300);
  if (!(await page.locator('[data-preview]').count())) throw new Error('no preview control on d:fork-yarikoptic');
  await page.locator('[data-preview]').first().click();
  await page.waitForTimeout(1000);
  await shot(page, 's3-03-preview-before-adding');
  await page.locator('[data-add-remote]').first().click();
  await page.waitForTimeout(700);
  await shot(page, 's3-04-fork-added-as-remote');

  await page.evaluate(() => window.__teamA.setHideInactive(true));
  await page.waitForTimeout(300);
  await page.evaluate(() => window.__teamA.fit());
  await page.waitForTimeout(700);
  await shot(page, 's3-05-inactive-forks-hidden');
  await page.evaluate(() => window.__teamA.setHideInactive(false));
  await page.waitForTimeout(300);
  await page.evaluate(() => window.__teamA.focus(['d:proj-a', 'd:proj-b', 'd:tpl']));
  await page.waitForTimeout(1000);
  await shot(page, 's3-06-identity-trap');
});

// ------------------------------------------------------------- measurement --
for (const scenario of Object.keys(PATHS)) {
  await section(`measure ${scenario} (unpinned)`, async () => {
    await runPath(page, scenario, { pin: false });
  });
  await section(`measure ${scenario} (reveal-all + full re-layout)`, async () => {
    await pick(page, scenario);
    await page.evaluate((v) => window.__teamA.setPin(v), true);
    const ra = await page.evaluate(() => window.__teamA.revealAll());
    results.revealAll.push({ scenario, ...ra });
    await page.waitForTimeout(400);
    const rl = await page.evaluate(() => window.__teamA.relayout());
    results.relayout.push({ scenario, ...rl });
  });
}

results.problems = problems;
results.badgeBackend = await page.evaluate(() => window.__teamA.badgeBackend);
writeFileSync(`${ROOT}/scripts/last-metrics.json`, JSON.stringify(results, null, 2));
process.stdout.write(JSON.stringify(summarise(results), null, 2) + '\n');
if (problems.length) process.stdout.write('PROBLEMS:\n' + problems.join('\n') + '\n');
await browser.close();

function summarise(r) {
  const out = { navToSeedMs: r.navToSeedMs, firstRender: r.firstRender, badgeBackend: r.badgeBackend, perScenario: {} };
  for (const run of r.runs) {
    const k = `${run.scenario}${run.pin ? '' : ' (UNPINNED)'}`;
    const ex = run.expansions;
    if (!ex.length) continue;
    const leaf = ex.map((e) => e.displacement.leaf || e.displacement);
    out.perScenario[k] = {
      probes: ex.length,
      latencyMs: agg(ex.map((e) => e.latencyMs)),
      layoutMs: agg(ex.map((e) => e.layoutMs)),
      pinnedNodeDisplacementPx: { mean: avg(leaf.map((d) => d.mean)), worstMax: Math.max(...leaf.map((d) => d.max)) },
      fps: agg(ex.map((e) => e.frames.fps)),
      longestFrameMs: Math.max(...ex.map((e) => e.frames.longestFrameMs)),
      containersSlid: ex.filter((e) => e.separation?.moved).length,
      overlapsLeft: Math.max(...ex.map((e) => e.overlaps ?? 0)),
      biggestStep: ex.reduce((a, b) => (b.newNodes > a.newNodes ? b : a))
    };
  }
  out.revealAll = r.revealAll.map((x) => ({
    scenario: x.scenario,
    nodes: x.graphNodes,
    layoutMs: x.ms,
    fps: x.frames.fps,
    longestFrameMs: x.frames.longestFrameMs
  }));
  out.fullRelayout = r.relayout.map((x) => ({
    scenario: x.scenario,
    ms: x.ms,
    meanDisplacementPx: (x.displacement.leaf || x.displacement).mean,
    maxDisplacementPx: (x.displacement.leaf || x.displacement).max,
    fps: x.frames.fps
  }));
  return out;
}
function avg(a) { return a.length ? +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(2) : 0; }
function agg(a) { return { min: Math.min(...a), mean: avg(a), max: Math.max(...a) }; }
