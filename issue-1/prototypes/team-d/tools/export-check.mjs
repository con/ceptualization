// Fetch the self-contained export from the server, write it to exports/, then
// open it from file:// in a browser with EVERY non-file request blocked, and
// prove it still renders and still interacts.
//
// Adapted from team-b/tools/export-check.mjs (same repo, same licence).

import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { writeFileSync, mkdirSync, statSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
mkdirSync(resolve(ROOT, 'exports'), { recursive: true });
mkdirSync(resolve(ROOT, 'screenshots'), { recursive: true });
const B = process.env.WM_BASE || 'http://127.0.0.1:8861';
const REPORT = [];

const files = [];
for (const scen of ['s1-spacetop', 's2-babs-ria', 's3-forks']) {
  const r = await fetch(`${B}/export/${scen}?name=default`);
  if (!r.ok) { console.log('SKIP', scen, r.status, (await r.text()).slice(0, 200)); continue; }
  const html = await r.text();
  const out = resolve(ROOT, 'exports', `worldmap-${scen}.html`);
  writeFileSync(out, html);
  // count external references the way a reviewer would
  const ext = (html.match(/(src|href)\s*=\s*["'](?!#)(?!data:)[^"']+/gi) || [])
    .filter((m) => !/["'](data:|#)/.test(m));
  const kB = +(statSync(out).size / 1024).toFixed(1);
  console.log(`wrote ${out}  ${kB} kB  externalRefs=${ext.length} ${JSON.stringify(ext.slice(0, 3))}`);
  files.push([scen, out, kB, ext.length]);
}

const b = await chromium.launch();
for (const [scen, file, kB, ext] of files) {
  const p = await b.newPage({ viewport: { width: 1600, height: 980 } });
  const errs = [];
  const blocked = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.route('**/*', (route) => {
    const u = route.request().url();
    if (u.startsWith('file://')) return route.continue();
    blocked.push(u);
    return route.abort();
  });
  await p.goto('file://' + file, { waitUntil: 'load' });
  await p.waitForFunction(() => window.__wm && window.__wm.cy && window.__wm.cy.nodes().length > 0,
    { timeout: 20000 });
  await p.waitForTimeout(900);
  const info = await p.evaluate(() => ({
    n: window.__wm.cy.nodes().length, e: window.__wm.cy.edges().length,
    zoom: +window.__wm.cy.zoom().toFixed(3),
    labels: window.__wm.measureRendered().edges.map((x) => x.renderedPx),
  }));
  await p.screenshot({ path: resolve(ROOT, 'screenshots', `export-${scen}-file-url.png`) });
  // prove it is interactive, not a picture: click a node, expect an inspector
  await p.evaluate(() => { const n = window.__wm.cy.nodes('.dist')[0]; n.emit('tap'); });
  await p.waitForTimeout(400);
  const hasInspector = await p.evaluate(() => !!document.querySelector('.inspector'));
  await p.click('#th'); await p.waitForTimeout(600);
  await p.screenshot({ path: resolve(ROOT, 'screenshots', `export-${scen}-file-url-light.png`) });
  const rec = { scen, kB, externalRefs: ext, ...info, hasInspector, blockedRequests: blocked.length, errors: errs.slice(0, 3) };
  REPORT.push(rec);
  console.log(JSON.stringify(rec));
  await p.close();
}
await b.close();
writeFileSync(resolve(ROOT, 'tools', 'last-export-check.json'), JSON.stringify(REPORT, null, 2) + '\n');
