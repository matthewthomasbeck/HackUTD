// `npm run demo`: everything the Play demo button needs, on the local SpacetimeDB server, in one terminal.
//   1. the local SpacetimeDB server (started if it is not running) with the module published (if the database is missing)
//   2. `sim setup` (idempotent), then a sim console running `hidden` and `scene`: Dog 1 and Dog 2 patrol with R1 and R2,
//      and Dog 1 finds the hidden house 3 person when it searches there
//   3. the glasses service (Cayden starts on Worthing St, about 64 m from house 3) and the glasses pages (port 5173),
//      which the app's glasses panel and the Even simulator (`cd frontend/glasses && npm run sim`) both use
//   4. the packaged UnderDog app on the local server, so the Dock shows its name and logo; it is rebuilt
//      (npm run app:pack) first when the dashboard code is newer than the last build. `--dev` opens the hot-reload
//      development app instead (named Electron in the Dock).
// Every run starts from a fresh local board: it wipes the local database (`npm run reset` in backend/sim, which refuses
// Maincloud) and sets the demo up again, so house 3 is unsearched and its person not found yet. Between runs a sim
// rescuer may have rescued that person, which would leave Play demo nothing to find. `--keep` keeps the data instead.
// A service whose port is already taken is assumed to be running and is left alone. Closing the app or Ctrl-C stops
// everything this script started. Extra flags go to the app, as with `npm run app`.
// `--services` starts everything but the app and prints "[demo] Services ready."; the UnderDog app itself runs it this
// way when it opens on the local server (electron/main.cjs), and stops it when it quits. Only one run is alive at a
// time: a new run first stops the one named in .demo.pid, so two sims never drive the same robots.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const DATABASE = 'assess-0hw81';
const STDB_HTTP = 'http://127.0.0.1:3000';
// The local server's sim identities live in their own token folder, apart from the Maincloud ones in .tokens/.
const DB_ENV = { STDB_URI: STDB_HTTP, STDB_DATABASE: DATABASE, STDB_TOKEN_DIR: '.tokens/local' };
const DASHBOARD = resolve(ROOT, 'frontend/dashboard');
const APP = resolve(DASHBOARD, 'release/mac-arm64/UnderDog.app');
const BUILT = resolve(APP, 'Contents/Resources/app.asar');
const PID_FILE = resolve(DASHBOARD, '.demo.pid');
const devApp = process.argv.includes('--dev');
const fresh = !process.argv.includes('--keep');
const servicesOnly = process.argv.includes('--services');
const appArgs = process.argv.slice(2).filter((arg) => !['--dev', '--keep', '--services'].includes(arg));
const children = [];

// Newest change to anything that goes into the packaged app.
function newestSource() {
  const roots = ['src', 'electron', 'public', 'index.html', 'package.json', 'vite.config.ts', '../design-tokens'].map((path) => resolve(DASHBOARD, path));
  let newest = 0;
  const stack = [...roots];
  while (stack.length) {
    const path = stack.pop();
    if (!existsSync(path)) continue;
    const info = statSync(path);
    if (info.isDirectory()) stack.push(...readdirSync(path).map((name) => resolve(path, name)));
    else newest = Math.max(newest, info.mtimeMs);
  }
  return newest;
}

const log = (message) => console.log(`[demo] ${message}`);
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

function portOpen(port) {
  return new Promise((done) => {
    const socket = connect({ host: '127.0.0.1', port });
    socket.once('connect', () => { socket.destroy(); done(true); });
    socket.once('error', () => done(false));
  });
}

async function waitForPort(port, name, timeoutMs = 30_000) {
  const started = Date.now();
  while (!(await portOpen(port))) {
    if (Date.now() - started > timeoutMs) throw new Error(`${name} did not open port ${port}`);
    await sleep(250);
  }
}

// Runs a long-lived child with its output prefixed, and stops the demo if it dies.
function start(name, command, args, options = {}) {
  // Its own process group, so stopping it also stops what npm started under it (vite, tsx, electron).
  const child = spawn(command, args, { cwd: options.cwd, env: { ...process.env, ...options.env }, stdio: ['pipe', 'pipe', 'pipe'], detached: true });
  const prefix = (stream, out) => {
    let rest = '';
    stream.on('data', (chunk) => {
      const lines = (rest + chunk).split('\n');
      rest = lines.pop() ?? '';
      for (const line of lines) out.write(`[${name}] ${line}\n`);
    });
  };
  prefix(child.stdout, process.stdout);
  prefix(child.stderr, process.stderr);
  child.on('exit', (code, signal) => {
    if (stopping) return;
    log(`${name} exited (${signal ?? code}).`);
    if (options.critical !== false) void stop(code ?? 1);
  });
  children.push(child);
  return child;
}

// Runs a child to completion with its output shown as is.
function run(name, command, args, options = {}) {
  return new Promise((done, fail) => {
    const child = spawn(command, args, { cwd: options.cwd, env: { ...process.env, ...options.env }, stdio: 'inherit' });
    child.on('exit', (code) => (code === 0 ? done() : fail(new Error(`${name} failed (exit ${code})`))));
  });
}

let stopping = false;
async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  log('Stopping everything this script started.');
  const signal = (child, name) => { try { process.kill(-child.pid, name); } catch { /* already gone */ } };
  for (const child of children.reverse()) signal(child, 'SIGTERM');
  await sleep(800);
  for (const child of children) signal(child, 'SIGKILL');
  try { if (readFileSync(PID_FILE, 'utf8').trim() === String(process.pid)) rmSync(PID_FILE); } catch { /* not ours or gone */ }
  process.exit(code);
}

// Stops an earlier run that is still alive (its own stop() ends its services), then records this one.
async function takeOver() {
  let previous;
  try { previous = Number(readFileSync(PID_FILE, 'utf8').trim()); } catch { /* no earlier run */ }
  const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
  if (previous && previous !== process.pid && alive(previous)) {
    log(`Stopping the earlier demo run (pid ${previous}).`);
    process.kill(previous, 'SIGTERM');
    for (let waited = 0; alive(previous) && waited < 5000; waited += 200) await sleep(200);
    if (alive(previous)) process.kill(previous, 'SIGKILL');
    await sleep(500); // its glasses service and pages free their ports
  }
  writeFileSync(PID_FILE, String(process.pid));
}
process.on('SIGINT', () => void stop(0));
process.on('SIGTERM', () => void stop(0));

try {
  await takeOver();
  if (await portOpen(3000)) log('SpacetimeDB already running on 127.0.0.1:3000.');
  else {
    log('Starting the local SpacetimeDB server.');
    start('spacetime', 'spacetime', ['start', '--listen-addr', '127.0.0.1:3000']);
    await waitForPort(3000, 'SpacetimeDB');
  }
  const database = await fetch(`${STDB_HTTP}/v1/database/${DATABASE}`).catch(() => undefined);
  if (database?.status !== 200) {
    log(`Publishing the module to the local server as ${DATABASE}.`);
    await run('publish', 'npm', ['run', 'publish:local'], { cwd: resolve(ROOT, 'backend/spacetimedb') });
  }

  const sim = resolve(ROOT, 'backend/sim');
  if (fresh) {
    log('Starting from a fresh local board (--keep keeps the data).');
    await run('reset', 'npm', ['run', '--silent', 'reset'], { cwd: sim, env: DB_ENV });
  } else await run('sim setup', 'npm', ['run', '--silent', 'sim', '--', 'setup'], { cwd: sim, env: DB_ENV });
  const console_ = start('sim', 'npm', ['run', '--silent', 'sim', '--', 'console'], { cwd: sim, env: { ...DB_ENV, GLASSES_BASE: 'http://127.0.0.1:8787' } });
  console_.stdin.write('hidden\nscene\n');

  if (await portOpen(8787)) {
    // Only the real service will do: the glasses mock (`npm run mock`) and FAKE_DB=1 have no database behind them.
    const health = await fetch('http://127.0.0.1:8787/healthz').then((response) => response.json()).catch(() => ({}));
    if (health.mock || health.db === 'fake' || health.ok !== true) throw new Error('Port 8787 is taken by something other than the glasses service on a database (the glasses mock or FAKE_DB=1?). Stop it and run again.');
    log('Glasses service already running on port 8787.');
  }
  else {
    start('glasses', 'npm', ['run', '--silent', 'start'], {
      cwd: resolve(ROOT, 'backend/glasses-service'),
      env: { ...DB_ENV, PORT: '8787', DEMO_START_BEARING_DEG: '292', DEMO_START_DISTANCE_M: '64', DEMO_SPEED_MPS: '1.4' },
    });
  }
  if (await portOpen(5173)) log('Glasses pages already served on port 5173.');
  else start('pages', 'npm', ['run', '--silent', 'dev'], { cwd: resolve(ROOT, 'frontend/glasses') });
  await waitForPort(8787, 'The glasses service');
  await waitForPort(5173, 'The glasses pages');

  if (servicesOnly) {
    log('Services ready.');
  } else {
    // --no-services: this script already runs them, so the app must not start its own.
    const local = ['--db=local', '--local-uri=ws://127.0.0.1:3000', '--no-services'];
    if (devApp) start('app', 'npm', ['run', '--silent', 'app', '--', ...local, ...appArgs], { cwd: DASHBOARD }).on('exit', () => void stop(0));
    else {
      if (!existsSync(BUILT) || statSync(BUILT).mtimeMs < newestSource()) {
        log('Packaging UnderDog.app (the dashboard changed since the last build).');
        await run('app:pack', 'npm', ['run', '--silent', 'app:pack'], { cwd: DASHBOARD });
      }
      start('app', resolve(APP, 'Contents/MacOS/UnderDog'), [...local, ...appArgs], { cwd: DASHBOARD }).on('exit', () => void stop(0));
    }
    log('Ready. Press Play demo in the app (top right). For the Even simulator: cd frontend/glasses && npm run sim');
  }
} catch (error) {
  console.error(`[demo] ${error instanceof Error ? error.message : String(error)}`);
  await stop(1);
}
