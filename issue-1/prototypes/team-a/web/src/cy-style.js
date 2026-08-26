// Cytoscape stylesheet, generated from the live CSS custom properties so that a
// theme switch is a single `cy.style(buildStyle())` call.

export function tokens() {
  const cs = getComputedStyle(document.documentElement);
  const t = (n) => cs.getPropertyValue(n).trim();
  return {
    ink: t('--ink'),
    inkDim: t('--ink-dim'),
    inkFaint: t('--ink-faint'),
    line: t('--line'),
    lineStrong: t('--line-strong'),
    accent: t('--accent'),
    accentSoft: t('--accent-soft'),
    ok: t('--ok'),
    warn: t('--warn'),
    warnSoft: t('--warn-soft'),
    err: t('--err'),
    errSoft: t('--err-soft'),
    host: t('--host'),
    hostLine: t('--host-line'),
    forge: t('--forge'),
    forgeLine: t('--forge-line'),
    cloud: t('--cloud'),
    cloudLine: t('--cloud-line'),
    store: t('--store'),
    storeLine: t('--store-line'),
    node: t('--node'),
    nodeLine: t('--node-line'),
    nodeInk: t('--node-ink'),
    edge: t('--edge'),
    edgeInk: t('--edge-ink'),
    edgeInkBg: t('--bg-stage'), // opaque: vite minifies rgba() vars to #rrggbbaa, which cytoscape rejects
    panel: t('--panel')
  };
}

const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

export function buildStyle() {
  const c = tokens();
  const dark = document.documentElement.dataset.theme === 'dark';
  const outline = dark ? '#0a0d12' : '#ffffff';

  return [
    // ---------------- leaf nodes -------------------------------------------
    {
      selector: 'node',
      style: {
        'background-color': c.node,
        'border-color': c.nodeLine,
        'border-width': 1.5,
        shape: 'round-rectangle',
        width: 'label',
        height: 22,
        padding: '7px',
        label: 'data(label)',
        color: c.nodeInk,
        'font-family': MONO,
        'font-size': 10.5,
        'text-valign': 'center',
        'text-halign': 'center',
        'text-wrap': 'none',
        'min-zoomed-font-size': 5,
        'text-outline-width': 0,
        'transition-property': 'border-color, border-width, background-color, opacity',
        'transition-duration': '160ms'
      }
    },
    // layout / role variants
    { selector: 'node[layout = "bare"]', style: { shape: 'round-rectangle', 'border-style': 'solid', 'background-opacity': dark ? 0.35 : 0.55 } },
    { selector: 'node[vcs = "none"]', style: { 'border-style': 'dashed', 'border-color': c.cloudLine, color: c.cloudLine, shape: 'round-tag' } },
    { selector: 'node[role = "result-branch"]', style: { height: 18, 'font-size': 9.5, padding: '4px' } },
    { selector: 'node[?is_upstream]', style: { 'border-width': 2.5, 'border-color': c.accent } },
    { selector: 'node[?is_template]', style: { 'border-style': 'dotted', 'border-color': c.forgeLine, color: c.forgeLine } },

    // ---------------- compound parents (hosts, RIA stores, superdatasets) ----
    {
      selector: 'node:parent',
      style: {
        'background-color': c.host,
        'background-opacity': dark ? 0.55 : 0.75,
        'border-color': c.hostLine,
        'border-width': 1.5,
        'border-style': 'solid',
        shape: 'round-rectangle',
        padding: 24,
        label: 'data(label)',
        color: c.inkDim,
        'font-family': MONO,
        'font-size': 11,
        'font-weight': 600,
        'text-valign': 'top',
        'text-halign': 'center',
        'text-margin-y': -7,
        'min-zoomed-font-size': 6,
        'z-compound-depth': 'bottom'
      }
    },
    { selector: 'node:parent[host_kind = "forge"]', style: { 'background-color': c.forge, 'border-color': c.forgeLine, color: c.forgeLine } },
    { selector: 'node:parent[host_kind = "cloud"]', style: { 'background-color': c.cloud, 'border-color': c.cloudLine, color: c.cloudLine } },
    { selector: 'node:parent[host_kind = "store"]', style: { 'background-color': c.store, 'border-color': c.storeLine, color: c.storeLine } },
    // a distribution that is itself a container (RIA store, superdataset)
    {
      selector: 'node:parent[type = "distribution"]',
      style: {
        'background-color': c.store,
        'border-color': c.storeLine,
        'border-width': 2,
        'border-style': 'dashed',
        padding: 20,
        color: c.storeLine,
        'font-size': 11
      }
    },
    {
      // A collapsed container keeps its container look, but is sized like a card.
      selector: 'node.collapsed',
      style: {
        'background-color': c.store,
        'background-opacity': dark ? 0.5 : 0.8,
        'border-color': c.storeLine,
        'border-style': 'double',
        'border-width': 4,
        shape: 'round-rectangle',
        color: c.storeLine,
        'font-size': 10.5,
        'font-weight': 600,
        'text-valign': 'center',
        'text-halign': 'center',
        'text-wrap': 'wrap',
        'text-max-width': 240
      }
    },

    // seed
    {
      selector: 'node.seed',
      style: {
        'border-color': c.accent,
        'border-width': 3,
        'background-color': c.accentSoft,
        'font-weight': 700
      }
    },

    // discovery state
    { selector: 'node.unexpanded', style: { 'border-style': 'dashed' } },
    { selector: 'node.expanded', style: { 'border-style': 'solid' } },
    { selector: 'node.probing', style: { 'border-color': c.accent, 'border-width': 3 } },
    { selector: 'node.just-added', style: { 'border-color': c.accent, 'border-width': 3 } },

    // findings
    {
      selector: 'node.finding-error',
      style: {
        'border-color': c.err,
        'border-width': 4,
        'background-color': c.errSoft,
        color: dark ? c.ink : '#5c0f0a',
        'font-weight': 700
      }
    },
    { selector: 'node.finding-warning', style: { 'border-color': c.warn, 'border-width': 3, 'background-color': c.warnSoft } },
    { selector: 'node.pulse', style: { 'overlay-color': c.err, 'overlay-opacity': 0.28, 'overlay-padding': 12 } },

    // s3
    {
      // "greyed out" must still be legible: recede it, do not erase it.
      selector: 'node.inactive',
      style: {
        opacity: dark ? 0.45 : 0.6,
        'border-style': 'dotted',
        'border-color': c.line,
        'background-color': c.node,
        color: c.inkFaint,
        'font-size': 9
      }
    },
    { selector: 'node.hidden-filter', style: { display: 'none' } },
    { selector: 'node.preview', style: { 'border-color': c.accent, 'border-width': 3, 'border-style': 'double', opacity: 1 } },
    { selector: 'node.added-remote', style: { 'border-color': c.ok, 'border-width': 3, opacity: 1 } },

    // interaction
    { selector: 'node:selected', style: { 'border-color': c.accent, 'border-width': 3.5 } },
    { selector: 'node.dimmed', style: { opacity: 0.16 } },
    { selector: 'node.highlight', style: { 'overlay-color': c.accent, 'overlay-opacity': 0.22, 'overlay-padding': 10 } },

    // ---------------- edges -------------------------------------------------
    {
      selector: 'edge',
      style: {
        'curve-style': 'bezier',
        width: 1.4,
        'line-color': c.edge,
        'target-arrow-color': c.edge,
        'target-arrow-shape': 'triangle',
        'arrow-scale': 0.75,
        'font-family': MONO,
        'font-size': 9,
        color: c.edgeInk,
        'text-background-color': c.edgeInkBg,
        'text-background-opacity': 0.9,
        'text-background-padding': 2,
        'text-background-shape': 'roundrectangle',
        'text-rotation': 'autorotate',
        'min-zoomed-font-size': 7,
        'source-text-offset': 26,
        'source-text-margin-y': -6,
        'transition-property': 'line-color, width, opacity',
        'transition-duration': '160ms'
      }
    },
    // remote edges carry the per-clone remote name — the whole point of s1
    {
      selector: 'edge[kind = "remote"]',
      style: {
        label: 'data(edgeLabel)',
        'line-color': c.edge,
        'target-arrow-color': c.edge
      }
    },
    {
      selector: 'edge[kind = "remote"][resolution = "url-only"]',
      style: { 'line-style': 'dashed', 'line-color': c.inkFaint, 'target-arrow-color': c.inkFaint, color: c.inkFaint }
    },
    { selector: 'edge[?aheadLabel]', style: { 'source-label': 'data(aheadLabel)', 'source-text-rotation': 'autorotate' } },

    {
      selector: 'edge[kind = "same_annex_uuid"]',
      style: {
        label: 'SAME ANNEX UUID',
        'line-color': c.err,
        'line-style': 'dashed',
        'line-dash-pattern': [6, 3],
        width: 3.5,
        'target-arrow-shape': 'none',
        'source-arrow-shape': 'none',
        color: c.err,
        'font-size': 9.5,
        'font-weight': 700,
        'z-index': 30
      }
    },
    {
      selector: 'edge[kind = "subdataset"]',
      style: { 'line-color': c.ok, 'target-arrow-color': c.ok, width: 2, label: 'data(edgeLabel)', color: c.ok, 'target-arrow-shape': 'triangle-backcurve' }
    },
    {
      selector: 'edge[kind = "part"]',
      style: { 'line-color': c.storeLine, 'target-arrow-color': c.storeLine, width: 1, opacity: 0.5, 'target-arrow-shape': 'none', 'line-style': 'dotted' }
    },
    {
      selector: 'edge[kind = "worktree_of"]',
      style: { 'line-color': c.accent, 'target-arrow-color': c.accent, 'line-style': 'dashed', width: 2, label: 'data(edgeLabel)', color: c.accent }
    },
    {
      selector: 'edge[kind = "fork_of"]',
      style: { 'line-color': c.lineStrong, 'target-arrow-color': c.lineStrong, width: 0.7, opacity: 0.3, 'arrow-scale': 0.5 }
    },
    { selector: 'edge.inactive', style: { opacity: 0.09, width: 0.5 } },
    {
      selector: 'edge[kind = "shares_history_with"]',
      style: { 'line-color': c.warn, 'target-arrow-color': c.warn, 'line-style': 'dotted', width: 2, label: 'data(edgeLabel)', color: c.warn, 'target-arrow-shape': 'none' }
    },
    {
      selector: 'edge[kind = "candidate_same_as"]',
      style: {
        label: 'data(edgeLabel)',
        'line-style': 'dashed',
        width: 2.5,
        'target-arrow-shape': 'none',
        'line-color': c.forgeLine,
        color: c.forgeLine,
        'font-weight': 700
      }
    },
    { selector: 'edge[kind = "candidate_same_as"][verdict = "rejected"]', style: { 'line-color': c.err, color: c.err } },
    { selector: 'edge[kind = "candidate_same_as"][verdict = "accepted"]', style: { 'line-color': c.ok, color: c.ok } },
    { selector: 'edge.meta', style: { 'line-color': c.storeLine, 'target-arrow-color': c.storeLine, width: 3, label: 'data(edgeLabel)', color: c.storeLine, 'line-style': 'solid' } },

    { selector: 'edge.dimmed', style: { opacity: 0.07 } },
    { selector: 'edge.highlight', style: { width: 3.5, 'line-color': c.accent, 'target-arrow-color': c.accent, color: c.accent, 'z-index': 40 } },
    { selector: 'edge.just-added', style: { 'line-color': c.accent, 'target-arrow-color': c.accent, width: 2.6 } },
    { selector: '.hidden-filter', style: { display: 'none' } },
    { selector: 'edge:selected', style: { width: 3.5, 'line-color': c.accent, 'target-arrow-color': c.accent } },
    { selector: '.label-off', style: { 'text-opacity': 0 } },
    { selector: 'core', style: { 'active-bg-opacity': 0, 'selection-box-color': c.accent, 'selection-box-opacity': 0.12, 'outside-texture-bg-color': outline } }
  ];
}
