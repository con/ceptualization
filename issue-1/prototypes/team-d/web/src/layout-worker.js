// Both layout tiers run in here, off the main thread.
//
//   tier 1  @hpcc-js/wasm Graphviz `dot` over the container graph
//   tier 2  cytoscape 3.34 headless + fcose 2.2.0 over one container's leaves,
//           in container-local coordinates, with already-placed leaves pinned
//
// Neither library needs the DOM. cytoscape is created with headless:true and
// styleEnabled:true (fcose reads node width/height through the style system,
// so styleEnabled cannot be turned off).

import { Graphviz } from '@hpcc-js/wasm/graphviz';
import cytoscape from 'cytoscape';
import fcose from 'cytoscape-fcose';
import { containerDot, parseGraphvizJson } from './dot.js';
import { slotPositions, innerBounds, clampTo, separate, PAD } from './geometry.js';

const PAD_FALLBACK = 24;

cytoscape.use(fcose);

let gv = null;
let gvLoadMs = null;

async function graphviz() {
  if (!gv) {
    const t = performance.now();
    gv = await Graphviz.load();
    gvLoadMs = +(performance.now() - t).toFixed(1);
  }
  return gv;
}

async function tier1({ items, edges, opts }) {
  const g = await graphviz();
  const dot = containerDot(items, edges, opts || {});
  const t = performance.now();
  const raw = g.layout(dot, 'json', 'dot');
  const parsed = parseGraphvizJson(raw);
  return {
    pos: parsed.pos, bb: parsed.bb, dot,
    gvMs: +(performance.now() - t).toFixed(1), gvLoadMs,
  };
}

/**
 * @param box       {w,h,cols,rows,cell} from geometry.measureBoxes
 * @param children  [{id,w,h}]
 * @param fixed     {id:{x,y}} already-placed children, TOP-LEFT offsets from
 *                  the container's own top-left corner
 * @param edges     [{id,source,target}] edges with both ends in this container
 *
 * fcose works in centres, so offsets are converted on the way in and back on
 * the way out. Everything the caller sees is a top-left offset.
 */
function tier2({ box, children, fixed, edges }) {
  const t0 = performance.now();
  const fixedIds = new Set(Object.keys(fixed || {}));
  const sizeOf = Object.fromEntries(children.map((c) => [c.id, { w: c.w, h: c.h }]));
  const toCentre = (id, p) => ({ x: p.x + sizeOf[id].w / 2, y: p.y + sizeOf[id].h / 2 });
  const toTopLeft = (id, p) => ({ x: p.x - sizeOf[id].w / 2, y: p.y - sizeOf[id].h / 2 });
  const slots = slotPositions(box);
  // free slots, in reading order, for children we have never placed
  const taken = new Set();
  for (const id of fixedIds) {
    let best = -1, bd = Infinity;
    slots.forEach((s, i) => {
      if (taken.has(i)) return;
      const d = Math.hypot(s.x - fixed[id].x, s.y - fixed[id].y);
      if (d < bd) { bd = d; best = i; }
    });
    if (best >= 0) taken.add(best);
  }
  const freeSlots = slots.filter((_, i) => !taken.has(i));

  const seeded = {};       // top-left offsets
  let f = 0;
  for (const c of children) {
    if (fixedIds.has(c.id)) { seeded[c.id] = { ...fixed[c.id] }; continue; }
    seeded[c.id] = freeSlots[f] ? { ...freeSlots[f] } : { x: PAD_FALLBACK, y: PAD_FALLBACK };
    f += 1;
  }

  // A fan of 40 per-subject repos has no edges among its members: fcose has
  // nothing to optimise there and its tiling reorders them (sub-001, sub-004,
  // sub-013 in one row). Placing them straight onto the slot grid is faster,
  // reproducible, and reads in order. fcose is used where it earns its keep:
  // containers whose children are actually connected to each other.
  if (!edges || !edges.length) {
    const pos0 = {};
    for (const c of children) pos0[c.id] = fixedIds.has(c.id) ? { ...fixed[c.id] } : seeded[c.id];
    return {
      pos: pos0, engine: 'grid', fcoseMs: 0, pinned: fixedIds.size,
      ms: +(performance.now() - t0).toFixed(1), sepIterations: 0, sepConverged: true,
    };
  }

  let engine = 'fcose';
  let out = seeded;
  let fcoseMs = 0;
  try {
    const cy = cytoscape({
      headless: true,
      styleEnabled: true,
      style: [{ selector: 'node', style: { shape: 'rectangle', width: 'data(w)', height: 'data(h)' } }],
      elements: {
        nodes: children.map((c) => ({
          data: { id: c.id, w: c.w, h: c.h }, position: toCentre(c.id, seeded[c.id]),
        })),
        edges: (edges || []).map((e) => ({
          data: { id: e.id, source: e.source, target: e.target },
        })),
      },
    });
    const opts = {
      name: 'fcose',
      quality: 'proof',
      randomize: false,
      animate: false,
      fit: false,
      packComponents: true,
      tile: true,
      tilingPaddingVertical: 20,
      tilingPaddingHorizontal: 20,
      nodeDimensionsIncludeLabels: false,
      uniformNodeDimensions: true,
      nodeRepulsion: 12000,
      idealEdgeLength: 140,
      edgeElasticity: 0.25,
      gravity: 0.4,
      numIter: 1200,
    };
    if (fixedIds.size) {
      opts.fixedNodeConstraint = [...fixedIds]
        .filter((id) => cy.getElementById(id).nonempty())
        .map((id) => ({ nodeId: id, position: toCentre(id, fixed[id]) }));
      if (!opts.fixedNodeConstraint.length) delete opts.fixedNodeConstraint;
    }
    const t1 = performance.now();
    const l = cy.layout(opts);
    l.run();                      // headless fcose is synchronous when animate:false
    fcoseMs = +(performance.now() - t1).toFixed(1);
    out = {};
    cy.nodes().forEach((n) => {
      out[n.id()] = toTopLeft(n.id(), { x: n.position('x'), y: n.position('y') });
    });
    cy.destroy();
  } catch (err) {
    engine = 'grid-fallback:' + (err && err.message ? err.message : err);
    out = seeded;
  }

  // Pinned children are pinned: fcose is trusted but verified.
  for (const id of fixedIds) if (out[id]) out[id] = { ...fixed[id] };

  // Clamp the free ones inside the box, then push apart, keeping pins frozen.
  const sizes = new Map(children.map((c) => [c.id, { w: c.w, h: c.h }]));
  const centres = new Map();
  for (const c of children) {
    const b = innerBounds(box, c);
    const tl = fixedIds.has(c.id) ? out[c.id] : clampTo(out[c.id], b);
    centres.set(c.id, toCentre(c.id, tl));
  }
  const sep = separate(centres, sizes, fixedIds, 18, 250);
  let pos = {};
  for (const c of children) {
    const b = innerBounds(box, c);
    pos[c.id] = fixedIds.has(c.id)
      ? { ...fixed[c.id] }
      : clampTo(toTopLeft(c.id, sep.positions.get(c.id)), b);
  }
  // fcose's answer is accepted only if it can be made overlap-free inside the
  // box. Clamping a force-directed result into a fixed rectangle can pile
  // nodes up against the wall -- in s3, 63 forks landed on top of the upstream
  // they were attracted to (191 overlapping pairs). When that happens the
  // container falls back to its slot grid, which cannot overlap by
  // construction and reads in id order.
  let clashes = 0;
  const ids = children.map((c) => c.id);
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = pos[ids[i]], bb = pos[ids[j]];
      const sa = sizeOf[ids[i]], sb = sizeOf[ids[j]];
      if (a.x < bb.x + sb.w && bb.x < a.x + sa.w && a.y < bb.y + sb.h && bb.y < a.y + sa.h) clashes += 1;
    }
  }
  if (clashes) {
    engine = `grid-after-${engine}-overlapped(${clashes})`;
    pos = {};
    let k = 0;
    for (const c of children) {
      pos[c.id] = fixedIds.has(c.id) ? { ...fixed[c.id] } : { ...(freeSlots[k] || slots[0]) };
      if (!fixedIds.has(c.id)) k += 1;
    }
  }
  return {
    pos, engine, fcoseMs, pinned: fixedIds.size, clashes,
    ms: +(performance.now() - t0).toFixed(1),
    sepIterations: sep.iterations, sepConverged: sep.converged,
  };
}

self.onmessage = async (ev) => {
  const { id, t, payload } = ev.data || {};
  const t0 = performance.now();
  try {
    let result;
    if (t === 'tier1') result = await tier1(payload);
    else if (t === 'tier2') result = tier2(payload);
    else if (t === 'warm') { await graphviz(); result = { gvLoadMs }; }
    else throw new Error('unknown message ' + t);
    self.postMessage({ id, ok: true, result, workerMs: +(performance.now() - t0).toFixed(1) });
  } catch (err) {
    self.postMessage({ id, ok: false, error: String((err && err.stack) || err) });
  }
};
