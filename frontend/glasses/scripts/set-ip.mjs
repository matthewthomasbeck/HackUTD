#!/usr/bin/env node
// Writes the laptop's hotspot IP into .env (VITE_GLASSES_WS_URL) and the app.json network whitelist.
// Usage: npm run set-ip            (detects en0 with ipconfig on macOS)
//        npm run set-ip -- 172.20.10.5
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let ip = process.argv[2];
if (!ip) {
  try {
    ip = execSync('ipconfig getifaddr en0', { encoding: 'utf8' }).trim();
  } catch {
    // no en0 address
  }
}
if (!ip || !/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
  console.error('No IPv4 address. Pass one: npm run set-ip -- 172.20.10.5');
  process.exit(1);
}

const appPath = join(root, 'app.json');
const app = JSON.parse(readFileSync(appPath, 'utf8'));
const net = app.permissions.find((p) => p.name === 'network');
net.whitelist = [`http://${ip}:8787`, `ws://${ip}:8787`];
writeFileSync(appPath, JSON.stringify(app, null, 2) + '\n');

writeFileSync(join(root, '.env'), `VITE_GLASSES_WS_URL=ws://${ip}:8787/glasses\n`);
console.log(`app.json whitelist and .env now use ${ip}. Restart npm run dev; repack if you build an .ehpk.`);
