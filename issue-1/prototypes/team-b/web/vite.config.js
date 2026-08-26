import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022' },
  server: { port: 5173, proxy: { '/api': 'http://127.0.0.1:8391', '/export': 'http://127.0.0.1:8391' } },
});
