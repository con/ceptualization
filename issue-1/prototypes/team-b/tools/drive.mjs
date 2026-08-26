// Playwright driver: produces every screenshot and export in the deliverable,
// and writes the raw measurement log used by UX-FINDINGS.md.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = resolve(ROOT, 'screenshots');
const EXPORTS = resolve(ROOT, 'exports');
mkdirSync(SHOTS, { recursive: true }); mkdirSync(EXPORTS, { recursive: true });
const B = 'http://127.0.0.1:8391';
const LOG = [];

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
const errs = [];
p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
p.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message));

const wm = (fn, arg) => p.evaluate(fn, arg);
const shot = async (name, note) => {
  await p.waitForTimeout(500);
  await p.screenshot({ path: `${SHOTS}/${name}.png` });
  const t = await wm(() => JSON.parse(JSON.stringify(window.__wm.S.timings)));
  const c = await wm(() => ({ n: window.__wm.cy.nodes().length, e: window.__wm.cy.edges().length, z: +window.__wm.cy.zoom().toFixed(3) }));
  LOG.push({ shot: name, note, ...c, timings: t });
  console.log(`[shot] ${name}  nodes=${c.n} edges=${c.e}  ${JSON.stringify(t)}`);
};
const expand = async (id, rel) => {
  const t0 = Date.now();
  await wm(([i, r]) => window.__wm.doExpand(i, r), [id, rel]);
  await p.waitForTimeout(200);
  LOG.push({ expand: `${id} / ${rel}`, wallMs: Date.now() - t0,
    timings: await wm(() => JSON.parse(JSON.stringify(window.__wm.S.timings))) });
};
const load = async (s) => { await wm((x) => window.__wm.loadScenario(x), s); await p.waitForTimeout(900); };
const closeInspector = () => wm(() => { const e = document.querySelector('#overlay .inspector'); if (e) e.remove(); });
const fit = async (pad = 45) => { await wm((x) => window.__wm.cy.fit(undefined, x), pad); await p.waitForTimeout(400); };

const t0boot = Date.now();
await p.goto(B, { waitUntil: 'networkidle' });
await p.waitForFunction(() => window.__wm && window.__wm.cy.nodes().length > 0, { timeout: 25000 });
LOG.push({ boot: 'cold load to first painted seed', wallMs: Date.now() - t0boot,
  timings: await wm(() => JSON.parse(JSON.stringify(window.__wm.S.timings))) });

// ---------------------------------------------------------------- s1
await closeInspector();
await shot('s1-01-seed', 'seed only: one clone on lena, nothing else probed yet');
await expand('d:lena', 'remote');
await fit();
await shot('s1-02-mid-expansion', 'after one probe of lena remotes: 6 host clusters appear, per-edge remote names visible');
await wm(() => window.__wm.doExpand('d:discovery', 'same_annex_uuid'));
await p.waitForTimeout(1400);
await expand('d:smaug', 'remote');
await expand('d:typhon', 'remote');
await fit();
await closeInspector();
await shot('s1-03-duplicate-uuid', 'duplicate annex UUID error: two discovery clones, double red border + same-annex-UUID edge');
await wm(() => window.__wm.setTheme('light')); await p.waitForTimeout(600);
await shot('s1-04-duplicate-uuid-light', 'same state, light theme');
await wm(() => window.__wm.setTheme('dark')); await p.waitForTimeout(400);

// save view #1
await wm(() => window.__wm.saveView('step1')); await p.waitForTimeout(700);

// DOT round trip dialog
await p.click('#btn-dot'); await p.waitForTimeout(600);
await shot('s1-05-dot-roundtrip', 'server-side DOT for the visible subgraph; this exact text is what the browser Graphviz lays out');
await p.click('#dlg-close'); await p.waitForTimeout(300);

// one more expansion, then save view #2 for the diff
await expand('d:rolando-x', 'remote');
await fit(); await closeInspector();
await wm(() => window.__wm.saveView('step2')); await p.waitForTimeout(700);
await shot('s1-06-after-second-save', 'state saved as step2 (one more expansion than step1)');

// reload step1 and confirm it comes back
await wm(() => window.__wm.loadView('step1')); await p.waitForTimeout(1600);
await closeInspector();
await shot('s1-07-reloaded-step1', 'step1 restored from the saved view file, positions applied verbatim (no layout run)');
const fidelity = await wm(async () => {
  const before = JSON.parse(JSON.stringify(window.__wm.S.positions.map));
  const cur = {}; window.__wm.cy.nodes().forEach((n) => { if (!n.isParent()) cur[n.id()] = { x: Math.round(n.position().x), y: Math.round(n.position().y) }; });
  let maxd = 0, miss = 0;
  for (const [k, v] of Object.entries(before)) {
    const q = cur[k]; if (!q) { miss++; continue; }
    maxd = Math.max(maxd, Math.abs(q.x - v.x), Math.abs(q.y - v.y));
  }
  return { nodes: Object.keys(before).length, missing: miss, maxDeltaPx: maxd };
});
LOG.push({ reload: 's1 step1 round trip', ...fidelity });
console.log('[reload fidelity]', JSON.stringify(fidelity));

// ---------------------------------------------------------------- s2
await load('s2-babs-ria');
await closeInspector();
await shot('s2-01-seed', 'seed only: the BABS superdataset on discovery');
await expand('d:super', 'subdataset');
await expand('d:super', 'worktree_of');
await expand('d:super', 'remote');
await fit(); await closeInspector();
await shot('s2-02-ria-discovered', 'RIA store discovered as a remote, still collapsed (its 40 parts not probed)');
await expand('d:ria', 'part');
await fit(38); await closeInspector();
await shot('s2-03-ria-expanded', 'RIA cluster expanded: 40 per-subject repos gridded inside the store, 12 UNMERGED in amber');
await wm(() => window.__wm.saveView('full')); await p.waitForTimeout(700);
await wm(() => window.__wm.setMode('lineage')); await p.waitForTimeout(4000);
await fit(38); await closeInspector();
await shot('s2-04-lineage', 'layered lineage: worktrees and the 40 result branches as a fan into the superdataset');
await wm(() => window.__wm.saveView('full')); await p.waitForTimeout(700);

// ---------------------------------------------------------------- s3
await load('s3-forks');
await closeInspector();
await shot('s3-01-seed', 'seed only: a plain-git clone with no UUID at all');
await expand('d:mine', 'remote');
await fit(); await closeInspector();
await shot('s3-02-upstream', 'upstream discovered through the origin remote');
await expand('d:upstream', 'fork_of');
await fit(38); await closeInspector();
await shot('s3-03-forks-map', '60 forks in the github.com cluster, cluster map view');
await wm(() => window.__wm.setMode('lineage')); await p.waitForTimeout(4000);
await fit(38); await closeInspector();
await shot('s3-04-lineage-greyed', 'layered lineage: 8 active forks nearest upstream, 52 inactive greyed in the fan grid');
await wm(() => window.__wm.setTheme('light')); await p.waitForTimeout(700);
await shot('s3-05-lineage-light', 'same, light theme');
await wm(() => window.__wm.setTheme('dark')); await p.waitForTimeout(400);
await wm(() => window.__wm.setMode('map')); await p.waitForTimeout(2500);
await fit(38);
await wm(() => window.__wm.saveView('full')); await p.waitForTimeout(800);

// s3's template trap is a SEPARATE connected component: no amount of expanding
// from the seed reaches it. Reveal its root explicitly, then expand from there.
await wm(() => window.__wm.revealRoot('d:proj-a'));
await p.waitForTimeout(1500);
await closeInspector();
await shot('s3-07-other-component', 'the second connected component, revealed explicitly - expansion from the seed can never reach it');
await expand('d:proj-a', 'candidate_same_as');
await expand('d:proj-a', 'shares_history_with');
await expand('d:proj-b', 'shares_history_with');
await expand('d:proj-a-clone', 'candidate_same_as');
await fit(38); await closeInspector();
await shot('s3-08-template-trap', 'project-alpha vs project-beta: candidate_same_as rejected at containment 0.19');
await wm(() => window.__wm.saveView('full')); await p.waitForTimeout(800);

// zoom onto the identity-ambiguous finding by clicking it in the sidebar
await wm(() => {
  const els = [...document.querySelectorAll('#findings .finding')];
  const el = els.find((e) => e.textContent.includes('containment')) || els[els.length - 1];
  el.click();
});
await p.waitForTimeout(1400);
await closeInspector();
await p.waitForTimeout(400);
await shot('s3-09-template-trap-zoom', 'zoomed: shares_history_with to con/python-template (cont 0.19) and the rejected candidate_same_as between alpha and beta');

console.log('console errors:', errs.slice(0, 10));
LOG.push({ consoleErrors: errs });
writeFileSync('/tmp/claude-0/-home-user-ceptualization/f273cf9e-aebb-546e-8481-55bd4553c021/scratchpad/team-b/measurements.json', JSON.stringify(LOG, null, 2));
await b.close();
console.log('done');
