// Fixture record -> Cytoscape element. Nothing here invents data; every field
// shown in the UI comes straight out of worldmap.json.

export function shorten(s, max = 34) {
  if (!s) return '';
  if (s.length <= max) return s;
  const head = Math.ceil((max - 1) / 2);
  const tail = Math.floor((max - 1) / 2);
  return `${s.slice(0, head)}…${s.slice(s.length - tail)}`;
}

export function nodeClasses(n) {
  const cls = [];
  if (n.is_seed) cls.push('seed');
  if (n.inactive) cls.push('inactive');
  if (n.added_as_remote) cls.push('added-remote');
  cls.push('unexpanded');
  return cls.join(' ');
}

export function toNodeEl(n) {
  const data = { ...n };
  data.fullLabel = n.label;
  data.label = shorten(n.label, n.type === 'host' ? 40 : 32);
  if (n.type === 'host') data.label = n.label;
  return { group: 'nodes', data, classes: nodeClasses(n) };
}

function fmtAhead(e) {
  const a = e.ahead || 0;
  const b = e.behind || 0;
  if (!a && !b) return '';
  const parts = [];
  if (a) parts.push(`▲${a}`);
  if (b) parts.push(`▼${b}`);
  return parts.join(' ');
}

export function edgeLabel(e) {
  switch (e.kind) {
    case 'remote':
      return e.remote_name ? e.remote_name : '(url only)';
    case 'subdataset':
      return e.path || 'subdataset';
    case 'worktree_of':
      return 'worktree';
    case 'shares_history_with':
      return `shares history ${(e.containment ?? 0).toFixed(2)}${e.note ? ' · ' + e.note : ''}`;
    case 'candidate_same_as':
      return e.verdict === 'accepted'
        ? `✓ same repo (containment ${(e.confidence ?? 0).toFixed(2)})`
        : `✗ NOT same repo (containment ${(e.confidence ?? 0).toFixed(2)})`;
    default:
      return '';
  }
}

export function toEdgeEl(e) {
  const data = { ...e };
  data.edgeLabel = edgeLabel(e);
  const ah = fmtAhead(e);
  if (ah) data.aheadLabel = ah;
  return { group: 'edges', data, classes: e.kind === 'fork_of' ? 'forkedge' : '' };
}

// Containment depth so we can always add ancestors before descendants.
export function sortByDepth(nodes) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const depth = (n, guard = 0) => {
    if (!n.parent || guard > 20) return 0;
    const p = byId.get(n.parent);
    return p ? 1 + depth(p, guard + 1) : 0;
  };
  return [...nodes].sort((a, b) => depth(a) - depth(b));
}
