// Label-on-demand.
//
// The bake-off's first shared failure: at the fit zoom the apps chose (0.475 -
// 0.570), 9 px edge labels rendered at 4.3 - 5.1 CSS px and the remote-name
// story -- the reason issue #1 exists -- was invisible. Two fixes, applied
// together:
//
//   1. Almost no edge is labelled. An edge draws its label only when it is
//      incident to the selection, when it is one of the relations that IS the
//      finding (same_annex_uuid, candidate_same_as), or when the names on it
//      disagree.
//   2. The labels that are drawn are drawn at a constant SCREEN size:
//      font-size is set to TARGET_PX / zoom on every zoom change, so a label
//      is 13 CSS px whether the map is fitted to 68 nodes or zoomed into one.
//
// Both are cheap because rule 1 keeps the labelled set to a handful of edges.

export const TARGET_PX = 13;
export const NODE_MIN_PX = 11;

export const ALWAYS_LABELLED = new Set(['same_annex_uuid', 'candidate_same_as']);

/** Decide which edges carry a label. Returns the count. */
export function applyLabelPolicy(cy, { mode = 'demand', selected = null } = {}) {
  const sel = selected ? cy.getElementById(selected) : null;
  const wanted = cy.collection();
  cy.edges().removeClass('lbl');
  if (mode === 'none') return 0;
  let set = cy.collection();
  if (mode === 'all') {
    set = cy.edges();
  } else {
    set = set.union(cy.edges().filter((e) => ALWAYS_LABELLED.has(e.data('kind'))));
    set = set.union(cy.edges('.disagree'));
    if (sel && sel.nonempty() && sel.isNode()) set = set.union(sel.connectedEdges());
    if (sel && sel.nonempty() && sel.isEdge()) set = set.union(sel);
  }
  set.addClass('lbl');
  wanted.merge(set);
  return set.length;
}

/** Keep every drawn label at a constant rendered size. */
export function compensateZoom(cy) {
  const z = cy.zoom() || 1;
  const fs = Math.min(60, Math.max(6, TARGET_PX / z));
  cy.batch(() => {
    cy.edges('.lbl').style({
      'font-size': fs,
      'text-background-padding': Math.max(2, 3 / z),
      'text-border-width': Math.max(0.4, 0.6 / z),
    });
    // Node text is NOT zoom-compensated: bumping it overflows the box and
    // collides with the neighbour, which an earlier build did visibly. The
    // node keeps a coloured border as a locator and the legible text lives on
    // the edges, where a remote name belongs anyway.
    cy.nodes('.disagree, .dup-uuid').style({ 'font-size': 13 });
  });
  return { zoom: z, edgeFontSize: fs, renderedPx: +(fs * z).toFixed(2) };
}

/** What a screenshot reviewer would measure with a ruler. */
export function measureRendered(cy) {
  const z = cy.zoom();
  const out = [];
  cy.edges('.lbl').forEach((e) => {
    out.push({
      id: e.id(), label: e.data('label'),
      fontSize: +e.numericStyle('font-size').toFixed(2),
      renderedPx: +(e.numericStyle('font-size') * z).toFixed(2),
    });
  });
  const nodes = [];
  cy.nodes('.disagree, .dup-uuid').forEach((n) => {
    nodes.push({
      id: n.id(),
      fontSize: +n.numericStyle('font-size').toFixed(2),
      renderedPx: +(n.numericStyle('font-size') * z).toFixed(2),
    });
  });
  const plain = cy.nodes('.dist').filter((n) => !n.hasClass('disagree') && !n.hasClass('dup-uuid'));
  return {
    zoom: +z.toFixed(3),
    edges: out,
    nodes,
    plainNodePx: plain.length ? +(plain[0].numericStyle('font-size') * z).toFixed(2) : null,
    labelledEdges: out.length,
    totalEdges: cy.edges().length,
  };
}
