/**
 * Exploration history: undo / redo over the VIEW, never over the store.
 *
 * Two rules make this correct rather than merely plausible:
 *
 * 1. Undo removes what a step *revealed*, never what the crawl *learned*.
 *    `S.byId` is knowledge and is append-only, exactly as observations are in
 *    the store design. Undo shrinks `visible`; it never deletes a fact, so
 *    redo needs no refetch and an undone probe is never re-run.
 *
 * 2. A step snapshots container geometry, so undo restores positions instead
 *    of recomputing them. Team D's whole result is that expansion moves
 *    nothing; an undo that re-ran layout would move everything and throw that
 *    away. Because leaf positions are container-local, a snapshot is two small
 *    Maps regardless of how many leaves exist.
 */

const LIMIT = 100;

function snapMaps(layout) {
  return {
    centre: new Map([...layout.centre].map(([k, v]) => [k, { ...v }])),
    local: new Map([...layout.local].map(([k, v]) => [k, { ...v }])),
    size: new Map([...layout.size].map(([k, v]) => [k, { ...v }])),
  };
}

export class History {
  constructor(S) {
    this.S = S;
    this.past = [];
    this.future = [];
    this.onchange = () => {};
  }

  /** Capture the state a step is about to change. Call BEFORE mutating. */
  begin(label) {
    const S = this.S;
    this.past.push({
      label,
      visible: new Set(S.visible),
      collapsed: new Set(S.collapsed),
      hidden: new Set(S.hidden),
      expansions: S.expansions.slice(),
      layout: snapMaps(S.layout),
    });
    if (this.past.length > LIMIT) this.past.shift();
    this.future.length = 0;          // a new step invalidates the redo branch
    this.onchange();
  }

  /** Drop the pending entry when a step turned out to change nothing. */
  abandon() {
    this.past.pop();
    this.onchange();
  }

  _apply(entry) {
    const S = this.S;
    S.visible = new Set(entry.visible);
    S.collapsed = new Set(entry.collapsed);
    S.hidden = new Set(entry.hidden || []);
    // S.edges and S.byId are KNOWLEDGE and are never rolled back: edges are
    // filtered by `visible` at render time, so hiding a node hides its edges.
    // Truncating them would make redo impossible and would discard a crawled
    // fact to satisfy a view operation.
    S.expansions.splice(0, S.expansions.length, ...entry.expansions);
    S.layout.centre = entry.layout.centre;
    S.layout.local = entry.layout.local;
    S.layout.size = entry.layout.size;
  }

  _capture(label) {
    const S = this.S;
    return {
      label,
      visible: new Set(S.visible),
      collapsed: new Set(S.collapsed),
      hidden: new Set(S.hidden),
      expansions: S.expansions.slice(),
      layout: snapMaps(S.layout),
    };
  }

  canUndo() { return this.past.length > 0; }
  canRedo() { return this.future.length > 0; }

  /** Step back one. Returns the label undone, or null. */
  undo() {
    if (!this.past.length) return null;
    const entry = this.past.pop();
    this.future.push(this._capture(entry.label));
    this._apply(entry);
    this.onchange();
    return entry.label;
  }

  redo() {
    if (!this.future.length) return null;
    const entry = this.future.pop();
    this.past.push(this._capture(entry.label));
    this._apply(entry);
    this.onchange();
    return entry.label;
  }

  /** Jump back to just before step `i` of `past` (0 = the very beginning). */
  jumpTo(i) {
    if (i < 0 || i >= this.past.length) return null;
    let label = null;
    while (this.past.length > i) label = this.undo();
    return label;
  }

  /** Newest first, for rendering a list. */
  entries() {
    return this.past.map((e, i) => ({ i, label: e.label, nodes: e.visible.size }))
      .reverse();
  }

  reset() {
    this.past.length = 0;
    this.future.length = 0;
    this.onchange();
  }
}
