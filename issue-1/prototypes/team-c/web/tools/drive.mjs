/**
 * UX driver: launches the real app in Chromium, exercises it, captures the
 * deliverable screenshots and prints measured numbers.
 *
 * Two pages on purpose:
 *   `page`  deviceScaleFactor 2 -> crisp screenshots
 *   `bpage` deviceScaleFactor 1 -> frame-rate measurements
 * because in this headless container WebGL is software-rasterised, so frame
 * time is almost entirely fill-rate: at DPR 2 the same graph costs 4-5x more.
 * Reporting DPR-2 fps would measure SwiftShader, not the renderer.
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.env.BASE || "http://127.0.0.1:8853";
const SHOTS = process.env.SHOTS ||
  "/home/user/ceptualization/issue-1/prototypes/team-c/screenshots";
mkdirSync(SHOTS, { recursive: true });
const CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const log = (...a) => console.log(...a);
const R = {};

const browser = await chromium.launch({ executablePath: CHROME });
const errors = [];
async function open(dpr) {
  const pg = await browser.newPage({ viewport: { width: 1600, height: 950 }, deviceScaleFactor: dpr });
  pg.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  pg.on("pageerror", (e) => errors.push("PAGEERROR " + e.message));
  return pg;
}
const page = await open(2);
const bpage = await open(1);

const ev = (pg, fn, ...a) => pg.evaluate(fn, ...a);
const counts = (pg = page) => ev(pg, () => window.__app.counts());
const wait = (ms, pg = page) => pg.waitForTimeout(ms);
async function shot(name) { await wait(420); await page.screenshot({ path: `${SHOTS}/${name}.png` }); log("  shot", name); }

async function boot(pg) {
  const t0 = Date.now();
  await pg.goto(BASE, { waitUntil: "domcontentloaded" });
  await pg.waitForFunction(() => window.__app && window.__app.ready(), null, { timeout: 30000 });
  return Date.now() - t0;
}
async function load(scenario, pg = page) {
  await ev(pg, (s) => window.__app.actions.loadScenario(s), scenario);
  await wait(600, pg);
}
async function expand(node, rel, pg = page) {
  const t0 = Date.now();
  await ev(pg, ([n, r]) => window.__app.actions.expandNode(n, r), [node, rel]);
  await pg.waitForFunction(() => document.getElementById("toast").classList.contains("hidden"),
    null, { timeout: 30000 }).catch(() => {});
  await wait(250, pg);
  return Date.now() - t0;
}
const persp = (id, pg = page) => ev(pg, (p) => {
  const t0 = performance.now();
  window.__app.actions.setPerspective(p);
  return +(performance.now() - t0).toFixed(2);
}, id);
const bench = (pg = bpage) => ev(pg, () => window.__app.benchmark(3000));

/* ------------------------------------------------------------------ boot */
R.timeToFirstMeaningfulRenderMs = await boot(page);
await boot(bpage);
R.appFirstRenderMs = await ev(page, () => +window.__app.state.perf.firstRenderMs.toFixed(1));
log("boot -> first meaningful render:", R.timeToFirstMeaningfulRenderMs, "ms",
  "(app-side fetch+layout+render", R.appFirstRenderMs, "ms)");

const PERSPS = ["remotes", "storage", "lineage", "topology", "health"];

/* --------------------------------------------------------------- s1 flow */
log("\n== s1-spacetop ==");
await load("s1-spacetop");
await shot("s1-01-seed");
R.s1 = { seed: await counts(), expands: [] };
log("  seed", JSON.stringify(R.s1.seed));

R.s1.expands.push(["d:lena remote", await expand("d:lena", "remote")]);
await shot("s1-02-mid-expansion");
log("  after lena/remote", JSON.stringify(await counts()));
for (const n of ["d:discovery", "d:smaug", "d:typhon", "d:rolando", "d:rolando-x"]) {
  R.s1.expands.push([n + " *", await expand(n, "*")]);
}
R.s1.full = await counts();
log("  fully explored", JSON.stringify(R.s1.full));
await shot("s1-03-explored");

await ev(page, () => {
  const f = window.__app.state.findings.find((x) => x.code === "duplicate-annex-uuid");
  window.__app.actions.focusNodes(f.nodes);
});
await wait(900);
await shot("s1-04-duplicate-uuid-error");

await ev(page, () => window.__app.actions.focusNodes(["d:rolando-x"]));
await wait(800);
await shot("s1-05-remote-name-disagreement");
R.s1.aliases = await ev(page, () => {
  const g = window.__app.state.graph, out = {};
  g.forEachNode((n, a) => { if (a._aliasCount > 1) out[a.label] = a._inNames; });
  return out;
});
log("  same repo, different remote names:", JSON.stringify(R.s1.aliases));

await ev(page, () => window.__app.actions.fitAll());
await wait(700);
R.s1.perspectiveMs = {};
for (const p of PERSPS) { R.s1.perspectiveMs[p] = await persp(p); await shot("s1-persp-" + p); }
log("  perspective switch ms:", JSON.stringify(R.s1.perspectiveMs));

await ev(page, () => window.__app.actions.setTheme("light"));
await persp("remotes");
await shot("s1-07-light-theme");
await ev(page, () => window.__app.actions.setTheme("dark"));
await persp("remotes");

// search + filter
await page.fill("#search", "rolando-exchange");
await wait(600);
await shot("s1-08-search-remote-name");
await page.fill("#search", "");
await wait(300);

// benchmark page mirrors the same exploration
await load("s1-spacetop", bpage);
for (const [n, r] of [["d:lena", "remote"], ["d:discovery", "*"], ["d:smaug", "*"],
                      ["d:typhon", "*"], ["d:rolando", "*"], ["d:rolando-x", "*"]]) {
  await expand(n, r, bpage);
}
await ev(bpage, () => { window.__app.state.semanticZoom = false; });
R.s1.bench = await bench();
log("  s1 bench (DPR1):", JSON.stringify(R.s1.bench));

/* --------------------------------------------------------------- s2 flow */
log("\n== s2-babs-ria ==");
await load("s2-babs-ria");
await shot("s2-01-seed");
R.s2 = { expands: [] };
R.s2.expands.push(["d:super subdataset", await expand("d:super", "subdataset")]);
R.s2.expands.push(["d:super worktree_of", await expand("d:super", "worktree_of")]);
await shot("s2-02-mid-expansion");
log("  after subdatasets+worktrees", JSON.stringify(await counts()));
R.s2.expands.push(["d:super remote (RIA + 40 subject repos)", await expand("d:super", "remote")]);
R.s2.full = await counts();
log("  after the RIA arrives", JSON.stringify(R.s2.full));
await shot("s2-03-ria-40-children-expanded");

R.s2.collapseMs = await ev(page, () => {
  const t0 = performance.now();
  window.__app.actions.toggleGroup("d:ria");
  return +(performance.now() - t0).toFixed(1);
});
await wait(400);
await ev(page, () => window.__app.actions.fitAll && window.__app.actions.fitAll());
await wait(400);
await shot("s2-04-ria-collapsed-meta-node");
R.s2.afterCollapse = await counts();
log("  collapse d:ria:", R.s2.collapseMs, "ms ->", JSON.stringify(R.s2.afterCollapse));

await ev(page, () => window.__app.actions.toggleGroup("d:ria"));
await wait(400);
await ev(page, () => window.__app.actions.fitAll());
await wait(700);
R.s2.perspectiveMs = {};
for (const p of PERSPS) { R.s2.perspectiveMs[p] = await persp(p); await shot("s2-persp-" + p); }
log("  perspective switch ms:", JSON.stringify(R.s2.perspectiveMs));

await ev(page, () => window.__app.actions.setTheme("light"));
await persp("storage");
await shot("s2-05-light-theme");
await ev(page, () => window.__app.actions.setTheme("dark"));
await persp("remotes");

await load("s2-babs-ria", bpage);
for (const r of ["subdataset", "worktree_of", "remote"]) await expand("d:super", r, bpage);
await ev(bpage, () => { window.__app.state.semanticZoom = false; });
R.s2.bench = await bench();
log("  s2 bench (DPR1):", JSON.stringify(R.s2.bench));

/* --------------------------------------------------------------- s3 flow */
log("\n== s3-forks ==");
await load("s3-forks");
await shot("s3-01-seed");
R.s3 = { expands: [] };
R.s3.expands.push(["d:mine remote", await expand("d:mine", "remote")]);
await shot("s3-02-mid-expansion");
R.s3.expands.push(["d:upstream fork_of (60 forks)", await expand("d:upstream", "fork_of")]);
log("  after 60 forks", JSON.stringify(await counts()));
await shot("s3-03-inactive-forks-greyed");
R.s3.inactive = await ev(page, () => {
  const g = window.__app.state.graph; let n = 0;
  g.forEachNode((k, a) => { if (a.inactive) n++; });
  return n;
});
log("  inactive forks greyed:", R.s3.inactive);

// hide-inactive filter
await page.uncheck("#f-inactive");
await wait(500);
await shot("s3-04-inactive-filtered-out");
R.s3.drawnWithoutInactive = (await counts()).drawn;
await page.check("#f-inactive");
await wait(300);

// the template trap lives on github.com; reach it through derived containment
R.s3.expands.push(["h:github contains", await expand("h:github", "contains")]);
for (const n of ["d:proj-a", "d:proj-b"]) R.s3.expands.push([n + " *", await expand(n, "*")]);
R.s3.full = await counts();
log("  after github/contains", JSON.stringify(R.s3.full));
await persp("lineage");
await wait(400);
await shot("s3-05-lineage-template-trap");
await ev(page, () => {
  const f = window.__app.state.findings.find((x) => x.code === "identity-ambiguous");
  if (f) window.__app.actions.focusNodes(f.nodes);
});
await wait(900);
await shot("s3-06-candidate-same-as-rejected");

await ev(page, () => window.__app.actions.fitAll());
await wait(700);
R.s3.perspectiveMs = {};
for (const p of PERSPS) { R.s3.perspectiveMs[p] = await persp(p); await shot("s3-persp-" + p); }
log("  perspective switch ms:", JSON.stringify(R.s3.perspectiveMs));

await ev(page, () => window.__app.actions.setTheme("light"));
await persp("lineage");
await shot("s3-07-light-theme");
await ev(page, () => window.__app.actions.setTheme("dark"));

// semantic zoom in action
await persp("remotes");
await ev(page, () => window.__app.actions.collapseAll());
await wait(700);
await shot("s3-08-semantic-zoom-collapsed");
await ev(page, () => window.__app.actions.expandAll());
await wait(400);

await load("s3-forks", bpage);
await expand("d:mine", "remote", bpage);
await expand("d:upstream", "fork_of", bpage);
await expand("h:github", "contains", bpage);
await ev(bpage, () => { window.__app.state.semanticZoom = false; });
R.s3.bench = await bench();
log("  s3 bench (DPR1):", JSON.stringify(R.s3.bench));

/* ---------------------------------------------------------- synthetic */
log("\n== synthetic scale (DPR1) ==");
R.synthetic = {};
for (const n of [500, 2000, 5000, 10000]) {
  const t0 = Date.now();
  await ev(bpage, (k) => window.__app.actions.loadSynthetic(k), n);
  await bpage.waitForFunction(() => document.getElementById("toast").classList.contains("hidden"),
    null, { timeout: 180000 });
  const wall = Date.now() - t0;
  await wait(500, bpage);
  await ev(bpage, () => { window.__app.state.semanticZoom = false; });
  const b = await bench();
  const perf = await ev(bpage, () => ({
    layoutMs: +window.__app.state.perf.lastLayoutMs.toFixed(0),
    firstRenderMs: +window.__app.state.perf.firstRenderMs.toFixed(0),
    drawn: window.__app.counts().drawn,
  }));
  const ps = await ev(bpage, () => window.__app.switchTimings());
  R.synthetic[n] = { wallMs: wall, ...perf, bench: b, perspectiveMs: ps };
  log(` ${String(n).padStart(5)}: layout ${perf.layoutMs} ms · load+render ${perf.firstRenderMs} ms · ` +
      `${b.fps} fps (mean ${b.meanMs}, median ${b.medianMs}, p95 ${b.p95Ms}) · ` +
      `perspective switch ${JSON.stringify(ps)}`);
}
// screenshots of two synthetic sizes on the crisp page
for (const n of [500, 2000]) {
  await ev(page, (k) => window.__app.actions.loadSynthetic(k), n);
  await page.waitForFunction(() => document.getElementById("toast").classList.contains("hidden"),
    null, { timeout: 180000 });
  await wait(900);
  await shot("synthetic-" + n);
}

/* ---------------------------------------------------------------- done */
R.consoleErrors = errors;
log("\nconsole errors:", errors.length ? JSON.stringify(errors.slice(0, 8), null, 1) : "none");
writeFileSync("/tmp/claude-0/-home-user-ceptualization/f273cf9e-aebb-546e-8481-55bd4553c021/scratchpad/team-c/results.json",
  JSON.stringify(R, null, 1));
console.log("\n===RESULTS===\n" + JSON.stringify(R, null, 1));
await browser.close();
