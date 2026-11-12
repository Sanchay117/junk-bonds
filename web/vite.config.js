import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

// Relative base so the built page works from any path (GitHub Pages serves it from /<repo>/).
// The build lands in ../docs, which GitHub Pages can serve straight from the main branch.
export default defineConfig({
  base: './',
  plugins: [preact()],
  build: { outDir: '../docs', emptyOutDir: true },
  server: { port: 5199, strictPort: true },
});
