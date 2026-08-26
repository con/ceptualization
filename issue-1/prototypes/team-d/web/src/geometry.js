// Pure geometry for the two-tier layout. No cytoscape, no DOM: this module is
// imported by both the app and the tools, and every function here is a plain
// function of its inputs so the layout is reproducible.

export const LEAF = { w: 210, h: 76 };
export const GAP = 26;                        // between siblings inside a box
export const PAD = { top: 48, side: 30, bottom: 30 };

// A container is never sized to its exact occupancy: it is sized to the next
// slot tier above it. Growth inside a tier costs nothing at all -- no resize,
// no neighbour push, no leaf movement. This is the cheap half of "absorb
// growth by resizing in place".
export const SLOT_TIERS = [1, 2, 4, 6, 9, 12, 16, 24, 32, 48, 64, 96, 128, 192, 256];

export function tierFor(n) {
  for (const t of SLOT_TIERS) if (n <= t) return t;
  return Math.ceil(n / 64) * 64;
}

/** Grid shape for `slots` cells of size `cell`, aiming at a ~1.8:1 wide box. */
export function gridShape(slots, cell) {
  const target = 1.8;
  let cols = Math.max(1, Math.round(Math.sqrt((slots * (cell.h + GAP) * target) / (cell.w + GAP))));
  cols = Math.min(cols, slots);
  const rows = Math.ceil(slots / cols);
  return { cols, rows };
}

/**
 * Bottom-up size of every visible container.
 * `childrenOf(id)` -> array of visible child ids (empty for a leaf or for a
 * collapsed container). Returns Map id -> {w,h,cols,rows,cell,slots,kids}.
 */
export function measureBoxes(ids, childrenOf, leafSize = () => LEAF) {
  const out = new Map();
  const visit = (id) => {
    if (out.has(id)) return out.get(id);
    const kids = childrenOf(id) || [];
    if (!kids.length) {
      const s = leafSize(id);
      const rec = { ...s, cols: 0, rows: 0, cell: s, slots: 0, kids: 0 };
      out.set(id, rec);
      return rec;
    }
    let cw = 0, ch = 0;
    for (const k of kids) {
      const s = visit(k);
      cw = Math.max(cw, s.w);
      ch = Math.max(ch, s.h);
    }
    const cell = { w: cw, h: ch };
    const slots = tierFor(kids.length);
    const { cols, rows } = gridShape(slots, cell);
    const rec = {
      w: 2 * PAD.side + cols * cell.w + (cols - 1) * GAP,
      h: PAD.top + PAD.bottom + rows * cell.h + (rows - 1) * GAP,
      cols, rows, cell, slots, kids: kids.length,
    };
    out.set(id, rec);
    return rec;
  };
  for (const id of ids) visit(id);
  return out;
}

/**
 * Default grid slots inside a container, as TOP-LEFT offsets from the
 * container's own top-left corner.
 *
 * Everything in tier 2 is expressed in this frame on purpose. A container that
 * grows keeps its top-left corner where it is and expands right and down, so
 * every child keeps its offset unchanged -- and, because the box only grew on
 * the far sides, every child is still inside it. Centre-relative offsets
 * cannot do both at once: an earlier build kept children still and let a
 * nested RIA box slide out through the top of its host.
 */
export function slotPositions(box) {
  const { cols, rows, cell } = box;
  const out = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      out.push({ x: PAD.side + c * (cell.w + GAP), y: PAD.top + r * (cell.h + GAP) });
    }
  }
  return out;
}

/** Rectangle a child's TOP-LEFT must stay inside. */
export function innerBounds(box, child) {
  return {
    x1: PAD.side, x2: Math.max(PAD.side, box.w - PAD.side - child.w),
    y1: PAD.top, y2: Math.max(PAD.top, box.h - PAD.bottom - child.h),
  };
}

export function clampTo(p, b) {
  return { x: Math.min(b.x2, Math.max(b.x1, p.x)), y: Math.min(b.y2, Math.max(b.y1, p.y)) };
}

export function rectOf(centre, size, margin = 0) {
  return {
    x1: centre.x - size.w / 2 - margin, x2: centre.x + size.w / 2 + margin,
    y1: centre.y - size.h / 2 - margin, y2: centre.y + size.h / 2 + margin,
  };
}

export function overlaps(a, b) {
  return a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2;
}

/**
 * Minimum-translation separation of top-level boxes after one of them grew.
 *
 * `frozen` never moves (the container the user just expanded, and anything the
 * caller wants kept still). Everything else is pushed along its axis of least
 * penetration. This is the expensive half of "absorb growth in place": the
 * space has to come from somewhere, but it comes as a rigid translation of
 * whole containers, not as a re-layout that scatters their contents.
 *
 * Returns {moved: Map id->{dx,dy}, iterations, converged}.
 */
export function separate(centres, sizes, frozen = new Set(), margin = 40, maxIter = 60) {
  const ids = [...centres.keys()];
  const pos = new Map(ids.map((i) => [i, { ...centres.get(i) }]));
  let iterations = 0;
  let converged = false;
  for (; iterations < maxIter; iterations++) {
    let worst = 0;
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = ids[i], b = ids[j];
        const ra = rectOf(pos.get(a), sizes.get(a), margin / 2);
        const rb = rectOf(pos.get(b), sizes.get(b), margin / 2);
        if (!overlaps(ra, rb)) continue;
        const ox = Math.min(ra.x2, rb.x2) - Math.max(ra.x1, rb.x1);
        const oy = Math.min(ra.y2, rb.y2) - Math.max(ra.y1, rb.y1);
        worst = Math.max(worst, Math.min(ox, oy));
        const aFrozen = frozen.has(a), bFrozen = frozen.has(b);
        if (aFrozen && bFrozen) continue;
        const share = aFrozen || bFrozen ? 1 : 0.5;
        const pa = pos.get(a), pb = pos.get(b);
        if (ox < oy) {
          const dir = pa.x <= pb.x ? -1 : 1;
          if (!aFrozen) pa.x += dir * ox * share;
          if (!bFrozen) pb.x -= dir * ox * share;
        } else {
          const dir = pa.y <= pb.y ? -1 : 1;
          if (!aFrozen) pa.y += dir * oy * share;
          if (!bFrozen) pb.y -= dir * oy * share;
        }
      }
    }
    if (worst < 0.5) { converged = true; break; }
  }
  const moved = new Map();
  for (const id of ids) {
    const p = pos.get(id), q = centres.get(id);
    const dx = p.x - q.x, dy = p.y - q.y;
    if (Math.hypot(dx, dy) > 0.5) moved.set(id, { dx, dy });
  }
  return { positions: pos, moved, iterations, converged };
}

/**
 * Place a new box as close as possible to where tier 1 wanted it, without
 * overlapping anything already on the map. Used instead of a relaxation pass
 * for NEW containers, because relaxation in a crowded column can fail to
 * converge (it did: two hosts ended 5 px apart in an early build).
 */
export function findFreeSpot(want, size, occupied, margin = 60, step = 60, maxRings = 60) {
  const fits = (c) => {
    const r = rectOf(c, size, margin / 2);
    for (const o of occupied) if (overlaps(r, rectOf(o.centre, o.size, margin / 2))) return false;
    return true;
  };
  if (fits(want)) return { ...want, rings: 0 };
  for (let ring = 1; ring <= maxRings; ring++) {
    const d = ring * step;
    const cands = [];
    for (let a = 0; a < 16; a++) {
      const th = (a / 16) * Math.PI * 2;
      cands.push({ x: want.x + Math.cos(th) * d * 1.6, y: want.y + Math.sin(th) * d });
    }
    cands.sort((p, q) => Math.hypot(p.x - want.x, p.y - want.y) - Math.hypot(q.x - want.x, q.y - want.y));
    for (const c of cands) if (fits(c)) return { ...c, rings: ring };
  }
  return { ...want, rings: -1 };
}

/** Displacement stats between two id->{x,y} maps, over their shared keys. */
export function displacement(before, after) {
  const d = [];
  for (const [id, p] of before) {
    const q = after.get(id);
    if (!q) continue;
    d.push(Math.hypot(q.x - p.x, q.y - p.y));
  }
  if (!d.length) return { n: 0, median: 0, mean: 0, max: 0, moved: 0 };
  d.sort((a, b) => a - b);
  const sum = d.reduce((a, b) => a + b, 0);
  return {
    n: d.length,
    median: +d[Math.floor(d.length / 2)].toFixed(2),
    mean: +(sum / d.length).toFixed(2),
    max: +d[d.length - 1].toFixed(2),
    moved: d.filter((v) => v > 1).length,
  };
}
