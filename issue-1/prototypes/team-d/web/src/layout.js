// The two-tier layout orchestrator (main thread side).
//
// Tier 1  containers (hosts, RIA stores, superdatasets) get world geometry
//         from a whole-graph Graphviz pass over the CONTAINER graph only.
//         It runs when the set of containers changes -- not on every
//         expansion.
// Tier 2  leaves get container-LOCAL coordinates from fcose, run per
//         container, with already-placed siblings pinned.
//
// Everything a leaf's world position depends on is (container centre) +
// (local offset). An expansion inside a container therefore cannot move
// anything outside it: that is the whole design, and `metrics` below measures
// whether it actually holds.

import {
  LEAF, measureBoxes, separate, displacement, rectOf, overlaps, findFreeSpot,
} from './geometry.js';

let seq = 0;
const pending = new Map();
let worker = null;

export function startWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./layout-worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = (ev) => {
    const { id, ok, result, error, workerMs } = ev.data || {};
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    if (ok) p.resolve({ ...result, workerMs });
    else p.reject(new Error(error));
  };
  worker.onerror = (e) => { console.error('[layout worker]', e.message || e); };
  return worker;
}

export function call(t, payload) {
  startWorker();
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, t, payload });
  });
}

export function workerAlive() { return !!worker; }

// --------------------------------------------------------------- the state

export class TwoTierLayout {
  constructor() {
    this.centre = new Map();     // top-level id -> world {x,y}
    this.local = new Map();      // non-top-level id -> local {x,y} from parent centre
    this.size = new Map();       // every visible id -> {w,h,...}
    this.lastTop = new Set();
    this.lastKids = new Map();   // container id -> Set of child ids at last layout
    this.tier1Runs = 0;
    this.tier2Runs = 0;
    this.lastDot = '';
    this.timings = {};
  }

  /** World position of a node's TOP-LEFT corner. This is the frame tier 2
   *  works in: a container that grows keeps its top-left where it is. */
  worldTopLeft(id, parentOf, guard = 0) {
    if (this.centre.has(id)) {
      const c = this.centre.get(id);
      const s = this.size.get(id) || LEAF;
      return { x: c.x - s.w / 2, y: c.y - s.h / 2 };
    }
    const p = parentOf(id);
    const l = this.local.get(id);
    if (!p || !l || guard > 24) return { x: 0, y: 0 };
    const t = this.worldTopLeft(p, parentOf, guard + 1);
    return { x: t.x + l.x, y: t.y + l.y };
  }

  /** World CENTRE, which is what cytoscape wants. */
  worldOf(id, parentOf) {
    if (this.centre.has(id)) return this.centre.get(id);
    const t = this.worldTopLeft(id, parentOf);
    const s = this.size.get(id) || LEAF;
    return { x: t.x + s.w / 2, y: t.y + s.h / 2 };
  }

  allWorld(ids, parentOf) {
    const m = new Map();
    for (const id of ids) m.set(id, { ...this.worldOf(id, parentOf) });
    return m;
  }

  /**
   * @param g {
   *   ids: [visible ids],
   *   parentOf(id) -> parent id or null (visible parents only),
   *   childrenOf(id) -> [visible child ids] ([] for collapsed containers),
   *   labelOf(id), edges: [{id,source,target,kind}]
   * }
   * @param opts { mode: 'sticky'|'full', reason }
   */
  async run(g, opts = {}) {
    const mode = opts.mode || 'sticky';
    const t0 = performance.now();
    const ids = g.ids;
    const before = this.allWorld(ids.filter((i) => this.centre.has(i) || this.local.has(i)), g.parentOf);
    const beforeCentres = new Map([...this.centre].map(([k, v]) => [k, { ...v }]));

    const topLevel = ids.filter((i) => !g.parentOf(i));
    const beforeSizes = new Map([...this.size].map(([k, v]) => [k, { ...v }]));
    this.size = measureBoxes(topLevel, g.childrenOf, () => LEAF);

    // ---------------------------------------------------------- tier 1
    const topSet = new Set(topLevel);
    const topChanged = topSet.size !== this.lastTop.size
      || [...topSet].some((i) => !this.lastTop.has(i));
    let tier1 = null;
    // Any box whose size CHANGED, in either direction. Shrinking has to be
    // anchored exactly like growing: an earlier build left the centre fixed
    // when a container collapsed, so collapse-then-expand walked the whole box
    // half its own width (890 px in s3).
    const grew = new Set();
    for (const id of topLevel) {
      const prev = this.centre.get(id);
      if (prev && prev._w !== undefined) {
        const s = this.size.get(id);
        if (Math.abs(s.w - prev._w) > 0.5 || Math.abs(s.h - prev._h) > 0.5) grew.add(id);
      }
    }

    if (topChanged || mode === 'full' || !this.centre.size) {
      const items = topLevel.map((id) => ({
        id, label: g.labelOf(id), w: this.size.get(id).w, h: this.size.get(id).h,
      }));
      const agg = aggregateTopEdges(g, topLevel);
      const t = performance.now();
      tier1 = await call('tier1', { items, edges: agg });
      this.timings.tier1Ms = +(performance.now() - t).toFixed(1);
      this.timings.gvMs = tier1.gvMs;
      if (tier1.gvLoadMs) this.timings.gvLoadMs = tier1.gvLoadMs;
      this.lastDot = tier1.dot;
      this.tier1Runs += 1;

      const fresh = new Map(topLevel.map((id) => [id, tier1.pos[id] || { x: 0, y: 0 }]));
      if (mode === 'sticky' && this.centre.size) {
        // Keep every container that is already on screen exactly where it is.
        // Only the containers that are new take Graphviz's answer, shifted by
        // the translation that best aligns the two layouts, and then pushed
        // out of the way of the existing ones.
        const shared = topLevel.filter((i) => this.centre.has(i));
        let dx = 0, dy = 0;
        if (shared.length) {
          for (const i of shared) {
            dx += this.centre.get(i).x - fresh.get(i).x;
            dy += this.centre.get(i).y - fresh.get(i).y;
          }
          dx /= shared.length; dy /= shared.length;
        }
        const next = new Map(shared.map((i) => [i, { ...this.centre.get(i) }]));
        const occupied = shared.map((i) => ({ centre: next.get(i), size: this.size.get(i) }));
        // new containers, in the order Graphviz ranked them, each dropped into
        // the nearest free spot to where Graphviz wanted it
        const fresh2 = topLevel.filter((i) => !this.centre.has(i))
          .sort((a, b) => (fresh.get(a).x - fresh.get(b).x) || (fresh.get(a).y - fresh.get(b).y));
        let rings = 0;
        for (const id of fresh2) {
          const want = { x: fresh.get(id).x + dx, y: fresh.get(id).y + dy };
          const spot = findFreeSpot(want, this.size.get(id), occupied, 60);
          rings += Math.max(0, spot.rings);
          const c = { x: spot.x, y: spot.y };
          next.set(id, c);
          occupied.push({ centre: c, size: this.size.get(id) });
        }
        this.timings.placementRings = rings;
        this.centre = new Map(topLevel.map((i) => [i, { ...next.get(i) }]));
      } else {
        this.centre = fresh;
      }
    } else if (grew.size) {
      // No new containers. A container that grew absorbs the growth IN PLACE:
      // its top-left corner stays exactly where it was and the box extends
      // right and down, which is why nothing inside it moves (tier-2 offsets
      // are measured from that corner) and why it never slides out of its own
      // parent. Only neighbours that no longer fit are translated, rigidly.
      const sizes = new Map(topLevel.map((i) => [i, this.size.get(i)]));
      const centres = new Map(topLevel.map((i) => [i, { ...this.centre.get(i) }]));
      for (const id of grew) {
        const old = this.centre.get(id);
        const s = this.size.get(id);
        centres.set(id, { x: old.x + (s.w - old._w) / 2, y: old.y + (s.h - old._h) / 2 });
      }
      let sep = anyOverlap(centres, sizes, 60)
        ? separate(centres, sizes, grew, 60, 200)
        : { positions: centres, moved: new Map(), iterations: 0, converged: true };
      if (!sep.converged) {
        // could not make room by translation: fall back to a full tier-1 pass
        this.timings.growthFallbackToTier1 = (this.timings.growthFallbackToTier1 || 0) + 1;
        const items = topLevel.map((id) => ({
          id, label: g.labelOf(id), w: this.size.get(id).w, h: this.size.get(id).h,
        }));
        tier1 = await call('tier1', { items, edges: aggregateTopEdges(g, topLevel) });
        this.tier1Runs += 1;
        sep = { positions: new Map(topLevel.map((id) => [id, tier1.pos[id] || { x: 0, y: 0 }])) };
      }
      this.centre = new Map(topLevel.map((i) => [i, { ...sep.positions.get(i) }]));
      this.timings.separatedAfterGrowth = sep.moved ? sep.moved.size : -1;
    }
    for (const id of topLevel) {
      const s = this.size.get(id);
      const c = this.centre.get(id);
      if (c) { c._w = s.w; c._h = s.h; }
    }

    // ---------------------------------------------------------- tier 2
    const tier2Log = [];
    const order = [];
    const walk = (id) => {
      const kids = g.childrenOf(id) || [];
      if (kids.length) { order.push(id); kids.forEach(walk); }
    };
    topLevel.forEach(walk);

    for (const cid of order) {
      const kids = g.childrenOf(cid);
      const prev = this.lastKids.get(cid) || new Set();
      const same = kids.length === prev.size && kids.every((k) => prev.has(k));
      if (same && kids.every((k) => this.local.has(k))) continue;
      const box = this.size.get(cid);
      const fixed = {};
      for (const k of kids) if (prev.has(k) && this.local.has(k)) fixed[k] = this.local.get(k);
      const kidSet = new Set(kids);
      const inner = g.edges.filter((e) => e.kind !== 'contains'
        && kidSet.has(e.source) && kidSet.has(e.target));
      const t = performance.now();
      const r = await call('tier2', {
        box,
        children: kids.map((k) => ({ id: k, w: this.size.get(k).w, h: this.size.get(k).h })),
        fixed,
        edges: inner.map((e) => ({ id: e.id, source: e.source, target: e.target })),
      });
      this.tier2Runs += 1;
      tier2Log.push({
        container: cid, kids: kids.length, pinned: r.pinned, engine: r.engine,
        fcoseMs: r.fcoseMs, ms: +(performance.now() - t).toFixed(1),
      });
      for (const k of kids) this.local.set(k, r.pos[k]);
      this.lastKids.set(cid, kidSet);
    }
    // NOTE: `lastKids` and `local` are deliberately NOT cleared for containers
    // that just got collapsed. Re-expanding one then restores its children's
    // exact previous local coordinates without running tier 2 at all, so a
    // collapse/expand round trip is a 0 px operation.
    this.lastTop = topSet;

    // ---------------------------------------------------------- metrics
    const after = this.allWorld(ids, g.parentOf);
    const isContainer = (i) => (g.childrenOf(i) || []).length > 0;
    const beforeC = new Map(), afterC = new Map(), beforeL = new Map(), afterL = new Map();
    const beforeCorner = new Map(), afterCorner = new Map();
    const beforeBest = new Map(), afterBest = new Map();
    for (const [id, p] of before) {
      if (!after.has(id)) continue;
      if (isContainer(id)) {
        beforeC.set(id, p); afterC.set(id, after.get(id));
        // The top-left corner is what a viewer actually sees move. A box that
        // absorbs growth by extending to the right has a corner displacement
        // of 0 and a centre displacement of half the growth.
        const s0 = beforeSizes.get(id), s1 = this.size.get(id);
        if (s0 && s1) {
          beforeCorner.set(id, { x: p.x - s0.w / 2, y: p.y - s0.h / 2 });
          afterCorner.set(id, { x: after.get(id).x - s1.w / 2, y: after.get(id).y - s1.h / 2 });
          // the corner that moved least: "did any edge of this box stay put?"
          let bx = Infinity, by = Infinity, bd = Infinity;
          for (const sx of [1, -1]) {
            for (const sy of [1, -1]) {
              const dx = (after.get(id).x + sx * s1.w / 2) - (p.x + sx * s0.w / 2);
              const dy = (after.get(id).y + sy * s1.h / 2) - (p.y + sy * s0.h / 2);
              if (Math.hypot(dx, dy) < bd) { bd = Math.hypot(dx, dy); bx = dx; by = dy; }
            }
          }
          beforeBest.set(id, { x: 0, y: 0 });
          afterBest.set(id, { x: bx, y: by });
        }
      } else { beforeL.set(id, p); afterL.set(id, after.get(id)); }
    }
    const grownOrFocus = new Set([...grew, ...(opts.focus ? [opts.focus] : [])]);
    const beforeCO = new Map(), afterCO = new Map();
    for (const [id, p] of beforeC) {
      if (grownOrFocus.has(id)) continue;
      beforeCO.set(id, p); afterCO.set(id, afterC.get(id));
    }
    const metrics = {
      reason: opts.reason || '',
      mode,
      totalMs: +(performance.now() - t0).toFixed(1),
      tier1Ran: !!tier1,
      tier1Runs: this.tier1Runs,
      tier2Runs: tier2Log.length,
      tier2: tier2Log,
      containers: displacement(beforeC, afterC),
      containersCorner: displacement(beforeCorner, afterCorner),
      containersAnchor: displacement(beforeBest, afterBest),
      containersOther: displacement(beforeCO, afterCO),
      grown: [...grew],
      focus: opts.focus && before.has(opts.focus) && after.has(opts.focus)
        ? +Math.hypot(after.get(opts.focus).x - before.get(opts.focus).x,
          after.get(opts.focus).y - before.get(opts.focus).y).toFixed(2)
        : null,
      leaves: displacement(beforeL, afterL),
      timings: { ...this.timings },
      counts: { visible: ids.length, containers: beforeC.size + (ids.filter(isContainer).length - beforeC.size) },
    };
    if (opts.inside) {
      const inSet = new Set(opts.inside);
      const bi = new Map(), ai = new Map(), bo = new Map(), ao = new Map();
      for (const [id, p] of beforeL) {
        (inSet.has(id) ? bi : bo).set(id, p);
        (inSet.has(id) ? ai : ao).set(id, afterL.get(id));
      }
      metrics.leavesInside = displacement(bi, ai);
      metrics.leavesOutside = displacement(bo, ao);
    }
    return { positions: after, sizes: this.size, metrics, beforeCentres };
  }
}

function anyOverlap(centres, sizes, margin) {
  const ids = [...centres.keys()];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      if (overlaps(rectOf(centres.get(ids[i]), sizes.get(ids[i]), margin / 2),
        rectOf(centres.get(ids[j]), sizes.get(ids[j]), margin / 2))) return true;
    }
  }
  return false;
}

/** Every visible relation edge, mapped onto the top-level box each end lives
 *  in, then aggregated. This is the same aggregation the collapse tier uses --
 *  Graphviz never sees 40 parallel edges. */
export function aggregateTopEdges(g, topLevel) {
  const top = new Set(topLevel);
  const rootOf = (id) => {
    let cur = id, guard = 0;
    while (!top.has(cur) && guard++ < 20) {
      const p = g.parentOf(cur);
      if (!p) break;
      cur = p;
    }
    return cur;
  };
  const agg = new Map();
  for (const e of g.edges) {
    if (e.kind === 'contains') continue;
    const a = rootOf(e.source), b = rootOf(e.target);
    if (!top.has(a) || !top.has(b) || a === b) continue;
    const k = a + ' ' + b;
    const rec = agg.get(k) || { a, b, count: 0 };
    rec.count += 1;
    agg.set(k, rec);
  }
  return [...agg.values()].sort((p, q) => (p.a + p.b).localeCompare(q.a + q.b));
}
