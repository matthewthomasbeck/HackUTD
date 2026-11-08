/// <reference types="vitest/config" />
import { existsSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

// The phone loads the dev server by LAN IP, so hot reload must not point at localhost (glasses.md 2.5).
function lanIp(): string | undefined {
  if (process.env.LAN_IP) return process.env.LAN_IP;
  for (const addrs of Object.values(networkInterfaces())) {
    for (const a of addrs ?? []) if (a.family === 'IPv4' && !a.internal) return a.address;
  }
  return undefined;
}

// Multi-page build: the plugin (index.html) plus the fallback and phone pages when they exist.
const pages: Record<string, string> = { index: resolve(import.meta.dirname, 'index.html') };
for (const name of ['fallback', 'phone']) {
  const file = resolve(import.meta.dirname, `${name}.html`);
  if (existsSync(file)) pages[name] = file;
}

export default defineConfig(({ mode }) => ({
  plugins: mode === 'phone' ? [basicSsl()] : [],
  server: {
    host: true,
    port: mode === 'phone' ? 5174 : 5173,
    hmr: { host: lanIp() },
    ...(mode === 'phone' ? { proxy: {
      '/phone': { target: 'ws://localhost:8787', ws: true },
      '/rescuer': { target: 'http://localhost:8787' },
    } } : {}),
  },
  build: { target: 'esnext', rollupOptions: { input: pages } },
  test: { include: ['test/**/*.test.ts', 'src/**/*.test.ts'] },
}));
