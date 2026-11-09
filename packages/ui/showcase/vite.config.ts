import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'showcase',
  plugins: [react()],
  css: { postcss: './showcase/postcss.config.js' },
  server: { port: 4321, strictPort: true },
  build: { outDir: '../dist-showcase', emptyOutDir: true },
});
