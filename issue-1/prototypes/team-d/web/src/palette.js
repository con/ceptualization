// Borrowed from team-b/web/src/palette.js (same repo, same licence), with two
// additions: `disagree` for the remote-name conflict badge, and `reach` for the
// unreachable-component affordance.
export const PALETTES = {
  dark: {
    canvas: '#0d1117',
    clusterFill: '#161b22', clusterBorder: '#30363d', clusterText: '#8b949e',
    nodeFill: '#1c2430', nodeBorder: '#3d4757', nodeText: '#e6edf3', nodeSub: '#8b949e',
    seed: '#58a6ff', seedFill: '#132a44',
    forge: '#a371f7', cloud: '#e3b341', store: '#39c5cf', host: '#7d8590',
    err: '#f85149', errFill: '#3d1416', warn: '#d29922', ok: '#3fb950',
    edge: '#5a6472', edgeText: '#e6edf3', edgeLabelBg: '#0d1117',
    ahead: '#3fb950', behind: '#d29922', dead: '#6e4a4a',
    inactive: '#232a33', inactiveText: '#78828f', inactiveBorder: '#39424e',
    special: '#e3b341', conflict: '#f85149', candidate: '#a371f7',
    disagree: '#ff9f4a', disagreeFill: '#3a2410',
    reach: '#39c5cf',
  },
  light: {
    canvas: '#ffffff',
    clusterFill: '#f2f4f7', clusterBorder: '#d0d7de', clusterText: '#57606a',
    nodeFill: '#ffffff', nodeBorder: '#b6c0cc', nodeText: '#1f2328', nodeSub: '#57606a',
    seed: '#0969da', seedFill: '#ddf0ff',
    forge: '#8250df', cloud: '#9a6700', store: '#1b7c83', host: '#57606a',
    err: '#cf222e', errFill: '#ffebe9', warn: '#9a6700', ok: '#1a7f37',
    edge: '#8c959f', edgeText: '#1f2328', edgeLabelBg: '#ffffff',
    ahead: '#1a7f37', behind: '#9a6700', dead: '#b08a8a',
    inactive: '#f0f2f5', inactiveText: '#8c959f', inactiveBorder: '#dde2e8',
    special: '#9a6700', conflict: '#cf222e', candidate: '#8250df',
    disagree: '#bc4c00', disagreeFill: '#fff1e5',
    reach: '#1b7c83',
  },
};
