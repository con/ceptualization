import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// A second build producing ONE iife JS file with cytoscape bundled in.
// The python server inlines it (plus viewer.css and the data) into a single
// self-contained HTML file. No Graphviz WASM here: the export ships
// coordinates, not a layout engine.
export default defineConfig({
  build: {
    outDir: 'dist-viewer',
    emptyOutDir: true,
    cssCodeSplit: false,
    lib: {
      entry: resolve(import.meta.dirname, 'src/viewer.js'),
      name: 'WorldmapViewer',
      formats: ['iife'],
      fileName: () => 'worldmap-viewer.iife.js',
    },
    minify: true,
  },
});
