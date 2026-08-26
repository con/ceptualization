/**
 * NESTED CONTAINMENT LAYOUT - the load-bearing answer to "sigma has no
 * compound nodes".
 *
 * sigma cannot nest nodes, but nothing stops us from computing a *nested*
 * layout ourselves and then handing sigma a flat list of absolute positions.
 * A container's geometry (centre + radius) is a first-class thing we keep in
 * `state.groups`, and the hull layer draws it. Containment therefore lives in
 * the LAYOUT and in a background canvas, not in the scene graph.
 *
 * Algorithm, per container, bottom-up:
 *   1. every child gets a radius (leaf = node size; container = its own packed
 *      radius, computed recursively);
 *   2. children are packed into an ANNULUS around the container's own node,
 *      relaxed by a small force pass that honours the edges *internal* to the
 *      container (so structure survives) with hard non-overlap constraints;
 *   3. the container reports the radius that encloses everything.
 * The root level is the same routine with a virtual container.
 *
 * Sizes are in graph-position units (sigma `itemSizesReference: "positions"`),
 * so a radius here is exactly a radius on screen.
 */

const LEAF_R = 9;          // leaf node radius in layout units
const PAD = 11;            // gap between siblings
const INNER = 16;         // annulus inner radius (room for the container node)
const GOLDEN = 2.399963229728653;

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function leafRadius(attrs) {
  if (attrs._meta) return Math.min(46, 16 + Math.sqrt(attrs._metaCount || 1) * 4.2);
  if (attrs.inactive) return LEAF_R * 0.62;
  if (attrs.ntype === "host") return LEAF_R * 1.25;
  const ahead = attrs._ahead || 0;
  return LEAF_R + Math.min(9, Math.sqrt(ahead) * 2.1);
}

/** Build the containment forest over the nodes currently present. */
export function buildTree(graph) {
  const kids = new Map(), present = new Set(graph.nodes());
  const roots = [];
  graph.forEachNode((n, a) => {
    if (a._collapsedInto) return;                 // hidden inside a meta node
    const p = a.parent;
    if (p && present.has(p) && !graph.getNodeAttribute(p, "_collapsedInto")) {
      if (!kids.has(p)) kids.set(p, []);
      kids.get(p).push(n);
    } else roots.push(n);
  });
  return { kids, roots };
}

/**
 * Force-pack `items` (each {id, r, x, y, warm}) into an annulus of inner
 * radius `inner`, honouring `links` (Map "a|b" -> weight).
 */
function pack(items, links, inner, rnd, warmOnly) {
  const n = items.length;
  if (n === 0) return inner;
  if (n === 1) {
    const it = items[0];
    if (inner <= 0) { it.x = 0; it.y = 0; return it.r; }
    // just far enough off-centre that the container's own node is still
    // clickable in the topology perspective, not a full annulus radius
    it.x = inner * 0.7; it.y = 0;
    return inner * 0.7 + it.r + PAD;
  }
  let area = 0;
  for (const it of items) area += (it.r + PAD) * (it.r + PAD) * Math.PI;
  const R0 = Math.max(inner + 20, Math.sqrt(area / Math.PI) * 1.45);
  let k = 0;
  for (const it of items) {
    if (it.warm && Number.isFinite(it.x)) continue;
    const i = k++;
    const t = (i + 0.5) / n;
    const ang = i * GOLDEN + rnd() * 0.4;
    const rad = inner + it.r + PAD + Math.sqrt(t) * R0;
    it.x = Math.cos(ang) * rad; it.y = Math.sin(ang) * rad;
  }
  const iters = warmOnly ? 40 : (n > 250 ? 70 : n > 80 ? 150 : 240);
  let maxR = 0;
  for (const it of items) maxR = Math.max(maxR, it.r);
  const cell = 2 * (maxR + PAD);
  const useGrid = n > 120;

  function separate(p, q) {
    let dx = q.x - p.x, dy = q.y - p.y;
    const d2 = dx * dx + dy * dy;
    const min = p.r + q.r + PAD;
    if (d2 > min * min) return;
    let d = Math.sqrt(d2);
    if (d < 1e-3) { dx = rnd() - 0.5; dy = rnd() - 0.5; d = Math.hypot(dx, dy) || 1e-4; }
    const push = ((min - d) / d) * 0.5;
    p.x -= dx * push; p.y -= dy * push;
    q.x += dx * push; q.y += dy * push;
  }

  for (let it = 0; it < iters; it++) {
    const cool = 1 - it / iters;
    for (const [key, w] of links) {
      const sep = key.indexOf("|");
      const A = items.byId.get(key.slice(0, sep));
      const B = items.byId.get(key.slice(sep + 1));
      if (!A || !B || A === B) continue;
      let dx = B.x - A.x, dy = B.y - A.y;
      const d = Math.hypot(dx, dy) || 1e-4;
      const target = A.r + B.r + PAD * 3;
      const f = ((d - target) / d) * 0.045 * Math.min(3, w) * cool;
      dx *= f; dy *= f;
      A.x += dx; A.y += dy; B.x -= dx; B.y -= dy;
    }
    if (useGrid) {
      const grid = new Map();
      for (const p of items) {
        const key = Math.floor(p.x / cell) + "," + Math.floor(p.y / cell);
        let b = grid.get(key);
        if (!b) grid.set(key, (b = []));
        b.push(p);
      }
      for (const p of items) {
        const gx = Math.floor(p.x / cell), gy = Math.floor(p.y / cell);
        for (let ox = -1; ox <= 1; ox++) {
          for (let oy = -1; oy <= 1; oy++) {
            const b = grid.get((gx + ox) + "," + (gy + oy));
            if (!b) continue;
            for (const q of b) if (q !== p) separate(p, q);
          }
        }
      }
    } else {
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) separate(items[i], items[j]);
    }
    for (const p of items) {
      const d = Math.hypot(p.x, p.y) || 1e-4;
      const minD = inner + p.r;
      if (d < minD) { p.x = (p.x / d) * minD; p.y = (p.y / d) * minD; }
      else { p.x -= p.x * 0.006 * cool; p.y -= p.y * 0.006 * cool; }
    }
  }
  // hard non-overlap finisher: no springs, no gravity, just separation
  for (let it = 0; it < 90; it++) {
    let moved = false;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const p = items[i], q = items[j];
        const min = p.r + q.r + PAD;
        const dx = q.x - p.x, dy = q.y - p.y;
        if (dx * dx + dy * dy < min * min) { separate(p, q); moved = true; }
      }
    }
    for (const p of items) {
      const d = Math.hypot(p.x, p.y) || 1e-4;
      const minD = inner + p.r;
      if (d < minD) { p.x = (p.x / d) * minD; p.y = (p.y / d) * minD; moved = true; }
    }
    if (!moved) break;
  }
  let rad = inner;
  for (const p of items) rad = Math.max(rad, Math.hypot(p.x, p.y) + p.r);
  return rad + PAD;
}

/**
 * @returns {{groups: Map, ms: number, roots: string[], kids: Map}}
 * groups: containerId -> {cx, cy, r, depth, members, label, kind}
 */
export function layoutWorld(graph, opts = {}) {
  const t0 = performance.now();
  const rnd = mulberry(opts.seed || 20260826);
  const { kids, roots } = buildTree(graph);
  const containerOf = new Map();
  graph.forEachNode((n, a) => {
    const p = a.parent;
    if (p && graph.hasNode(p) && !a._collapsedInto &&
        !graph.getNodeAttribute(p, "_collapsedInto")) containerOf.set(n, p);
  });

  function chain(n) {
    const out = []; let cur = n, g = 0;
    while (g++ < 64) { const p = containerOf.get(cur); if (p === undefined) break; out.push(p); cur = p; }
    return out;
  }
  function topOf(n) { const c = chain(n); return c.length ? c[c.length - 1] : n; }
  function itemUnder(node, container) {
    let cur = node, g = 0;
    while (g++ < 64) {
      const p = containerOf.get(cur);
      if (p === container) return cur;
      if (p === undefined) return null;
      cur = p;
    }
    return null;
  }

  // links, bucketed by the container in which both endpoints are siblings
  const linksByContainer = new Map();
  graph.forEachEdge((e, a, s, t) => {
    if (s === t) return;
    if (graph.getNodeAttribute(s, "_collapsedInto") ||
        graph.getNodeAttribute(t, "_collapsedInto")) return;
    if (a.kind === "contains") return;   // containment is geometry, not a spring
    const chainS = chain(s), chainT = chain(t);
    let common = null;
    for (const c of chainS) if (chainT.indexOf(c) >= 0) { common = c; break; }
    const key = common === null ? " root" : common;
    const A = common === null ? topOf(s) : itemUnder(s, common);
    const B = common === null ? topOf(t) : itemUnder(t, common);
    if (!A || !B || A === B) return;
    let m = linksByContainer.get(key);
    if (!m) linksByContainer.set(key, (m = new Map()));
    const k = A < B ? A + "|" + B : B + "|" + A;
    m.set(k, (m.get(k) || 0) + 1);
  });

  const groups = new Map();
  const local = new Map();       // node -> {x,y} relative to its container

  function place(container, items) {
    const links = linksByContainer.get(container === null ? " root" : container) || new Map();
    const arr = items.map((id) => {
      const a = graph.getNodeAttributes(id);
      const sub = kids.get(id);
      const r = (sub && sub.length) ? place(id, sub) + 14 : leafRadius(a);
      const hasPrev = opts.warm && a._lx !== undefined && Number.isFinite(a._lx);
      return { id, r, x: hasPrev ? a._lx : NaN, y: hasPrev ? a._ly : NaN, warm: hasPrev };
    });
    arr.byId = new Map(arr.map((i) => [i.id, i]));
    const allWarm = arr.length > 0 && arr.every((i) => i.warm);
    const inner = container === null ? 0 : INNER;
    const R = pack(arr, links, inner, rnd, !!opts.warm && allWarm);
    for (const it of arr) {
      local.set(it.id, { x: it.x, y: it.y });
      graph.setNodeAttribute(it.id, "_lx", it.x);
      graph.setNodeAttribute(it.id, "_ly", it.y);
    }
    if (container !== null) groups.set(container, { r: R, items: items.slice() });
    return R;
  }

  place(null, roots);

  function walk(id, ox, oy, d) {
    const l = local.get(id) || { x: 0, y: 0 };
    const x = ox + l.x, y = oy + l.y;
    graph.mergeNodeAttributes(id, { x, y, _depth: d });
    const g = groups.get(id);
    if (g) { g.cx = x; g.cy = y; g.depth = d; }
    const kk = kids.get(id);
    if (kk) for (const k of kk) walk(k, x, y, d + 1);
  }
  for (const r of roots) walk(r, 0, 0, 0);

  for (const [id, g] of groups) {
    const members = [];
    (function collect(c) {
      const kk = kids.get(c);
      if (kk) for (const k of kk) { members.push(k); collect(k); }
    })(id);
    g.members = members;
    g.label = graph.getNodeAttribute(id, "label");
    g.kind = graph.getNodeAttribute(id, "ntype") === "host"
      ? (graph.getNodeAttribute(id, "host_kind") || "host")
      : (graph.getNodeAttribute(id, "layout") || "container");
    g.id = id;
  }
  return { groups, ms: performance.now() - t0, roots, kids };
}
