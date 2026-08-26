import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: { "/api": { target: "http://127.0.0.1:8853", changeOrigin: false } },
  },
  build: { outDir: "dist", emptyOutDir: true, target: "es2022", sourcemap: false, minify: true },
});
