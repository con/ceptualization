// Cytoscape elements + stylesheet.
//
// The one structural difference from team A and team B: THERE ARE NO
// CYTOSCAPE COMPOUND NODES HERE. A container is an ordinary node with an
// explicit width/height and an explicit position, drawn behind its children.
// Cytoscape derives a compound's geometry from its children and no layout can
// pin it -- that is exactly the 980 px jump team A measured. Taking the
// geometry away from cytoscape is what makes tier 1 possible.

import cytoscape from 'cytoscape';
import { PALETTES } from './palette.js';

export function wrapLabel(s, width = 24, maxLines = 2) {
  s = String(s || '');
  if (s.length <= width) return s;
  const lines = [];
  let rest = s;
  while (rest.length > width && lines.length < maxLines - 1) {
    let cut = rest.lastIndexOf('/', width);
    if (cut < width * 0.3) cut = width;
    else cut += 1;
    lines.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest.length > width) rest = '…' + rest.slice(-(width - 1));
  lines.push(rest);
  return lines.join('\n');
}

/** Nodes that different clones call by different remote names. This is the
 *  whole reason issue #1 exists, so it is computed from raw edges and shown
 *  ON the node, not in an inspector. */
export function nameDisagreements(nodes, edges, visible) {
  const names = new Map();
  for (const e of edges) {
    if (e.kind !== 'remote' || !e.remote_name) continue;
    if (visible && (!visible.has(e.source) || !visible.has(e.target))) continue;
    const m = names.get(e.target) || new Map();
    if (!m.has(e.remote_name)) m.set(e.remote_name, []);
    m.get(e.remote_name).push(e.source);
    names.set(e.target, m);
  }
  const out = new Map();
  for (const [target, m] of names) {
    if (m.size < 2) continue;
    out.set(target, [...m.entries()]
      .map(([name, srcs]) => ({ name, from: srcs.sort(), n: srcs.length }))
      .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name)));
  }
  return out;
}

export function duplicateUuids(nodes) {
  const seen = new Map();
  const dup = new Set();
  for (const n of nodes) {
    if (!n.annex_uuid) continue;
    if (seen.has(n.annex_uuid)) dup.add(n.annex_uuid);
    seen.set(n.annex_uuid, n.id);
  }
  return dup;
}

export function nodeClasses(n, ctx) {
  const c = [];
  if (ctx && ctx.overlapping) c.push('overlapping');
  if (n.type === 'host') c.push('host', 'hk-' + (n.host_kind || 'host'));
  else {
    c.push('dist');
    if (n.layout) c.push('lay-' + n.layout);
    if (n.vcs === 'none') c.push('special');
    if (n.is_seed) c.push('seed');
    if (n.trust === 'dead') c.push('dead');
    if (n.inactive) c.push('inactive');
    if (n.is_upstream) c.push('upstream');
    if (n.is_template) c.push('template');
    if (n.role) c.push('role-' + n.role);
    if (n.result_branch && !n.merged) c.push('unmerged');
  }
  if (ctx.isContainer) c.push('container');
  if (ctx.collapsed) c.push('collapsed');
  if (ctx.dup) c.push('dup-uuid');
  if (ctx.disagree) c.push('disagree');
  if (ctx.frontier) c.push('frontier');
  return c;
}

import { badgesFor, visibleBadges } from './badges.js';

/** The badge strip, as a compact string drawn above the node label. */
export function badgeStrip(n, ctx) {
  if (!ctx.badgeGroups) return '';
  const bs = visibleBadges(badgesFor(n, ctx), ctx.badgeGroups);
  return bs.map((b) => b.glyph).join(' ');
}

export function chipsFor(n, ctx) {
  const chips = [];
  if (n.type === 'host') {
    if (ctx.collapsed) chips.push(`▣ ${n.descendant_count} inside`);
    return chips;
  }
  if (n.layout) chips.push(n.layout);
  if (n.special_remote_type) chips.push(n.special_remote_type);
  if (n.annex_mode === 'none') chips.push('plain git');
  else if (n.annex_mode && n.annex_mode !== 'keystore') chips.push(n.annex_mode);
  if (n.branch) chips.push(n.branch);
  if (n.result_branch) chips.push(n.merged ? 'merged' : 'UNMERGED');
  if (n.trust === 'dead') chips.push('DEAD');
  if (typeof n.ahead_of_upstream === 'number') {
    chips.push(n.ahead_of_upstream === 0 ? 'nothing new' : `▲${n.ahead_of_upstream} upstream`);
  }
  if (n.stars) chips.push('★' + n.stars);
  if (ctx.collapsed) chips.push(`▣ ${n.descendant_count} inside`);
  return chips;
}

export function edgeLabel(e) {
  const bits = [];
  if (e.names && e.names.length > 1) bits.push(e.names.join(' | '));
  else if (e.names && e.names.length === 1) bits.push(e.names[0]);
  else if (e.kind === 'remote') bits.push('(url only)');
  else bits.push(e.kind.replace(/_/g, ' '));
  if (e.count > 1) bits.push('×' + e.count);
  const raw = e.sample || {};
  if (e.count === 1) {
    const ab = [];
    if (raw.ahead) ab.push('▲' + raw.ahead);
    if (raw.behind) ab.push('▼' + raw.behind);
    if (ab.length) bits.push(ab.join(' '));
    if (typeof raw.confidence === 'number') bits.push(`conf ${raw.confidence.toFixed(2)}`);
    else if (typeof raw.containment === 'number') bits.push(`cont ${raw.containment.toFixed(2)}`);
  }
  return bits.join('  ');
}

/**
 * @param view    result of collapse.aggregate()
 * @param model   {byId}
 * @param sizes   Map id -> {w,h} from the layout
 * @param extras  {dupUuids:Set, disagree:Map, frontier:Set}
 */
export function buildElements(view, model, sizes, extras = {}) {
  const els = [];
  const dis = extras.disagree || new Map();
  for (const id of view.shown) {
    const n = model.byId[id];
    if (!n) continue;
    const kids = (model.childrenOf(id) || []).filter((k) => view.shown.has(k));
    const isContainer = kids.length > 0;
    const collapsed = (extras.collapsed || new Set()).has(id);
    const ctx = {
      isContainer,
      collapsed,
      dup: !!(n.annex_uuid && (extras.dupUuids || new Set()).has(n.annex_uuid)),
      disagree: dis.has(id),
      frontier: (extras.frontier || new Set()).has(id),
      badgeGroups: extras.badgeGroups,
      severity: (extras.severityOf || new Map()).get(id),
      walked: (extras.walkedOf || new Map()).get(id),
      collapsedHidden: collapsed ? n.descendant_count : 0,
      ignoredByAll: (extras.ignoredByAll || new Set()).has(id),
      overlapping: (extras.overlapping || new Set()).has(id),
    };
    const size = sizes.get(id) || { w: 210, h: 76 };
    const chips = chipsFor(n, ctx);
    const names = dis.get(id);
    els.push({
      group: 'nodes',
      data: {
        id,
        w: size.w,
        h: size.h,
        label: n.label || id,
        short: wrapLabel(n.label || id, isContainer ? 40 : 24),
        chips: chips.join(' · '),
        badges: badgeStrip(n, ctx),
        names: names ? `⇄ ${names.length} names` : '',
        nameCount: names ? names.length : 0,
        raw: n,
        isContainer,
      },
      classes: nodeClasses(n, ctx).join(' '),
      selectable: true,
      grabbable: true,
    });
  }
  // One representative edge per DISTINCT remote name pointing at a node whose
  // name is disputed. Those edges are always labelled, at a constant rendered
  // size -- which is how "the same peer is `origin` here and
  // `rolando-exchange` there" gets into the default picture instead of into an
  // inspector. See labels.js.
  const nameRep = new Set();
  for (const e of view.edges) {
    if (e.kind !== 'remote' || !dis.has(e.target)) continue;
    for (const nm of (e.names && e.names.length ? e.names : [])) {
      const key = e.target + '|' + nm;
      if (!nameRep.has(key)) { nameRep.add(key); nameRep.add('EDGE:' + e.id); break; }
    }
  }
  for (const e of view.edges) {
    if (!view.shown.has(e.source) || !view.shown.has(e.target)) continue;
    const cls = ['k-' + e.kind];
    if (nameRep.has('EDGE:' + e.id)) cls.push('disagree', 'name-rep');
    const raw = e.sample || {};
    if (e.count > 1) cls.push('aggregated');
    if (raw.resolution === 'url-only') cls.push('url-only');
    // "Which remotes am I actually working with?" A remote nobody tracks is
    // configuration; the one the checked-out branch tracks is the live one.
    if (e.kind === 'remote' && raw.tracking) cls.push('trk-' + raw.tracking);
    const scope = extras.remoteScope || 'all';
    if (e.kind === 'remote' && scope !== 'all') {
      const ok = scope === 'current' ? raw.tracking === 'current'
        : raw.tracking === 'current' || raw.tracking === 'branch';
      if (!ok) cls.push('out-of-scope');
    }
    if (raw.verdict) cls.push('verdict-' + raw.verdict);
    if (model.byId[e.source] && model.byId[e.source].inactive) cls.push('inactive');
    if (e.names && e.names.length > 1) cls.push('disagree');
    els.push({
      group: 'edges',
      data: {
        id: e.id, source: e.source, target: e.target,
        label: edgeLabel(e), count: e.count, kind: e.kind,
        names: e.names || [], members: e.members, raw,
      },
      classes: cls.join(' '),
    });
  }
  return els;
}

// -------------------------------------------------------------------- style

export function cyStyle(theme) {
  const p = PALETTES[theme] || PALETTES.dark;
  return [
    { selector: 'node', style: {
      'background-color': p.nodeFill, 'border-color': p.nodeBorder, 'border-width': 1.5,
      shape: 'round-rectangle', width: 'data(w)', height: 'data(h)',
      label: 'data(short)', color: p.nodeText,
      'font-family': 'ui-monospace, SFMono-Regular, Menlo, monospace', 'font-size': 12,
      'text-valign': 'center', 'text-halign': 'center', 'text-wrap': 'wrap',
      'text-max-width': 186, 'text-margin-y': -8, 'z-index': 10,
      'min-zoomed-font-size': 0,
    }},
    { selector: 'node.dist', style: {
      label: (n) => {
        // Badges lead, because they must survive being read at fit zoom where
        // the label text itself is ~7 px.
        const bits = [];
        if (n.data('badges')) bits.push(n.data('badges'));
        bits.push(n.data('short'));
        if (n.data('chips')) bits.push(n.data('chips'));
        if (n.data('names')) bits.push(n.data('names'));
        return bits.join('\n');
      },
      'text-margin-y': 0, 'line-height': 1.3,
    }},
    { selector: 'node.container', style: {
      'background-color': p.clusterFill, 'background-opacity': 1,
      'border-color': p.clusterBorder, 'border-width': 1.5,
      shape: 'round-rectangle',
      label: (n) => [n.data('short'), n.data('badges')].filter(Boolean).join('  '),
      color: p.clusterText, 'font-size': 15, 'font-weight': 'bold',
      'font-family': 'ui-sans-serif, system-ui, sans-serif',
      'text-valign': 'top', 'text-halign': 'center', 'text-margin-y': 22,
      'text-max-width': 600, 'z-index': 1, 'z-index-compare': 'manual',
    }},
    { selector: 'node.host.container', style: { 'border-style': 'solid' } },
    { selector: 'node.dist.container', style: {
      'border-color': p.store, 'border-style': 'dashed', 'border-width': 2.5,
      color: p.store, 'background-color': p.nodeFill, 'background-opacity': 0.55,
      'z-index': 2, 'z-index-compare': 'manual', 'text-margin-y': 20,
      label: (n) => [n.data('short'), n.data('chips')].filter(Boolean).join('   ·   '),
    }},
    { selector: 'node.collapsed', style: {
      'border-style': 'double', 'border-width': 3, 'z-index': 10,
      'text-valign': 'center', 'text-margin-y': 0,
    }},
    { selector: 'node.hk-forge', style: { 'border-color': p.forge, color: p.forge } },
    { selector: 'node.hk-cloud', style: { 'border-color': p.cloud, color: p.cloud } },
    { selector: 'node.hk-store', style: { 'border-color': p.store, color: p.store } },
    { selector: 'node.seed', style: {
      'border-color': p.seed, 'border-width': 3.5, 'background-color': p.seedFill, color: p.nodeText,
    }},
    { selector: 'node.special', style: { 'border-style': 'dashed', 'border-color': p.special } },
    { selector: 'node.lay-bare', style: { shape: 'cut-rectangle' } },
    { selector: 'node.dead', style: { 'border-color': p.dead, color: p.nodeSub, opacity: 0.7 } },
    { selector: 'node.inactive', style: {
      'background-color': p.inactive, 'border-color': p.inactiveBorder,
      color: p.inactiveText, 'border-width': 1,
    }},
    { selector: 'node.upstream', style: { 'border-color': p.seed, 'border-width': 2.5 } },
    { selector: 'node.template', style: { 'border-style': 'dotted', 'border-color': p.candidate } },
    { selector: 'node.unmerged', style: { 'border-color': p.warn, 'border-width': 2.5 } },
    { selector: 'node.dup-uuid', style: {
      'border-color': p.err, 'border-width': 5, 'background-color': p.errFill,
      'border-style': 'double', color: p.nodeText, 'z-index': 20,
    }},
    { selector: 'node.disagree', style: {
      'border-color': p.disagree, 'border-width': 3.5, 'background-color': p.disagreeFill,
      color: p.disagree,
    }},
    { selector: 'node.frontier', style: { 'border-style': 'dashed' } },
    { selector: 'node:selected', style: {
      'overlay-color': p.seed, 'overlay-opacity': 0.22, 'overlay-padding': 8, 'z-index': 30,
    }},
    { selector: 'node.hl', style: {
      'overlay-color': p.err, 'overlay-opacity': 0.3, 'overlay-padding': 10, 'z-index': 30,
    }},
    { selector: 'node.dimmed', style: { opacity: 0.25 } },

    { selector: 'edge', style: {
      width: 1.6, 'line-color': p.edge, 'target-arrow-color': p.edge,
      'target-arrow-shape': 'triangle', 'arrow-scale': 0.9,
      'curve-style': 'bezier', 'control-point-step-size': 60,
      label: '', color: p.edgeText, 'font-size': 12,
      'font-family': 'ui-monospace, SFMono-Regular, Menlo, monospace',
      'text-background-color': p.edgeLabelBg, 'text-background-opacity': 0.95,
      'text-background-padding': 3, 'text-background-shape': 'roundrectangle',
      'text-border-color': p.edge, 'text-border-width': 0.6, 'text-border-opacity': 0.7,
      'text-rotation': 'none', 'min-zoomed-font-size': 0,
      'text-events': 'yes', 'z-index': 5,
    }},
    // label-on-demand: only edges carrying .lbl draw text at all
    // A drawn label must not disappear under a container box: cytoscape puts
    // nodes above edges unless the edge opts into manual z-order.
    { selector: 'edge.lbl', style: {
      label: 'data(label)', 'z-index': 25, 'z-index-compare': 'manual',
    }},
    { selector: 'edge.aggregated', style: { width: 3.2, 'line-style': 'solid', opacity: 0.9 } },
    { selector: 'edge.url-only', style: { 'line-style': 'dashed', opacity: 0.7 } },
    { selector: 'edge.disagree', style: {
      'line-color': p.disagree, 'target-arrow-color': p.disagree, width: 2.8,
      color: p.disagree, 'text-border-color': p.disagree, 'text-border-width': 1.2,
      'font-weight': 'bold', 'z-index': 35, 'z-index-compare': 'manual',
    }},
    { selector: 'edge.k-fork_of', style: {
      'line-color': p.forge, 'target-arrow-color': p.forge, width: 1.1,
    }},
    { selector: 'edge.k-fork_of.inactive', style: { opacity: 0.3, width: 0.8 } },
    { selector: 'edge.k-worktree_of', style: {
      'line-color': p.ok, 'target-arrow-color': p.ok, 'line-style': 'dotted', width: 2,
    }},
    { selector: 'edge.k-same_annex_uuid', style: {
      'line-color': p.err, 'target-arrow-color': p.err, 'source-arrow-color': p.err,
      'source-arrow-shape': 'triangle', width: 4, 'z-index': 40,
      label: 'same annex UUID', color: p.err, 'font-weight': 'bold', 'font-size': 13,
      'text-background-color': p.errFill, 'text-background-opacity': 1,
      'text-background-padding': 4, 'text-border-color': p.err, 'text-border-width': 1.2,
      'z-index-compare': 'manual',
    }},
    { selector: 'edge.k-candidate_same_as', style: {
      'line-color': p.candidate, 'target-arrow-color': p.candidate, 'line-style': 'dashed', width: 2.4,
    }},
    { selector: 'edge.verdict-rejected', style: {
      'line-color': p.warn, 'target-arrow-color': p.warn, 'target-arrow-shape': 'tee',
    }},
    { selector: 'edge.k-shares_history_with', style: {
      'line-color': p.candidate, 'target-arrow-color': p.candidate, 'line-style': 'dotted', width: 1.6,
    }},
    { selector: 'edge.k-part, edge.k-subdataset', style: { 'line-style': 'dashed', opacity: 0.65 } },
    { selector: 'edge:selected', style: { width: 4, 'line-color': p.seed, 'target-arrow-color': p.seed } },
    { selector: 'node.overlapping', style: {
      'border-color': p.warn, 'border-width': 3, 'border-style': 'dashed',
    } },
    { selector: 'edge.trk-current', style: { width: 3.4, opacity: 1 } },
    { selector: 'edge.trk-none', style: { 'line-style': 'dotted', opacity: 0.55 } },
    { selector: 'edge.out-of-scope', style: { opacity: 0.06, label: '' } },
    { selector: 'edge.dimmed', style: { opacity: 0.07, label: '' } },
    { selector: 'edge.hl', style: {
      'line-color': p.err, 'target-arrow-color': p.err, width: 4.5, 'z-index': 40,
    }},
  ];
}

export function makeCy(container, theme) {
  return cytoscape({
    container,
    style: cyStyle(theme),
    wheelSensitivity: 0.2,
    minZoom: 0.05,
    maxZoom: 4,
    boxSelectionEnabled: false,
    textureOnViewport: false,
  });
}
