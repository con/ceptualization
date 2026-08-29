// Blank-screenshot detector: the bake-off checked every PNG for distinct
// colour count and dominant-colour share, so we check our own the same way
// before claiming anything about them.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dir = resolve(ROOT, 'screenshots');
const files = readdirSync(dir).filter((f) => f.endsWith('.png')).sort();
const b = await chromium.launch();
const p = await b.newPage();
const out = [];
for (const f of files) {
  const data = readFileSync(resolve(dir, f)).toString('base64');
  const r = await p.evaluate(async (d) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + d;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = Math.min(img.width, 700); c.height = Math.min(img.height, 450);
    const x = c.getContext('2d');
    x.drawImage(img, 0, 0, c.width, c.height);
    const px = x.getImageData(0, 0, c.width, c.height).data;
    const hist = new Map();
    for (let i = 0; i < px.length; i += 4) {
      const k = (px[i] >> 3) + ',' + (px[i + 1] >> 3) + ',' + (px[i + 2] >> 3);
      hist.set(k, (hist.get(k) || 0) + 1);
    }
    const total = px.length / 4;
    const top = Math.max(...hist.values());
    return { w: img.width, h: img.height, distinct: hist.size, dominant: +(top / total).toFixed(3) };
  }, data);
  const suspect = r.distinct < 40 || r.dominant > 0.97;
  out.push({ file: f, ...r, suspect });
  console.log(`${suspect ? 'SUSPECT' : 'ok     '} ${f}  distinct=${r.distinct} dominant=${r.dominant} ${r.w}x${r.h}`);
}
await b.close();
writeFileSync(resolve(ROOT, 'tools', 'last-screenshot-check.json'), JSON.stringify(out, null, 2) + '\n');
console.log(`\n${files.length} screenshots, ${out.filter((x) => x.suspect).length} suspect`);
