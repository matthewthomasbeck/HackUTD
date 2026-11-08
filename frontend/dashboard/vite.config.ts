import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const bindingsPath = fileURLToPath(new URL('../../backend/spacetimedb-bindings', import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@bindings': bindingsPath },
    dedupe: ['spacetimedb'],
  },
  server: {
    fs: { allow: [fileURLToPath(new URL('../..', import.meta.url)), bindingsPath] },
  },
  build: {
    rollupOptions: { output: { manualChunks: { leaflet: ['leaflet'] } } },
  },
});
