// A saved view stores tier-1 boxes (world centre + size) and tier-2 offsets
// (a child's TOP-LEFT relative to its container's top-left). That is what
// keeps the diff of two consecutive saves small: moving or growing a container
// rewrites ONE line, not one line per child. Both the live app and the offline
// export reconstruct world positions here.

const LEAF = { w: 210, h: 76 };

export function sizesFromView(view) {
  const out = {};
  for (const [id, b] of Object.entries(view.containers || {})) out[id] = { w: b.w, h: b.h };
  for (const [id, b] of Object.entries(view.sizes || {})) out[id] = { w: b.w, h: b.h };
  return out;
}

export function worldPositions(view) {
  const containers = view.containers || {};
  const local = view.local || {};
  const sizes = sizesFromView(view);
  const sizeOf = (id) => sizes[id] || LEAF;
  const tl = {};
  const resolveTL = (id, guard = 0) => {
    if (tl[id]) return tl[id];
    const b = containers[id];
    if (b) { tl[id] = { x: b.x - b.w / 2, y: b.y - b.h / 2 }; return tl[id]; }
    const l = local[id];
    if (!l || guard > 32) return { x: 0, y: 0 };
    const base = l.in ? resolveTL(l.in, guard + 1) : { x: 0, y: 0 };
    tl[id] = { x: base.x + l.x, y: base.y + l.y };
    return tl[id];
  };
  const out = {};
  for (const id of [...Object.keys(containers), ...Object.keys(local)]) {
    const t = resolveTL(id);
    const s = sizeOf(id);
    out[id] = { x: t.x + s.w / 2, y: t.y + s.h / 2 };
  }
  return out;
}
