// `npm run app`: the desktop app with hot reload. Starts the Vite dev server, then Electron pointed at it.
// Extra flags go to the app, for example `npm run app -- --db=local --local-uri=ws://127.0.0.1:3000`.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'vite';

const server = await createServer({ server: { host: '127.0.0.1', port: 5182, strictPort: false } });
await server.listen();
const url = server.resolvedUrls?.local[0];
if (!url) throw new Error('Vite did not report a local URL');

const electron = createRequire(import.meta.url)('electron'); // the path to the Electron binary
const child = spawn(electron, ['.', ...process.argv.slice(2)], { stdio: 'inherit', env: { ...process.env, ASSESS_DEV_URL: url.replace(/\/$/, '/') } });
child.on('exit', async (code) => { await server.close(); process.exit(code ?? 0); });
