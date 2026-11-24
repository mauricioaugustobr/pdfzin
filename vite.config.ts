import { defineConfig } from 'vite';

export default defineConfig({
  // Base relativa: funciona em qualquer subcaminho (GitHub Pages etc.).
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
  },
});
