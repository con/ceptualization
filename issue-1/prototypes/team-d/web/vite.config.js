import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022' },
  worker: { format: 'es' },
  server: {
    port: 5273,
    proxy: { '/api': 'http://127.0.0.1:8861', '/export': 'http://127.0.0.1:8861' },
  },
});
