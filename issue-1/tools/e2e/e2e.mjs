/**
 * End-to-end test: real repositories -> crawl -> viewer -> scripted walk.
 *
 * Every check is an INVARIANT, not a golden number, so the test survives the
 * fixture changing. It exists because three separate defects (hide orphaning
 * children, collapse leaving repositories drawn, "expand all" doing nothing)
 * were all found by a human clicking, not by a test.
 *
 *   node e2e.mjs [--fixture DIR] [--port N] [--keep]
 *
 * Exits non-zero on the first failed invariant.
 */
import { chromium } from 'playwright';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TEAM_D = path.resolve(HERE, '../../prototypes/team-d');
const CRAWLER = path.resolve(HERE, '../worldmap-crawl.py');
const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const FIXTURE = arg('--fixture', '/tmp/worldmap-e2e-fixture');
const PORT = +arg('--port', 8899);
const KEEP = process.argv.includes('--keep');
// Conformance mode: point at a worldmap directory that already exists and run
// only the viewer invariants.  The same walk has to hold for ANY map, which is
// how the pre-generated scenarios (s1/s2/s3) get regression-tested without
// needing eight real repositories on disk.
const WORLDMAP = arg('--worldmap', null);
const SCENARIO = arg('--scenario', 'e2e');
const VIEWER_ONLY = !!WORLDMAP;

let failures = 0; let checks = 0;
const ok = (name, cond, detail = '') => {
  checks++;
  if (cond) { console.log(`  PASS  ${name}${detail ? ' — ' + detail : ''}`); }
  else { failures++; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};

// ---------------------------------------------------------------- fixture
let OUT;
if (VIEWER_ONLY) {
  OUT = path.resolve(WORLDMAP);
  if (!existsSync(path.join(OUT, SCENARIO, 'worldmap.json'))) {
    console.log(`no ${SCENARIO}/worldmap.json under ${OUT}`);
    process.exit(2);
  }
  console.log(`conformance run against ${OUT}/${SCENARIO} (no crawl)`);
} else {
  if (!existsSync(FIXTURE)) {
    console.log(`fixture missing at ${FIXTURE}; run setup-fixture.sh first`);
    process.exit(2);
  }
  OUT = mkdtempSync(path.join(tmpdir(), 'worldmap-e2e-'));
  const repos = ['super', 'clone-a', 'clone-b', 'wt-x', 'wt-y', 'independent-sub',
                 'sub-origin', 'origin-super'].map((r) => path.join(FIXTURE, r))
    .filter((p) => existsSync(p));

  console.log(`crawling ${repos.length} repositories -> ${OUT}/e2e`);
  const crawl = spawnSync('python3', [CRAWLER, ...repos, '--depth', '2', '-o', path.join(OUT, 'e2e')],
                          { encoding: 'utf8' });
  if (crawl.status !== 0) { console.log(crawl.stderr || crawl.stdout); process.exit(2); }
  console.log('  ' + (crawl.stdout || '').trim().split('\n').pop());
}

// ---------------------------------------------------------------- server
const server = spawn('python3', [path.join(TEAM_D, 'server/app.py')], {
  cwd: TEAM_D, env: { ...process.env, WORLDMAP_DIR: OUT, PORT: String(PORT) },
  stdio: 'ignore',
});
const stop = () => { try { server.kill('SIGKILL'); } catch (e) { /* already gone */ } };
process.on('exit', stop);
await new Promise((r) => setTimeout(r, 2500));

// ---------------------------------------------------------------- drive
const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));

const state = () => page.evaluate(() => {
  const cy = window.__cy, S = window.__S;
  const drawn = cy.nodes().map((n) => n.id());
  const drawnSet = new Set(drawn);
  return {
    nodes: drawn.length,
    edges: cy.edges().length,
    visible: S.visible.size,
    hidden: S.hidden.size,
    collapsed: S.collapsed.size,
    // a drawn node whose parent is ALSO drawn is fine; a drawn node whose
    // parent is collapsed or hidden must not be on screen at all
    strays: drawn.filter((id) => {
      const par = (S.byId[id] || {}).parent;
      if (!par) return false;
      return S.collapsed.has(par) || S.hidden.has(par) || !drawnSet.has(par);
    }),
    positions: Object.fromEntries(cy.nodes().map((n) => [n.id(), [n.position().x, n.position().y]])),
  };
});
const settle = (ms = 1400) => page.waitForTimeout(ms);
const drift = (a, b) => {
  let w = 0;
  for (const k of Object.keys(a)) if (b[k]) w = Math.max(w, Math.hypot(a[k][0] - b[k][0], a[k][1] - b[k][1]));
  return w;
};

console.log('\ndriving the viewer');
await page.goto(`http://127.0.0.1:${PORT}/?scenario=${SCENARIO}`, { waitUntil: 'networkidle' });
await settle(1200);

// 1 -- opens on the seeds, not the whole crawl.  Every crawled repository is
// a seed, so the number is fixture-dependent; what must hold is that the
// opening view is exactly {seeds} plus the containers holding them.
let s = await state();
const seedShape = await page.evaluate(() => {
  const cy = window.__cy, S = window.__S;
  const drawn = cy.nodes().map((n) => n.id());
  const isSeed = (id) => !!(S.byId[id] || {}).is_seed;
  const holdsSeed = (id) => drawn.some((d) => (S.byId[d] || {}).parent === id && (isSeed(d) || holdsSeed(d)));
  return {
    seeds: drawn.filter(isSeed).length,
    total: drawn.length,
    unexplained: drawn.filter((id) => !isSeed(id) && !holdsSeed(id)),
  };
});
ok('opens on the seeds and their containers only',
   seedShape.seeds > 0 && seedShape.unexplained.length === 0,
   `${seedShape.seeds} seeds + ${seedShape.total - seedShape.seeds} containers` +
   (seedShape.unexplained.length ? `; unexplained: ${seedShape.unexplained.join(', ')}` : ''));

// 2 -- reveal all
await page.locator('#reveal-all').click(); await settle(3000);
const full = await state();
ok('reveal all shows the whole crawl', full.nodes >= s.nodes, `${full.nodes} nodes, ${full.edges} edges`);
ok('the opening view was a strict subset of the full crawl', s.nodes < full.nodes,
   `${s.nodes} -> ${full.nodes}`);
ok('nothing is stray after reveal', full.strays.length === 0, `${full.strays.length} strays`);

// 3 -- the fixture's own shape survived the crawl.  Skipped in conformance
// mode: an arbitrary map has no submodule or github remote to assert about.
if (!VIEWER_ONLY) {
const shape = await page.evaluate(() => {
  const S = window.__S; const vals = [...S.visible].map((i) => S.byId[i]);
  const lbl = (re) => vals.filter((n) => re.test(n.label || '')).length;
  return {
    worktrees: vals.filter((n) => n.layout === 'linked-worktree').length,
    worktreeEdges: S.edges.filter((e) => e.kind === 'worktree_of').length,
    submodEdges: S.edges.filter((e) => e.kind === 'subdataset').length,
    github: lbl(/github\.com/),
    tracked: S.edges.filter((e) => e.tracking === 'current').length,
    untracked: S.edges.filter((e) => e.tracking === 'none').length,
    datasetIds: new Set(vals.map((n) => n.dataset_id).filter(Boolean)).size,
  };
});
ok('worktrees are one arrow each, not N²', shape.worktreeEdges === shape.worktrees,
   `${shape.worktrees} worktrees, ${shape.worktreeEdges} worktree_of edges`);
ok('the submodule is an edge', shape.submodEdges >= 1, `${shape.submodEdges} subdataset edges`);
ok('the github remote is on the map', shape.github >= 1, `${shape.github} github node(s)`);
ok('remotes split into tracked and untracked', shape.tracked > 0 && shape.untracked > 0,
   `${shape.tracked} current-tracked, ${shape.untracked} untracked`);
ok('both copies of the subdataset are present', shape.datasetIds >= 2,
   `${shape.datasetIds} distinct dataset ids`);
}

// 4 -- collapse all / uncollapse all
const beforeCollapse = await state();
await page.locator('#collapse-all').click(); await settle(2200);
const collapsed = await state();
ok('collapse all removes contained repositories', collapsed.nodes < beforeCollapse.nodes,
   `${beforeCollapse.nodes} -> ${collapsed.nodes}`);
ok('collapse all leaves no stray child drawn', collapsed.strays.length === 0,
   collapsed.strays.length ? collapsed.strays.slice(0, 3).join(', ') : 'none');
// The user-visible complaint was never "strays" -- it was "collapse all still
// leaves individual repositories on screen".  So assert the label directly:
// after collapse all, every drawn box must BE a container.
const leftovers = await page.evaluate(() => {
  const cy = window.__cy, S = window.__S;
  const kids = new Set([...S.visible].map((i) => (S.byId[i] || {}).parent).filter(Boolean));
  return cy.nodes().map((n) => n.id()).filter((id) => !kids.has(id));
});
ok('collapse all leaves only containers drawn', leftovers.length === 0,
   leftovers.length ? `${leftovers.length} bare: ` + leftovers.slice(0, 4).join(', ') : 'none');
await page.locator('#expand-all').click(); await settle(2200);
const unc = await state();
ok('uncollapse all restores the node count', unc.nodes === beforeCollapse.nodes,
   `${unc.nodes} vs ${beforeCollapse.nodes}`);
ok('uncollapse all restores positions', drift(beforeCollapse.positions, unc.positions) < 1,
   `${drift(beforeCollapse.positions, unc.positions).toFixed(2)} px`);

// 5 -- hide / show
const pick = await page.evaluate(() => {
  const cy = window.__cy, S = window.__S;
  const n = cy.nodes().filter((x) => (S.byId[x.id()] || {}).parent).first();
  if (!n.length) return null; n.emit('tap'); return n.id();
});
await settle(700);
const beforeHide = await state();
await page.locator('.inspector button[data-hide]').click(); await settle(1800);
const hidden = await state();
ok('hide removes the node', hidden.nodes < beforeHide.nodes, `${beforeHide.nodes} -> ${hidden.nodes}`);
ok('hide orphans nothing', hidden.strays.length === 0, `${hidden.strays.length} strays`);
const showBtn = page.locator('.inspector button[data-show]');
ok('the hide button became a show button', await showBtn.count() === 1);
await showBtn.click(); await settle(1800);
ok('show restores the node count', (await state()).nodes === beforeHide.nodes);

// 6 -- undo / redo across the walk
await page.locator('#undo').click(); await settle(1400);
const undone = await state();
ok('undo steps back', undone.nodes !== beforeHide.nodes || undone.hidden > 0);
await page.locator('#redo').click(); await settle(1400);
ok('redo returns', (await state()).nodes === beforeHide.nodes);

// 7 -- bundling conserves edges
const preBundle = await state();
await page.locator('#bundle').click(); await settle(1800);
const bundled = await state();
ok('bundling does not move nodes', drift(preBundle.positions, bundled.positions) < 1,
   `${drift(preBundle.positions, bundled.positions).toFixed(2)} px`);
await page.locator('#bundle').click(); await settle(1800);
ok('unbundling restores the edge count', (await state()).edges === preBundle.edges,
   `${(await state()).edges} vs ${preBundle.edges}`);

// 8 -- drag stays inside, and undo puts it back
const dragged = await page.evaluate(() => {
  const cy = window.__cy, S = window.__S;
  const leaf = cy.nodes().filter((n) => (S.byId[n.id()] || {}).parent && n.data('w') < 260).first();
  if (!leaf.length) return null;
  const rp = leaf.renderedPosition();
  return { id: leaf.id(), par: S.byId[leaf.id()].parent, x: rp.x, y: rp.y };
});
if (dragged) {
  const pre = await state();
  await page.mouse.move(dragged.x, dragged.y); await page.mouse.down();
  await page.mouse.move(dragged.x + 600, dragged.y + 380, { steps: 10 }); await page.mouse.up();
  await settle(1600);
  const inside = await page.evaluate((o) => {
    const cy = window.__cy; const nb = cy.getElementById(o.id).boundingBox();
    const cb = cy.getElementById(o.par).boundingBox();
    return nb.x1 >= cb.x1 - 0.5 && nb.x2 <= cb.x2 + 0.5 && nb.y1 >= cb.y1 - 0.5 && nb.y2 <= cb.y2 + 0.5;
  }, dragged);
  ok('a dragged repository stays inside its container', inside);
  await page.locator('#undo').click(); await settle(1500);
  ok('undo of a move restores every position', drift(pre.positions, (await state()).positions) < 1,
     `${drift(pre.positions, (await state()).positions).toFixed(2)} px`);
} else {
  ok('a dragged repository stays inside its container', false, 'no draggable leaf found');
}

// 9 -- clean console throughout
ok('no console errors during the whole walk', consoleErrors.length === 0,
   consoleErrors.slice(0, 2).join(' | '));

const SHOTS = VIEWER_ONLY ? mkdtempSync(path.join(tmpdir(), 'worldmap-e2e-')) : OUT;
await page.screenshot({ path: path.join(SHOTS, `e2e-${SCENARIO}.png`) });
await browser.close();
stop();

console.log(`\n${checks - failures}/${checks} checks passed`);
if (!KEEP) console.log(`artifacts: ${SHOTS}`);
process.exit(failures ? 1 : 0);
