import { state, topContainerOf } from "./state.js";
import { PERSPECTIVES, byId } from "./perspectives.js";
import { KIND_LABEL, hostColor, kindColor, TOK } from "./palette.js";
import { renderer, collapsibleGroups } from "./render.js";

const $ = (id) => document.getElementById(id);
export const el = $;

let A = {};
export function mountUI(actions) {
  A = actions;

  $("theme-toggle").onclick = () => A.setTheme(state.theme === "dark" ? "light" : "dark");

  $("search").addEventListener("input", (e) => {
    state.filters.search = e.target.value;
    A.viewChanged();
    renderSearchResults();
  });
  $("search").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const first = document.querySelector("#search-results .r");
      if (first) first.click();
    }
  });

  $("f-ahead").addEventListener("input", (e) => {
    state.filters.aheadMin = +e.target.value;
    $("f-ahead-out").textContent = e.target.value;
    A.viewChanged();
  });
  for (const b of $("f-annex").querySelectorAll("button")) {
    b.onclick = () => {
      state.filters.annex = b.dataset.v;
      for (const o of $("f-annex").querySelectorAll("button")) o.classList.toggle("on", o === b);
      A.viewChanged();
    };
  }
  $("f-inactive").onchange = (e) => { state.filters.showInactive = e.target.checked; A.viewChanged(); };
  $("f-hosts-vis").onchange = (e) => { state.filters.showHosts = e.target.checked; A.viewChanged(); };
  $("g-hulls").onchange = (e) => { state.hulls = e.target.checked; renderer && renderer.refresh({ skipIndexation: true }); };
  $("g-semzoom").onchange = (e) => { state.semanticZoom = e.target.checked; A.semanticZoom(true); };
  $("g-collapse-all").onclick = () => A.collapseAll();
  $("g-expand-all").onclick = () => A.expandAll();
  for (const b of $("synth-row").querySelectorAll("button")) {
    b.onclick = () => A.loadSynthetic(+b.dataset.n);
  }
  $("bench").onclick = () => A.bench();

  window.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT") return;
    const p = PERSPECTIVES.find((x) => x.key === e.key);
    if (p) A.setPerspective(p.id);
  });
}

export function renderScenarios(list) {
  const box = $("scenario-tabs");
  box.innerHTML = "";
  for (const s of list) {
    const b = document.createElement("button");
    b.textContent = s.id.replace(/^s(\d)-/, "s$1 · ");
    b.title = s.title + " — " + (s.subtitle || "");
    b.classList.toggle("on", s.id === state.scenario && !state.synthetic);
    b.onclick = () => A.loadScenario(s.id);
    box.appendChild(b);
  }
}

export function renderPerspectives() {
  const box = $("perspectives");
  box.innerHTML = "";
  for (const p of PERSPECTIVES) {
    const b = document.createElement("button");
    b.classList.toggle("on", p.id === state.perspective);
    b.innerHTML = `<span>${p.name}</span><span class="key">${p.key}</span>`;
    b.onclick = () => A.setPerspective(p.id);
    box.appendChild(b);
  }
  $("persp-desc").textContent = byId(state.perspective).desc;
}

export function renderFilters() {
  const g = state.graph;
  const kindCounts = new Map();
  g.forEachEdge((e, a) => kindCounts.set(a.kind, (kindCounts.get(a.kind) || 0) + 1));
  const p = byId(state.perspective);
  const kb = $("f-kinds"); kb.innerHTML = "";
  const kinds = [...new Set([...p.kinds, ...kindCounts.keys()])];
  for (const k of kinds) {
    const c = document.createElement("span");
    c.className = "chip" + (state.filters.kinds.has(k) ? " on" : "");
    c.style.color = state.filters.kinds.has(k) ? kindColor(k) : "";
    c.innerHTML = `<i class="sw" style="background:${kindColor(k)}"></i>${KIND_LABEL[k] || k}<b class="n">${kindCounts.get(k) || 0}</b>`;
    c.onclick = () => {
      if (state.filters.kinds.has(k)) state.filters.kinds.delete(k);
      else state.filters.kinds.add(k);
      if (!state.filters.kinds.size) state.filters.kinds = new Set(p.kinds);
      renderFilters(); A.viewChanged();
    };
    kb.appendChild(c);
  }

  const hb = $("f-hosts"); hb.innerHTML = "";
  const tops = new Map();
  g.forEachNode((n, a) => {
    if (a._collapsedInto) return;
    const t = topContainerOf(g, n);
    tops.set(t, (tops.get(t) || 0) + 1);
  });
  for (const [t, n] of [...tops].sort((a, b) => b[1] - a[1])) {
    if (!g.hasNode(t)) continue;
    const on = state.filters.hosts.size === 0 || state.filters.hosts.has(t);
    const c = document.createElement("span");
    c.className = "chip" + (on ? " on" : "");
    c.innerHTML = `<i class="sw" style="background:${hostColor(t)}"></i>${g.getNodeAttribute(t, "label")}<b class="n">${n}</b>`;
    c.onclick = () => {
      const f = state.filters.hosts;
      if (f.size === 0) { for (const k of tops.keys()) f.add(k); }
      if (f.has(t)) f.delete(t); else f.add(t);
      if (f.size === tops.size) f.clear();
      renderFilters(); A.viewChanged();
    };
    hb.appendChild(c);
  }
  renderGroupList();
}

export function renderGroupList() {
  const box = $("group-list"); box.innerHTML = "";
  const gs = collapsibleGroups().sort((a, b) => b.members.length - a.members.length);
  for (const gr of gs.slice(0, 40)) {
    const collapsed = state.collapsed.has(gr.id);
    const row = document.createElement("div");
    row.className = "grouprow";
    row.innerHTML = `<i class="sw" style="background:${hostColor(gr.id)}"></i>
      <span class="nm">${gr.label}</span>
      <span class="st">${collapsed ? "collapsed" : "open"}</span>
      <span class="n">${gr.members.length}</span>`;
    row.onclick = () => A.toggleGroup(gr.id);
    box.appendChild(row);
  }
  if (!gs.length) box.innerHTML = '<p class="hint">No containers discovered yet.</p>';
}

export function renderCounters() {
  const g = state.graph;
  let vis = 0;
  g.forEachNode((n) => {
    const d = renderer && renderer.getNodeDisplayData(n);
    if (d && !d.hidden) vis++;
  });
  const census = state.meta.census || {};
  $("counters").innerHTML =
    `<span><b>${g.order}</b>/${census.nodes ?? "?"} nodes</span>` +
    `<span><b>${g.size}</b>/${census.edges ?? "?"} edges</span>` +
    `<span><b>${vis}</b> drawn</span>`;
}

export function renderHud() {
  const p = state.perf;
  const cam = renderer ? renderer.getCamera() : null;
  $("hud").innerHTML =
    `<div><b>${p.fps.toFixed(0)}</b> fps · ${p.frameMs.toFixed(1)} ms</div>` +
    `<div>layout <b>${p.lastLayoutMs.toFixed(0)}</b> ms</div>` +
    `<div>perspective <b>${p.lastSwitchMs.toFixed(1)}</b> ms</div>` +
    (cam ? `<div>zoom <b>${(1 / cam.ratio).toFixed(2)}x</b></div>` : "") +
    (state.lastProbeMs != null ? `<div>probe <b>${state.lastProbeMs}</b> ms</div>` : "");
}

export function renderLegend() {
  const p = byId(state.perspective), T = TOK();
  const rows = [];
  const kinds = p.kinds.concat(p.keepErrors ? ["same_annex_uuid"] : []);
  for (const k of [...new Set(kinds)]) {
    rows.push(`<div class="li"><i class="swl" style="border-top-color:${kindColor(k)}"></i>${KIND_LABEL[k] || k}</div>`);
  }
  let colors = "";
  if (p.colorBy === "host") colors = "node colour = host / store";
  else if (p.colorBy === "storage") colors = "node colour = storage flavour (RIA, S3/exporttree, bare, annex, dead)";
  else if (p.colorBy === "lineage") colors = "node colour = upstream / fork / template / inactive";
  else if (p.colorBy === "hostkind") colors = "node colour = host kind (host, forge, cloud, store)";
  else colors = "node colour = finding severity";
  const sizes = p.sizeBy === "ahead" ? "node size = commits ahead"
    : p.sizeBy === "children" ? "node size = children contained" : "node size = severity";
  $("legend").innerHTML =
    `<h4>${p.name}</h4>${rows.join("")}` +
    `<div class="li" style="margin-top:5px;color:${T.fg3}">${colors}</div>` +
    `<div class="li" style="color:${T.fg3}">${sizes}</div>` +
    `<div class="li" style="color:${T.fg3}">tinted disc = containment (host / store / superdataset)</div>`;
}

export function renderFindings() {
  const box = $("findings"); box.innerHTML = "";
  if (!state.findings.length) { box.innerHTML = '<p class="hint">None.</p>'; return; }
  for (const f of state.findings) {
    const present = (f.nodes || []).filter((n) => state.graph.hasNode(n));
    const latent = present.length < (f.nodes || []).length;
    const d = document.createElement("div");
    d.className = "finding " + f.severity + (latent && !present.length ? " latent" : "");
    d.innerHTML = `<div class="code">${f.severity} · ${f.code}` +
      (latent ? ` <span class="latent-tag">— ${present.length}/${(f.nodes || []).length} discovered</span>` : "") +
      `</div><div class="msg">${esc(f.message)}</div>`;
    d.onclick = () => present.length && A.focusNodes(present);
    box.appendChild(d);
  }
}

export function renderInspector() {
  const box = $("inspector-body");
  const g = state.graph;
  const n = state.selected;
  if (!n || !g.hasNode(n)) {
    box.className = "hint";
    box.innerHTML = "Click a node. Expansion probes the server (300–900 ms), and only newly discovered nodes come back.";
    return;
  }
  box.className = "";
  const a = g.getNodeAttributes(n);
  const sev = (state._sev || new Map()).get(n);
  const host = a.on_host && g.hasNode(a.on_host) ? g.getNodeAttribute(a.on_host, "label") : (a.ntype === "host" ? "-" : "?");
  const out = [];
  if (sev) {
    const f = state.findings.find((x) => (x.nodes || []).includes(n));
    out.push(`<div class="alert"><b>${f.code}</b><br>${esc(f.message)}</div>`);
  }
  out.push(`<div class="ttl">${esc(a.label)}</div>`);
  out.push(`<div class="sub">${esc(host)}${a.role ? " · " + a.role : ""}</div>`);

  const kv = [];
  const add = (k, v) => v !== undefined && v !== null && v !== "" && kv.push(`<dt>${k}</dt><dd>${esc(String(v))}</dd>`);
  add("id", n);
  add("type", a.ntype);
  add("vcs", a.vcs);
  add("layout", a.layout);
  add("annex", a.annex_mode);
  add("special", a.special_remote_type);
  add("trust", a.trust);
  add("annex uuid", a.annex_uuid);
  add("dataset id", a.dataset_id);
  add("branch", a.result_branch || a.branch);
  add("merged", a.merged === undefined ? undefined : String(a.merged));
  add("stars", a.stars);
  add("packaging", (a.packaging || []).join(", "));
  add("ahead/behind", (a._ahead || 0) + " / " + (a._behind || 0));
  out.push(`<dl class="kv">${kv.join("")}</dl>`);

  // --- expansion affordances
  const rel = a.relations || {};
  const keys = Object.keys(rel).sort();
  if (keys.length) {
    out.push('<h3 style="margin:10px 0 4px;font-size:10px;letter-spacing:.07em;text-transform:uppercase;color:var(--fg3)">Expand along</h3><div class="exp">');
    for (const k of keys) {
      const r = rel[k];
      const done = r.new === 0;
      out.push(`<button data-rel="${k}" ${done ? "class=\"done\" disabled" : ""}>` +
        `<i style="width:8px;height:8px;border-radius:50%;background:${kindColor(k)}"></i>` +
        `${KIND_LABEL[k] || k}<span class="n">${done ? "all " + r.total + " known" : "+" + r.new + " new"}</span></button>`);
    }
    out.push("</div>");
  }

  // --- remote-name tables: the s1 point.
  const outRows = [], inRows = [];
  g.forEachOutEdge(n, (e, ea, s, t) => {
    if (ea.kind !== "remote" && ea.kind !== "fork_of" && ea.kind !== "worktree_of") return;
    outRows.push(row(ea.remote_name, g.getNodeAttribute(t, "label"), ea));
  });
  g.forEachInEdge(n, (e, ea, s) => {
    if (ea.kind !== "remote") return;
    inRows.push(row(ea.remote_name, g.getNodeAttribute(s, "label"), ea));
  });
  if (outRows.length) {
    out.push('<h3 style="margin:10px 0 2px;font-size:10px;letter-spacing:.07em;text-transform:uppercase;color:var(--fg3)">Its remotes</h3>');
    out.push(`<table class="remtab"><tr><th>name</th><th>points at</th><th>a/b</th></tr>${outRows.map((r) => r.html).join("")}</table>`);
  }
  if (inRows.length) {
    out.push('<h3 style="margin:10px 0 2px;font-size:10px;letter-spacing:.07em;text-transform:uppercase;color:var(--fg3)">Called by others</h3>');
    if (a._aliasCount > 1) {
      out.push(`<div class="pill warn">${a._aliasCount} different names for this same repo</div>`);
    }
    out.push(`<table class="remtab"><tr><th>name</th><th>from</th><th>a/b</th></tr>${inRows.map((r) => r.html).join("")}</table>`);
  }
  box.innerHTML = out.join("");
  for (const b of box.querySelectorAll(".exp button")) {
    b.onclick = () => A.expandNode(n, b.dataset.rel);
  }

  function row(name, other, ea) {
    return {
      name,
      html: `<tr><td class="nm${name ? "" : " none"}">${esc(name || "(url only)")}</td>` +
        `<td>${esc(other)}</td><td><span class="ahead">${ea.ahead || 0}</span>/<span class="behind">${ea.behind || 0}</span></td></tr>`,
    };
  }
}

export function renderSearchResults() {
  const box = $("search-results");
  const q = state.filters.search.trim().toLowerCase();
  box.innerHTML = "";
  if (!q) return;
  const g = state.graph;
  const hits = [];
  g.forEachNode((n, a) => {
    if ((a.label || "").toLowerCase().includes(q) || n.toLowerCase().includes(q) ||
        (a.annex_uuid || "").toLowerCase().includes(q) ||
        (a._inNames || []).some((x) => x.toLowerCase().includes(q)) ||
        (a._outNames || []).some((x) => x.toLowerCase().includes(q))) hits.push([n, a]);
  });
  for (const [n, a] of hits.slice(0, 40)) {
    const d = document.createElement("div");
    d.className = "r";
    d.textContent = a.label;
    d.onclick = () => A.focusNodes([n]);
    box.appendChild(d);
  }
  if (!hits.length) box.innerHTML = '<p class="hint">no match</p>';
}

export function toast(msg, spinning) {
  const t = $("toast");
  if (!msg) { t.classList.add("hidden"); return; }
  t.classList.remove("hidden");
  t.innerHTML = (spinning ? '<span class="spin"></span>' : "") + esc(msg);
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
