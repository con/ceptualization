import { S, filters, focusNodes, toggleCollapse, reapplyFilters, recomputeDerived } from './graph.js';
import { shorten, edgeLabel } from './model.js';

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, html) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
};
const esc = (s) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export const ui = { onExpand: null, onExpandAll: null, onAddRemote: null };

// ---------------------------------------------------------------- tabs ------

export function renderTabs(scenarios, active, onPick) {
  const nav = $('#scenario-tabs');
  nav.innerHTML = '';
  scenarios.forEach((s) => {
    const b = el('button', 'tab' + (s.id === active ? ' active' : ''), esc(s.id));
    b.dataset.scenario = s.id;
    b.title = s.title;
    b.onclick = () => onPick(s.id);
    nav.appendChild(b);
  });
}

// ------------------------------------------------------------- scenario -----

export function renderScenario(meta) {
  $('#scenario-title').textContent = meta.title;
  $('#scenario-sub').textContent = meta.subtitle || '';
  const ex = $('#exercises');
  ex.innerHTML = '';
  (meta.exercises || []).forEach((e) => ex.appendChild(el('li', null, esc(e))));
}

export function renderProgress() {
  const total = (S.meta?.total_nodes || 0) + (S.meta?.total_edges || 0);
  const got = S.known.nodes.size + S.known.edges.size;
  const pct = total ? Math.round((got / total) * 100) : 0;
  $('#progress-bar').style.width = pct + '%';
  $('#progress-text').textContent =
    `${S.known.nodes.size}/${S.meta?.total_nodes ?? '?'} nodes · ${S.known.edges.size}/${S.meta?.total_edges ?? '?'} edges discovered`;
}

// ------------------------------------------------------------- findings -----

export function renderFindings() {
  const box = $('#findings');
  box.innerHTML = '';
  const list = S.findings || [];
  if (!list.length) {
    box.appendChild(el('div', 'faint', 'none'));
    return;
  }
  list.forEach((f) => {
    const present = (f.nodes || []).filter((id) => S.cy.$id(id).length > 0);
    const all = (f.nodes || []).length;
    const node = el('div', `finding ${f.severity}${present.length ? '' : ' undiscovered'}`);
    node.innerHTML =
      `<div class="finding-head"><span>${esc(f.severity)}</span><span class="faint">${esc(f.code)}</span></div>` +
      `<div class="finding-msg">${esc(f.message)}</div>` +
      `<div class="finding-state">${present.length}/${all} node${all === 1 ? '' : 's'} discovered${present.length ? ' · click to focus' : ' · keep expanding'}</div>`;
    node.onclick = () => {
      if (present.length) focusNodes(present);
    };
    box.appendChild(node);
  });
  renderBanners();
}

function renderBanners() {
  const slot = $('#banner-slot');
  slot.innerHTML = '';
  (S.findings || [])
    .filter((f) => f.severity === 'error' || f.severity === 'warning')
    .forEach((f) => {
      const present = (f.nodes || []).filter((id) => S.cy.$id(id).length > 0);
      if (present.length < (f.nodes || []).length) return; // only shout once fully discovered
      const b = el('div', `banner ${f.severity === 'warning' ? 'warning' : ''}`);
      b.innerHTML =
        `<span class="banner-tag">${f.severity}</span>` +
        `<span><b>${esc(f.code)}</b> — ${esc(f.message)}</span>`;
      const btn = el('button', 'btn', 'show');
      btn.onclick = () => focusNodes(present);
      b.appendChild(btn);
      slot.appendChild(b);
    });
}

// --------------------------------------------------------------- legend -----

export function renderLegend() {
  const box = $('#legend');
  const rows = [
    ['swatch', 'style="border-style:dashed"', 'unexpanded — has hidden relations'],
    ['swatch', 'style="border-style:solid"', 'fully expanded'],
    ['swatch', 'style="border-color:var(--accent);border-width:3px"', 'seed clone (where we started)'],
    ['swatch', 'style="border-color:var(--err);border-width:3px;background:var(--err-soft)"', 'error finding'],
    ['swatch', 'style="border-color:var(--warn);border-width:3px;background:var(--warn-soft)"', 'warning finding'],
    ['swatch', 'style="border-style:dashed;border-color:var(--cloud-line)"', 'special remote (vcs: none)'],
    ['swatch', 'style="opacity:.34;border-style:dotted"', 'inactive fork (nothing beyond upstream)'],
    ['box', 'style="background:var(--host);border-color:var(--host-line)"', 'host (compound parent)'],
    ['box', 'style="background:var(--store);border-color:var(--store-line);border-style:dashed"', 'RIA store / superdataset (nested parent)'],
    ['line', 'style="border-top-style:solid"', 'remote — label is the remote name'],
    ['line', 'style="border-top-style:dashed;border-top-color:var(--ink-faint)"', 'remote known by URL only'],
    ['line', 'style="border-top:3px dashed var(--err)"', 'same annex UUID (collision)'],
    ['line', 'style="border-top-color:var(--ok)"', 'subdataset'],
    ['line', 'style="border-top-style:dotted;border-top-color:var(--warn)"', 'shares history (containment)']
  ];
  box.innerHTML = rows
    .map(
      ([kind, style, label]) =>
        `<div class="legend-row"><span class="${kind === 'line' ? 'legend-line' : 'legend-swatch'}" ${style}></span><span>${esc(label)}</span></div>`
    )
    .join('');
  box.innerHTML +=
    '<div class="legend-row" style="margin-top:6px"><span class="badge badge-hidden">+N</span><span>relations not yet probed</span></div>' +
    '<div class="legend-row"><span class="badge badge-ahead">▲n</span><span class="badge badge-behind">▼n</span><span>commits ahead / behind</span></div>';
}

// ------------------------------------------------------------------ log -----

export function pushLog(rec) {
  const list = $('#log');
  const li = el('li');
  if (rec.relayout) {
    const r = rec.relayout;
    li.innerHTML = `<b>full re-layout</b> ${r.ms}ms · <span class="disp">moved mean ${r.displacement.mean}px max ${r.displacement.max}px</span> · ${r.frames.fps}fps`;
  } else {
    const d = rec.displacement;
    li.innerHTML =
      `<b>${esc(shorten(rec.node, 20))}</b> ${esc(rec.relation)}<br />` +
      `<span class="lat">${rec.latencyMs}ms probe</span> · <span class="gain">+${rec.newNodes}n/+${rec.newEdges}e</span> · ` +
      `layout ${rec.layoutMs}ms · <span class="disp">pinned moved mean ${(d.leaf || d).mean}px max ${(d.leaf || d).max}px${rec.pinned ? '' : ' (UNPINNED)'}</span>` +
      (rec.separation && rec.separation.moved ? ` · <span class="disp">${rec.separation.moved} container(s) slid ${rec.separation.maxShift}px</span>` : '');
  }
  list.prepend(li);
  while (list.children.length > 40) list.removeChild(list.lastChild);
  const n = S.metrics.expansions.length;
  if (n) {
    const lat = S.metrics.expansions.map((e) => e.latencyMs);
    const mean = Math.round(lat.reduce((a, b) => a + b, 0) / n);
    $('#log-summary').textContent = `· ${n} probes, mean ${mean}ms`;
  }
}

// ----------------------------------------------------------------- hud ------

export function renderHud() {
  const exp = S.metrics.expansions;
  const last = exp[exp.length - 1];
  const stab = $('#hud-stability');
  if (last) {
    const d = last.displacement;
    const l = d.leaf || d;
    stab.textContent =
      `mean ${l.mean}px · max ${l.max}px (${l.n} pinned)` +
      (d.newParents && d.newParents.n ? ` · ${d.newParents.n} new container${d.newParents.n > 1 ? 's' : ''} moved ${d.newParents.max}px` : '');
    stab.className = 'hud-val ' + (l.mean < 2 ? 'good' : l.mean < 25 ? '' : 'bad');
    $('#hud-latency').textContent = `${last.latencyMs}ms · layout ${last.layoutMs}ms · ${last.frames.fps}fps`;
  } else {
    stab.textContent = '— (no expansion yet)';
    stab.className = 'hud-val';
    $('#hud-latency').textContent = S.metrics.firstRenderMs != null ? `first render ${S.metrics.firstRenderMs}ms` : '—';
  }
  $('#hud-elements').textContent = `${S.cy.nodes().length} nodes · ${S.cy.edges().length} edges`;
  const ov = $('#hud-overlap');
  const nOv = last?.overlaps ?? 0;
  const sep = last?.separation;
  ov.textContent = sep && sep.moved
    ? `${sep.moved} slid apart (max ${sep.maxShift}px)` + (nOv ? ` · ${nOv} still overlap` : '')
    : nOv
      ? `${nOv} pair${nOv > 1 ? 's' : ''} overlap — press re-layout`
      : 'no overlaps';
  ov.className = 'hud-val ' + (nOv ? 'bad' : 'good');
  $('#hud-filter-row').hidden = S.cy.nodes('.inactive').length === 0;
  $('#hud-inactive-edges-row').hidden = S.cy.nodes('.inactive').length === 0;
}

// --------------------------------------------------------------- toast ------

let toastTimer = null;
export function toast(msg, sticky = false) {
  const box = $('#toast');
  box.innerHTML = '';
  clearTimeout(toastTimer);
  if (!msg) return;
  const t = el('div', 'toast-item');
  t.innerHTML = `<span class="spinner"></span><span>${esc(msg)}</span>`;
  box.appendChild(t);
  if (!sticky) toastTimer = setTimeout(() => (box.innerHTML = ''), 1800);
}

// ------------------------------------------------------------ inspector -----

function chip(text, cls = '') {
  return `<span class="chip ${cls}">${esc(text)}</span>`;
}

export function renderInspector(node) {
  const box = $('#inspector');
  if (!node || node.length === 0) {
    box.innerHTML =
      '<div class="empty">Select a node to inspect it.<br /><span class="dim">Double-click a node to probe every hidden relation on it.</span></div>';
    return;
  }
  const d = node.data();
  const f = S.frontier[d.id];
  const parts = [];

  parts.push(`<div class="insp-kicker">${esc(d.type)}${d.host_kind ? ' · ' + esc(d.host_kind) : ''}</div>`);
  parts.push(`<div class="insp-title">${esc(d.fullLabel || d.label)}</div>`);

  const chips = [];
  if (d.is_seed) chips.push(chip('seed', 'seed'));
  if (d._severity === 'error') chips.push(chip('ERROR', 'err'));
  if (d._severity === 'warning') chips.push(chip('warning', 'warn'));
  if (d.vcs) chips.push(chip('vcs:' + d.vcs));
  if (d.layout) chips.push(chip(d.layout));
  if (d.annex_mode && d.annex_mode !== 'none') chips.push(chip('annex:' + d.annex_mode));
  if (d.special_remote_type) chips.push(chip('special:' + d.special_remote_type));
  (d.packaging || []).forEach((p) => chips.push(chip(p)));
  if (d.trust) chips.push(chip('trust:' + d.trust, 'warn'));
  if (d.role) chips.push(chip(d.role));
  if (d.merged === false) chips.push(chip('unmerged', 'warn'));
  if (d.merged === true) chips.push(chip('merged', 'ok'));
  if (d.is_upstream) chips.push(chip('upstream'));
  if (d.is_fork) chips.push(chip('fork'));
  if (d.is_template) chips.push(chip('template'));
  if (d.inactive) chips.push(chip('inactive'));
  if (d.added_as_remote) chips.push(chip('added as remote', 'ok'));
  if (chips.length) parts.push(`<div class="chips">${chips.join('')}</div>`);

  const kv = [];
  const push = (k, v) => v != null && v !== '' && kv.push(`<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`);
  push('id', d.id);
  push('on host', d.on_host);
  push('annex uuid', d.annex_uuid);
  push('dataset id', d.dataset_id);
  push('branch', d.branch);
  push('result branch', d.result_branch);
  push('forge', d.forge);
  push('stars', d.stars);
  push('ahead of upstream', d.ahead_of_upstream);
  push('behind upstream', d.behind_upstream);
  push('observed', d.observed_at ? new Date(d.observed_at * 1000).toISOString().slice(0, 16).replace('T', ' ') : null);
  push('via', d.via);
  if (kv.length) parts.push(`<dl class="kv">${kv.join('')}</dl>`);

  // relations
  parts.push('<div class="insp-sec"><div class="insp-kicker">relations</div>');
  if (!f || !f.relations.length) {
    parts.push('<div class="faint" style="font-size:11.5px;padding:6px 0">no relations recorded for this node</div>');
  } else {
    f.relations.forEach((r) => {
      const done = r.hidden === 0;
      parts.push(
        `<div class="rel ${done ? 'done' : ''}">` +
          `<div class="rel-main"><div class="rel-label">${esc(r.label)} ` +
          `<span class="pill-count ${done ? 'zero' : ''}">${done ? r.count : '+' + r.hidden}</span></div>` +
          `<div class="rel-probe">${esc(r.probe)}</div></div>` +
          (done
            ? '<span class="chip ok">probed</span>'
            : `<button class="btn btn-primary" data-expand="${esc(r.key)}">probe</button>`) +
          '</div>'
      );
    });
  }
  parts.push('</div>');

  // known edges on this node
  const incAll = node.connectedEdges().filter((e) => !e.hasClass('meta') && !e.hasClass('containment'));
  const inc = incAll.slice(0, 10);
  if (incAll.length) {
    parts.push('<div class="insp-sec"><div class="insp-kicker">known edges</div>');
    inc.forEach((e) => {
      const out = e.data('source') === d.id;
      const other = out ? e.target() : e.source();
      const lbl = edgeLabel(e.data());
      const ab = [];
      if (e.data('ahead')) ab.push(`<span class="ahead">▲${e.data('ahead')}</span>`);
      if (e.data('behind')) ab.push(`<span class="behind">▼${e.data('behind')}</span>`);
      parts.push(
        `<div class="edge-item">${out ? '→' : '←'} ${esc(shorten(other.data('fullLabel') || other.id(), 26))}` +
          ` <span class="${lbl ? 'rn' : 'none'}">${esc(lbl || e.data('kind'))}</span> ${ab.join(' ')}</div>`
      );
    });
    if (incAll.length > inc.length) {
      parts.push(`<div class="edge-item faint">… and ${incAll.length - inc.length} more</div>`);
    }
    parts.push('</div>');
  }

  // s3 preview / add-as-remote affordance
  if (d.is_fork && !d.added_as_remote) {
    parts.push(
      '<div class="preview-card"><h4>preview before adding</h4>' +
        `<div style="font-size:11.5px" class="dim">${esc(d.label)} is ${d.ahead_of_upstream || 0} ahead / ${d.behind_upstream || 0} behind upstream` +
        `${d.inactive ? ' — <b>nothing beyond upstream</b>, adding it buys you nothing.' : ' — has commits upstream does not.'}</div>` +
        `<div style="margin-top:8px;display:flex;gap:6px"><button class="btn" data-preview="${esc(d.id)}">preview diff scope</button>` +
        `<button class="btn btn-primary" data-add-remote="${esc(d.id)}">add as remote</button></div></div>`
    );
  }

  if (node.isParent() || node.hasClass('collapsed')) {
    parts.push(
      `<div class="insp-sec"><button class="btn" data-collapse="${esc(d.id)}">${node.hasClass('collapsed') ? 'expand' : 'collapse'} container (${node.hasClass('collapsed') ? (d._stash || []).length : node.descendants().length} inside)</button></div>`
    );
  }

  box.innerHTML = parts.join('');

  box.querySelectorAll('[data-expand]').forEach((b) => {
    b.onclick = () => ui.onExpand?.(d.id, b.dataset.expand);
  });
  box.querySelectorAll('[data-collapse]').forEach((b) => {
    b.onclick = () => {
      toggleCollapse(S.cy.$id(b.dataset.collapse));
      renderInspector(S.cy.$id(b.dataset.collapse));
      renderHud();
    };
  });
  box.querySelectorAll('[data-preview]').forEach((b) => {
    b.onclick = () => {
      const n = S.cy.$id(b.dataset.preview);
      S.cy.nodes().removeClass('preview');
      n.addClass('preview');
      focusNodes([n.id(), ...n.neighborhood().nodes().map((x) => x.id())]);
    };
  });
  box.querySelectorAll('[data-add-remote]').forEach((b) => {
    b.onclick = () => ui.onAddRemote?.(b.dataset.addRemote);
  });
}

export function wireFilters() {
  $('#opt-separate').onchange = (e) => {
    S.separate = e.target.checked;
  };
  $('#filter-containment').onchange = (e) => {
    filters.showContainmentEdges = e.target.checked;
    reapplyFilters();
    renderHud();
  };
  $('#filter-inactive-edges').onchange = (e) => {
    filters.showInactiveEdges = e.target.checked;
    reapplyFilters();
    renderHud();
  };
  $('#filter-inactive').onchange = (e) => {
    filters.hideInactive = e.target.checked;
    reapplyFilters();
    recomputeDerived();
    renderHud();
  };
}
