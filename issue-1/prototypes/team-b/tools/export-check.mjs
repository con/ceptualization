// Fetch the self-contained export from the server, write it to exports/, then
// open it from file:// in a browser with no server reachable and screenshot it.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { writeFileSync, mkdirSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
mkdirSync(resolve(ROOT, 'exports'), { recursive: true });
mkdirSync(resolve(ROOT, 'screenshots'), { recursive: true });
const B = 'http://127.0.0.1:8391';

const targets = [
  ['s1-spacetop', 'step2'],
  ['s2-babs-ria', 'full'],
  ['s3-forks', 'full'],
];
const files = [];
for (const [scen, name] of targets) {
  const r = await fetch(`${B}/export/${scen}?name=${name}`);
  if (!r.ok) { console.log('SKIP', scen, r.status, (await r.text()).slice(0, 200)); continue; }
  const html = await r.text();
  const out = resolve(ROOT, 'exports', `worldmap-${scen}.html`);
  writeFileSync(out, html);
  console.log(`wrote ${out}  ${(statSync(out).size / 1024).toFixed(1)} kB`);
  files.push([scen, out]);
}

const b = await chromium.launch();
for (const [scen, file] of files) {
  const p = await b.newPage({ viewport: { width: 1500, height: 940 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  // Prove it is offline: block every network request that is not the file itself.
  await p.route('**/*', (route) => (route.request().url().startsWith('file://') ? route.continue() : route.abort()));
  await p.goto('file://' + file, { waitUntil: 'load' });
  await p.waitForFunction(() => window.__wm && window.__wm.cy.nodes().length > 0, { timeout: 15000 });
  await p.waitForTimeout(900);
  const info = await p.evaluate(() => ({ n: window.__wm.cy.nodes().length, e: window.__wm.cy.edges().length }));
  await p.screenshot({ path: resolve(ROOT, 'screenshots', `export-${scen}-file-url.png`) });
  // prove interactivity: click a node, the inspector must appear
  await p.evaluate(() => { const n = window.__wm.cy.nodes('.dist')[0]; n.emit('tap'); });
  await p.waitForTimeout(400);
  const hasInspector = await p.evaluate(() => !!document.querySelector('#overlay .inspector'));
  // toggle theme, screenshot light
  await p.click('#th'); await p.waitForTimeout(500);
  await p.screenshot({ path: resolve(ROOT, 'screenshots', `export-${scen}-file-url-light.png`) });
  console.log(`${scen}: file:// nodes=${info.n} edges=${info.e} inspectorOnClick=${hasInspector} errors=${JSON.stringify(errs.slice(0, 3))}`);
  await p.close();
}
await b.close();
