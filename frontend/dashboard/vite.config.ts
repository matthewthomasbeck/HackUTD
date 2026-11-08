import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const bindingsPath = fileURLToPath(new URL('../../backend/spacetimedb-bindings', import.meta.url));

export default defineConfig({
  plugins: [react()],
  // Relative asset paths, so the same build loads from file:// in the desktop app and from a web server.
  base: './',
  resolve: {
    alias: { '@bindings': bindingsPath },
    dedupe: ['spacetimedb'],
  },
  server: {
    fs: { allow: [fileURLToPath(new URL('../..', import.meta.url)), bindingsPath] },
  },
});
