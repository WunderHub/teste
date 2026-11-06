import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { port: 5173, strictPort: true },
  build: {
    chunkSizeWarningLimit: 1600,
    rollupOptions: { input: { combate: 'index.html', estudo: 'estudo-visual.html' }, output: { manualChunks: { phaser: ['phaser'] } } },
  },
});
