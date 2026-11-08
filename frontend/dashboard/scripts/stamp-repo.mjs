// Before packaging: writes electron/repo.json with this repo's path, so the packaged UnderDog app can find
// scripts/demo.mjs and start the demo services (electron/services.cjs). The file is git-ignored.
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
writeFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '..', 'electron', 'repo.json'), `${JSON.stringify({ root }, null, 2)}\n`);
console.log(`electron/repo.json -> ${root}`);
