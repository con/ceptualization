import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Second build: ONE iife JS file with cytoscape bundled in and no layout
// engine at all (no graphviz wasm, no fcose). The python server inlines it
// with viewer.css and the data into a single self-contained HTML file.
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
