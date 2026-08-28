/**
 * End-to-end test: real repositories -> crawl -> viewer -> scripted walk.
 *
 * Every check is an INVARIANT, not a golden number, so the test survives the
 * fixture changing. It exists because three separate defects (hide orphaning
 * children, collapse leaving repositories drawn, "expand all" doing nothing)
 * were all found by a human clicking, not by a test.
 *
 *   node e2e.mjs [--fixture DIR] [--port N|auto] [--keep]
 *   node e2e.mjs --worldmap DIR --scenario NAME        # conformance mode
 *
 * Reliability posture, learned the hard way:
 *   - the server gets a FREE port by default and is polled until it answers;
 *     a fixed port can collide with a zombie from an earlier run, which does
 *     not fail loudly -- it serves STALE data (this invalidated three runs
 *     once, as a silent scenario fallback);
 *   - the served scenario list must name the requested scenario, and the page
 *     must agree it loaded it -- the fallback trap is a named FAIL forever;
 *   - waits are quiescence (two identical position samples) with a floor and
 *     a ceiling, not guessed sleeps;
 *   - the walk runs under try/finally: an unexpected throw is a FAIL with a
 *     summary, the browser and server are always closed, and temp dirs are
 *     removed on success and kept on failure (or with --keep).
 *
 * Exits 1 on any failed invariant, 2 on a setup problem.
 */
import { chromium } from 'playwright';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TEAM_D = path.resolve(HERE, '../../prototypes/team-d');
const CRAWLER = path.resolve(HERE, '../worldmap-crawl.py');

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const FIXTURE = arg('--fixture', '/tmp/worldmap-e2e-fixture');
const PORT_ARG = arg('--port', 'auto');
const KEEP = process.argv.includes('--keep');
const NO_BUILD = process.argv.includes('--no-build');
// Conformance mode: point at a worldmap directory that already exists and run
// only the viewer invariants.  The same walk has to hold for ANY map, which is
// how the pre-generated scenarios (s1/s2/s3) get regression-tested without
// needing eight real repositories on disk.
const WORLDMAP = arg('--worldmap', null);
const SCENARIO = arg('--scenario', 'e2e');
const VIEWER_ONLY = !!WORLDMAP;

const t0 = Date.now();
const secs = (since) => ((Date.now() - since) / 1000).toFixed(1) + 's';
let failures = 0; let checks = 0; const failed = [];
const ok = (name, cond, detail = '') => {
  checks++;
  if (cond) { console.log(`  PASS  ${name}${detail ? ' — ' + detail : ''}`); }
  else { failures++; failed.push(name); console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};

/** Chrome: explicit override, then the sandbox's stable symlink, then let
 *  playwright resolve its own managed browser (laptop / CI). */
function chromePath() {
  for (const c of [process.env.CHROME_PATH, '/opt/pw-browsers/chromium']) {
    if (c && existsSync(c)) return c;
  }
  return null;
}
const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
  s.on('error', reject);
});

// ---------------------------------------------------------------- fixture
const CREATED = [];                    // temp dirs this run made and may remove
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
  CREATED.push(OUT);
  // Discover the repositories rather than repeating setup-fixture.sh's layout
  // here: a fixture that grows is crawled in full, not silently subsetted.
  // (.git is a directory in a main worktree and a FILE in a linked one.)
  const repos = readdirSync(FIXTURE, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => path.join(FIXTURE, d.name))
    .filter((p) => existsSync(path.join(p, '.git')))
    .sort();
  if (!repos.length) { console.log(`no repositories under ${FIXTURE}`); process.exit(2); }

  console.log(`crawling ${repos.length} repositories -> ${OUT}/e2e`);
  const tCrawl = Date.now();
  const crawl = spawnSync('python3', [CRAWLER, ...repos, '--depth', '2', '-o', path.join(OUT, 'e2e')],
                          { encoding: 'utf8' });
  if (crawl.status !== 0) { console.log(crawl.stderr || crawl.stdout); process.exit(2); }
  console.log(`  ${(crawl.stdout || '').trim().split('\n').pop()}  (${secs(tCrawl)})`);
}

// ---------------------------------------------------------------- build
// The server serves web/dist, a Vite BUILD -- not web/src. A suite that walks
// a stale build passes against code nobody is shipping: this exact gap let a
// mutation drill run green against sabotaged source, and let one committed
// fix be "verified" by a build that predated it. So: if anything under
// web/src (or the entry points) is newer than dist, rebuild before serving.
// --no-build skips this for a quick re-run when dist is known good.
function newestUnder(p) {
  let t = 0;
  for (const d of readdirSync(p, { withFileTypes: true })) {
    const f = path.join(p, d.name);
    t = Math.max(t, d.isDirectory() ? newestUnder(f) : statSync(f).mtimeMs);
  }
  return t;
}
if (!NO_BUILD) {
  const WEB = path.join(TEAM_D, 'web');
  const built = existsSync(path.join(WEB, 'dist/index.html'))
    ? statSync(path.join(WEB, 'dist/index.html')).mtimeMs : 0;
  const srcT = Math.max(newestUnder(path.join(WEB, 'src')),
    ...['index.html', 'vite.config.js', 'package.json']
      .filter((f) => existsSync(path.join(WEB, f)))
      .map((f) => statSync(path.join(WEB, f)).mtimeMs));
  if (srcT > built) {
    console.log(built ? 'web/dist is older than web/src — rebuilding' : 'web/dist missing — building');
    const tBuild = Date.now();
    const b = spawnSync('npm', ['run', 'build'], { cwd: WEB, encoding: 'utf8' });
    if (b.status !== 0) { console.log(b.stderr || b.stdout); process.exit(2); }
    console.log(`  built  (${secs(tBuild)})`);
  }
}

// ---------------------------------------------------------------- server
/** Start app.py on a free port and poll it until it answers AND serves the
 *  requested scenario. Its own output is captured so a dead server reports
 *  its actual error, not a navigation timeout. One retry covers the tiny
 *  window in which the probed free port could be stolen. */
async function startServer() {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const port = PORT_ARG === 'auto' ? await freePort() : +PORT_ARG;
    const log = [];
    const proc = spawn('python3', [path.join(TEAM_D, 'server/app.py')], {
      cwd: TEAM_D, env: { ...process.env, WORLDMAP_DIR: OUT, PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    proc.stdout.on('data', (c) => log.push(c));
    proc.stderr.on('data', (c) => log.push(c));
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline && proc.exitCode === null) {
      try {
        const r = await fetch(`http://127.0.0.1:${port}/api/scenarios`);
        if (r.ok) {
          const body = await r.json();
          const names = (Array.isArray(body) ? body : body.scenarios || [])
            .map((x) => (typeof x === 'string' ? x : x.id || x.name));
          if (!names.includes(SCENARIO)) {
            console.log(`server is up on :${port} but serves ${JSON.stringify(names)}, not "${SCENARIO}"`);
            console.log(`(WORLDMAP_DIR=${OUT} — this is the silent-fallback trap, refusing to continue)`);
            proc.kill('SIGKILL');
            process.exit(2);
          }
          return { proc, port };
        }
      } catch { /* not up yet */ }
      await new Promise((r) => setTimeout(r, 120));
    }
    proc.kill('SIGKILL');
    console.log(`server did not answer on :${port} (attempt ${attempt}/2)`);
    const said = Buffer.concat(log).toString().trim();
    if (said) console.log(said.split('\n').map((l) => '  | ' + l).join('\n'));
    if (PORT_ARG !== 'auto') process.exit(2);       // an explicit port is not renegotiable
  }
  process.exit(2);
}
const { proc: server, port: PORT } = await startServer();
const stopServer = () => { try { server.kill('SIGKILL'); } catch { /* already gone */ } };
process.on('exit', stopServer);

// ---------------------------------------------------------------- drive
const exe = chromePath();
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
page.setDefaultTimeout(10000);
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
/** Quiescence, not sleep: after a floor (covering fetches the page may still
 *  be making), poll until two consecutive samples of every node position and
 *  the edge count are identical, with a hard ceiling. Replaces ~25s of
 *  guessed sleeps per run with waits that end when the app does. */
const settle = async (floorMs = 400) => {
  await page.waitForTimeout(floorMs);
  let prev = null;
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const sig = await page.evaluate(() => {
      const cy = window.__cy; if (!cy) return 'booting';
      return cy.nodes().map((n) => `${n.id()}:${n.position().x.toFixed(1)},${n.position().y.toFixed(1)}`)
               .sort().join('|') + '#' + cy.edges().length;
    });
    if (sig !== 'booting' && sig === prev) return;
    prev = sig;
    await page.waitForTimeout(180);
  }
};
const drift = (a, b) => {
  let w = 0;
  for (const k of Object.keys(a)) if (b[k]) w = Math.max(w, Math.hypot(a[k][0] - b[k][0], a[k][1] - b[k][1]));
  return w;
};

console.log(`\ndriving the viewer on :${PORT}`);
const tWalk = Date.now();
try {
  await page.goto(`http://127.0.0.1:${PORT}/?scenario=${SCENARIO}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__cy && window.__S && window.__cy.nodes().length > 0,
                             null, { timeout: 20000 });
  await settle(600);

  // 0 -- the page loaded the scenario that was asked for. The one historical
  // way this suite produced WRONG results was passing while silently testing
  // a different map.
  const onScreen = await page.evaluate(() => window.__S.scenario);
  ok('the page loaded the requested scenario', onScreen === SCENARIO, `"${onScreen}"`);

  // 1 -- opens on the seeds, not the whole crawl.  Every crawled repository is
  // a seed, so the number is fixture-dependent; what must hold is that the
  // opening view is exactly {seeds} plus the containers holding them.
  const s = await state();
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
  await page.locator('#reveal-all').click(); await settle(900);
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
        // an initialized subdataset is a checkout INSIDE its own super/worktree
        subContained: S.edges.filter((e) => e.kind === 'subdataset' && !e.state)
          .every((e) => (S.byId[e.target] || {}).parent === e.source),
        subInWorktree: S.edges.some((e) => e.kind === 'subdataset' && !e.state
          && (S.byId[e.source] || {}).layout === 'linked-worktree'),
        subPathsNotUrls: S.edges.filter((e) => e.kind === 'subdataset')
          .every((e) => e.path && !e.path.includes('://')),  // a nested path may contain '/'
        // a submodule's absorbed git dir must never surface as a repository
        gitdirNodes: [...S.visible].filter((i) => /\/\.git(\/|$)/.test((S.byId[i] || {}).url || '')).length,
        github: lbl(/github\.com/),
        tracked: S.edges.filter((e) => e.tracking === 'current').length,
        untracked: S.edges.filter((e) => e.tracking === 'none').length,
        datasetIds: new Set(vals.map((n) => n.dataset_id).filter(Boolean)).size,
      };
    });
    ok('worktrees are one arrow each, not N²', shape.worktreeEdges === shape.worktrees,
       `${shape.worktrees} worktrees, ${shape.worktreeEdges} worktree_of edges`);
    ok('the submodule is an edge', shape.submodEdges >= 1, `${shape.submodEdges} subdataset edges`);
    ok('an initialized subdataset sits inside its own super', shape.subContained);
    ok("a worktree's subdataset checkout is inside the worktree box", shape.subInWorktree);
    ok('subdataset edges are labelled by path, not URL', shape.subPathsNotUrls);
    ok('nothing inside .git is drawn as a repository', shape.gitdirNodes === 0,
       `${shape.gitdirNodes} phantom(s)`);
    ok('the github remote is on the map', shape.github >= 1, `${shape.github} github node(s)`);
    ok('remotes split into tracked and untracked', shape.tracked > 0 && shape.untracked > 0,
       `${shape.tracked} current-tracked, ${shape.untracked} untracked`);
    ok('both copies of the subdataset are present', shape.datasetIds >= 2,
       `${shape.datasetIds} distinct dataset ids`);
  }

  // 4 -- collapse all / uncollapse all
  const beforeCollapse = await state();
  await page.locator('#collapse-all').click(); await settle();
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
  await page.locator('#expand-all').click(); await settle();
  const unc = await state();
  ok('uncollapse all restores the node count', unc.nodes === beforeCollapse.nodes,
     `${unc.nodes} vs ${beforeCollapse.nodes}`);
  ok('uncollapse all restores positions', drift(beforeCollapse.positions, unc.positions) < 1,
     `${drift(beforeCollapse.positions, unc.positions).toFixed(2)} px`);

  // 5 -- hide / show
  await page.evaluate(() => {
    const cy = window.__cy, S = window.__S;
    const n = cy.nodes().filter((x) => (S.byId[x.id()] || {}).parent).first();
    if (n.length) n.emit('tap');
  });
  await settle(250);
  const beforeHide = await state();
  await page.locator('.inspector button[data-hide]').click(); await settle();
  const hidden = await state();
  ok('hide removes the node', hidden.nodes < beforeHide.nodes, `${beforeHide.nodes} -> ${hidden.nodes}`);
  ok('hide orphans nothing', hidden.strays.length === 0, `${hidden.strays.length} strays`);
  const showBtn = page.locator('.inspector button[data-show]');
  ok('the hide button became a show button', await showBtn.count() === 1);
  await showBtn.click(); await settle();
  ok('show restores the node count', (await state()).nodes === beforeHide.nodes);

  // 6 -- undo / redo across the walk
  await page.locator('#undo').click(); await settle();
  const undone = await state();
  ok('undo steps back', undone.nodes !== beforeHide.nodes || undone.hidden > 0);
  await page.locator('#redo').click(); await settle();
  ok('redo returns', (await state()).nodes === beforeHide.nodes);

  // 7 -- bundling conserves edges
  const preBundle = await state();
  await page.locator('#bundle').click(); await settle();
  const bundled = await state();
  ok('bundling does not move nodes', drift(preBundle.positions, bundled.positions) < 1,
     `${drift(preBundle.positions, bundled.positions).toFixed(2)} px`);
  await page.locator('#bundle').click(); await settle();
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
    await settle();
    const inside = await page.evaluate((o) => {
      const cy = window.__cy; const nb = cy.getElementById(o.id).boundingBox();
      const cb = cy.getElementById(o.par).boundingBox();
      return nb.x1 >= cb.x1 - 0.5 && nb.x2 <= cb.x2 + 0.5 && nb.y1 >= cb.y1 - 0.5 && nb.y2 <= cb.y2 + 0.5;
    }, dragged);
    ok('a dragged repository stays inside its container', inside);
    await page.locator('#undo').click(); await settle();
    ok('undo of a move restores every position', drift(pre.positions, (await state()).positions) < 1,
       `${drift(pre.positions, (await state()).positions).toFixed(2)} px`);
  } else {
    ok('a dragged repository stays inside its container', false, 'no draggable leaf found');
  }

  // 9 -- clean console throughout
  ok('no console errors during the whole walk', consoleErrors.length === 0,
     consoleErrors.slice(0, 2).join(' | '));
} catch (e) {
  // An unexpected throw is a FAILURE with a report, never a bare stack:
  // the walk stops, but cleanup and the summary still run.
  ok('the walk completed without an unexpected error', false, e.message.split('\n')[0]);
} finally {
  const SHOTS = CREATED[0] || mkdtempSync(path.join(tmpdir(), 'worldmap-e2e-'));
  if (!CREATED.includes(SHOTS)) CREATED.push(SHOTS);
  try { await page.screenshot({ path: path.join(SHOTS, `e2e-${SCENARIO}.png`) }); } catch { /* page gone */ }
  await browser.close();
  stopServer();

  console.log(`\n${checks - failures}/${checks} checks passed  (walk ${secs(tWalk)}, total ${secs(t0)})`);
  if (failed.length) console.log('failed: ' + failed.join(' | '));
  if (KEEP || failures) {
    console.log(`artifacts kept: ${CREATED.join(' ')}`);
  } else {
    for (const d of CREATED) rmSync(d, { recursive: true, force: true });
  }
}
process.exit(failures ? 1 : 0);
