// Tier 1 DOT: the CONTAINER graph only.
//
// Team B fed Graphviz the whole worldmap, with `subgraph cluster_*` for every
// host and a `rank=same` grid hack for every fan, and still had to snap the
// result back onto a grid afterwards. None of that is needed here, because the
// graph Graphviz sees has no clusters and no fans in it: it is ~10 rectangles
// whose sizes are already known, joined by aggregated edges. Everything inside
// a rectangle is tier 2's problem.
//
// The text below deliberately keeps team B's `id=` convention so the xdot
// `json` output maps straight back onto our node ids, and so a future
// `git annex map --dot` can be dropped in at the same seam.

function q(s) {
  return '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

/**
 * @param items [{id, w, h, label}]  top-level boxes, sizes in px
 * @param edges [{a, b, count, kind}] aggregated inter-box edges
 */
export function containerDot(items, edges, opts = {}) {
  const rankdir = opts.rankdir || 'LR';
  const ranksep = opts.ranksep ?? 1.4;
  const nodesep = opts.nodesep ?? 0.9;
  const out = [];
  out.push('digraph containers {');
  out.push(`  graph [rankdir=${rankdir}, ranksep="${ranksep}", nodesep="${nodesep}", `
    + 'splines=false, fontname="Helvetica"];');
  out.push('  node [shape=box, fixedsize=true, fontname="Helvetica", fontsize=11];');
  out.push('  edge [fontname="Helvetica", fontsize=9];');
  for (const it of items) {
    out.push(`  ${q(it.id)} [id=${q(it.id)}, label=${q(it.label || it.id)}, `
      + `width=${(it.w / 72).toFixed(3)}, height=${(it.h / 72).toFixed(3)}];`);
  }
  for (const e of edges) {
    const w = Math.min(10, 1 + Math.round(Math.log2(1 + (e.count || 1))));
    out.push(`  ${q(e.a)} -> ${q(e.b)} [weight=${w}, id=${q(e.a + '>' + e.b)}];`);
  }
  out.push('}');
  return out.join('\n') + '\n';
}

/** Parse the `json` (xdot) output: node centres in cytoscape coordinates. */
export function parseGraphvizJson(text) {
  const j = typeof text === 'string' ? JSON.parse(text) : text;
  const bb = String(j.bb || '0,0,0,0').split(',').map(Number);
  const bbTop = bb[3];
  const pos = {};
  for (const o of j.objects || []) {
    if (!o.pos) continue;
    const [x, y] = String(o.pos).split(',').map(Number);
    pos[o.id || o.name] = { x, y: bbTop - y };
  }
  return { pos, bb: { w: bb[2] - bb[0], h: bb[3] - bb[1] } };
}
