// Playwright driver: every PNG in screenshots/ is produced here, by driving the
// running app. Nothing is mocked and nothing is drawn by hand.
//
//   node tools/drive.mjs        (server must already be running)

import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = resolve(ROOT, 'screenshots');
mkdirSync(SHOTS, { recursive: true });
const B = process.env.WM_BASE || 'http://127.0.0.1:8861';
const LOG = [];

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1680, height: 1000 }, deviceScaleFactor: 1 });
const errs = [];
p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
p.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message));

const t0boot = Date.now();
await p.goto(B, { waitUntil: 'networkidle' });
await p.waitForFunction(() => window.__wm && window.__wm.cy && window.__wm.cy.nodes().length > 0,
  { timeout: 30000 });
LOG.push({ boot: 'cold load to first painted seed', wallMs: Date.now() - t0boot });

const shot = async (name, note) => {
  await p.waitForTimeout(450);
  await p.screenshot({ path: `${SHOTS}/${name}.png` });
  const info = await p.evaluate(() => ({
    n: window.__wm.cy.nodes().length, e: window.__wm.cy.edges().length,
    zoom: +window.__wm.cy.zoom().toFixed(3),
    labels: window.__wm.measureRendered().edges.map((x) => x.renderedPx),
  }));
  LOG.push({ shot: name, note, ...info });
  console.log(`[shot] ${name}  nodes=${info.n} edges=${info.e} zoom=${info.zoom} labelPx=${JSON.stringify(info.labels)}`);
};
const load = async (s) => {
  await p.evaluate((x) => window.__wm.loadScenario(x), s);
  await p.waitForFunction((x) => window.__wm.S.scenario === x && !window.__wm.S.busy, s, { timeout: 20000 });
  await p.waitForTimeout(300);
};
const expand = (id, rel) => p.evaluate(([i, r]) => window.__wm.doExpand(i, r, { nodelay: true }), [id, rel]);
const fit = async () => { await p.evaluate(() => window.__wm.fitAll()); await p.waitForTimeout(250); };
const reading = async () => { await p.evaluate(() => window.__wm.focusFit()); await p.waitForTimeout(250); };
const theme = async (t) => { await p.evaluate((x) => window.__wm.setTheme(x), t); await p.waitForTimeout(500); };
const clearSel = () => p.evaluate(() => {
  const i = document.querySelector('.inspector'); if (i) i.remove();
  window.__wm.S.selected = null;
  window.__wm.applyLabelPolicy({ mode: 'demand' });
  window.__wm.compensateZoom();
});

// ------------------------------------------------------------------- s1
await load('s1-spacetop');
await shot('s1-01-seed-dark', 'seed only: one clone on lena. "8 nodes not reachable from here" is on screen from the first frame.');
await expand('d:lena', 'remote:out');
await fit();
await clearSel();
await shot('s1-02-mid-expansion', 'one probe of lena remotes: 8 host boxes placed by tier 1, clones placed by tier 2 inside them');
await expand('d:typhon', 'remote:out');
await expand('d:rolando', 'remote:in');
await expand('d:smaug', 'remote:out');
await expand('d:discovery', 'same_annex_uuid:out');
await fit();
await clearSel();
await shot('s1-03-expanded', 'five probes in: nothing that was already on screen has moved by more than 0 px');
// the duplicate-UUID error, focused from the findings panel
await p.evaluate(() => {
  const f = [...document.querySelectorAll('#findings .finding')]
    .find((x) => x.textContent.includes('annex UUID'));
  if (f) f.click();
});
await p.waitForTimeout(700);
await shot('s1-04-duplicate-uuid-error', 'error finding clicked: two discovery clones with the same annex UUID, double red border, error edge labelled');
// the remote-name disagreement, WITHOUT opening the inspector
await fit();
await clearSel();
await shot('s1-05-name-disagreement-fitzoom',
  'no inspector, no selection, fit-to-everything zoom: d:rolando-x carries "⇄ rolando-exchange | spacetop-rolando-exchange" on its face');
await reading();
await clearSel();
await shot('s1-06-name-disagreement-reading', 'same thing at reading zoom');
await p.evaluate(() => window.__wm.select('d:rolando-x'));
await p.waitForTimeout(400);
await shot('s1-07-selected-edge-labels', 'selecting the node labels its five incident edges with the per-clone remote name, at a constant 13 rendered px');
await theme('light');
await fit();
await clearSel();
await shot('s1-08-light-theme', 'same map, light theme');
await theme('dark');

// ------------------------------------------------------------------- s2
await load('s2-babs-ria');
await shot('s2-01-seed-dark', 'seed: the superdataset on discovery');
await expand('d:super', 'subdataset:out');
await expand('d:super', 'worktree_of:in');
await expand('d:super', 'remote:out');
await fit();
await clearSel();
await shot('s2-02-ria-discovered', 'the RIA store is on the map but has not been walked: one node, not forty');
await expand('d:ria', 'part:out');
await fit();
await clearSel();
await shot('s2-03-ria-expanded',
  '40 per-subject repos arrive at once. The RIA box grew from a fixed corner: every other container and every leaf moved 0.00 px.');
await p.evaluate(() => window.__wm.toggleCollapse('d:ria'));
await p.waitForTimeout(700);
await fit();
await clearSel();
await shot('s2-04-ria-collapsed-edges-aggregated',
  'collapsed: 40 nodes and 40 `part` edges fold into one box and one bundled edge with a count — the edge total FALLS');
await p.evaluate(() => window.__wm.collapseAll(true));
await p.waitForTimeout(700);
await fit();
await clearSel();
await shot('s2-05-all-collapsed', 'every container collapsed: 50 nodes -> 3, 86 edges -> 3');
await p.evaluate(() => window.__wm.collapseAll(false));
await p.waitForTimeout(700);
await theme('light');
await fit();
await clearSel();
await shot('s2-06-light-theme', 'expanded again, light theme: the 40 repos are back in exactly the slots they left');
await theme('dark');

// ------------------------------------------------------------------- s3
await load('s3-forks');
await shot('s3-01-seed-dark', 'seed: my clone of con/duct. "6 nodes not reachable from here" is already true and already shown.');
await expand('d:mine', 'remote:out');
await expand('d:upstream', 'fork_of:in');
await fit();
await clearSel();
await shot('s3-02-forks-greyed', '60 forks; 52 with nothing new are greyed out; the fork edges are aggregated');
await p.evaluate(() => { document.getElementById('grey').checked = false; document.getElementById('grey').dispatchEvent(new Event('change')); });
await p.waitForTimeout(400);
await shot('s3-03-forks-not-greyed', 'the same map with greying off, for comparison');
await p.evaluate(() => { document.getElementById('grey').checked = true; document.getElementById('grey').dispatchEvent(new Event('change')); });
await p.waitForTimeout(300);
// the unreachable component affordance
await p.evaluate(() => { document.querySelector('.side').scrollTop = 0; });
await shot('s3-04-unreachable-affordance',
  'the reach panel: 6 nodes cannot be reached by probing from here, and the second component root is offered with a reveal button');
await p.evaluate(() => {
  const btn = document.querySelector('#reach button[data-root]');
  if (btn) btn.click();
});
await p.waitForTimeout(1200);
await fit();
await clearSel();
await shot('s3-05-second-component-revealed', 'the template-sibling component, unreachable by expansion, revealed from its root');
await expand('d:proj-a', 'shares_history_with:out');
await expand('d:tpl', 'shares_history_with:in');
await expand('d:proj-a', 'candidate_same_as:out');
await fit();
await clearSel();
await shot('s3-06-template-trap', 'the identity-ambiguous finding: candidate_same_as, verdict rejected, containment 0.19, drawn and labelled by default');
await p.evaluate(() => window.__wm.select('d:proj-a'));
await p.waitForTimeout(400);
await shot('s3-07-template-trap-selected', 'the same, with project-alpha selected: every incident relation labelled');
await theme('light');
await fit();
await clearSel();
await shot('s3-08-light-theme', 'light theme');
await theme('dark');

// ------------------------------------------------- save the views used for export
for (const [scen, seq, name] of [
  ['s1-spacetop', [['d:lena', 'remote:out'], ['d:typhon', 'remote:out'], ['d:rolando', 'remote:in'],
    ['d:smaug', 'remote:out'], ['d:discovery', 'same_annex_uuid:out'], ['h:github', 'contains:out']], 'default'],
  ['s2-babs-ria', [['d:super', 'subdataset:out'], ['d:super', 'worktree_of:in'],
    ['d:super', 'remote:out'], ['d:ria', 'part:out']], 'default'],
  ['s3-forks', [['d:mine', 'remote:out'], ['d:upstream', 'fork_of:in'], ['h:lena', 'contains:out'],
    ['d:proj-a-clone', 'remote:out'], ['d:proj-a', 'shares_history_with:out'],
    ['d:tpl', 'shares_history_with:in'], ['d:proj-a', 'candidate_same_as:out']], 'default'],
]) {
  await load(scen);
  for (const [id, rel] of seq) await expand(id, rel);
  await fit();
  await clearSel();
  const r = await p.evaluate((n) => window.__wm.saveView(n), name);
  console.log(`[view] ${scen}/${name}`, JSON.stringify(r));
}

writeFileSync(resolve(ROOT, 'tools', 'last-drive.json'),
  JSON.stringify({ log: LOG, errors: errs }, null, 2) + '\n');
console.log('\nconsole errors:', errs.length, errs.slice(0, 6));
await b.close();
