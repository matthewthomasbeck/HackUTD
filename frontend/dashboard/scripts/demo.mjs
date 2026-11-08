// `npm run demo`: everything the Play demo button needs, on the local SpacetimeDB server, in one terminal.
//   1. the local SpacetimeDB server (started if it is not running) with the module published (if the database is missing)
//   2. `sim setup` (idempotent), then a sim console running `hidden` and `scene`: Dog 1 and Dog 2 patrol with R1 and R2,
//      and Dog 1 finds the hidden house 3 person when it searches there
//   3. the glasses service (Cayden starts on Worthing St, about 64 m from house 3) and the glasses pages (port 5173),
//      which the app's glasses panel and the Even simulator (`cd frontend/glasses && npm run sim`) both use
//   4. the Underdog app on the local server, with hot reload
// A service whose port is already taken is assumed to be running and is left alone. Closing the app or Ctrl-C stops
// everything this script started. Extra flags go to the app, as with `npm run app`.
import { spawn } from 'node:child_process';
import { connect } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const DATABASE = 'assess-0hw81';
const STDB_HTTP = 'http://127.0.0.1:3000';
// The local server's sim identities live in their own token folder, apart from the Maincloud ones in .tokens/.
const DB_ENV = { STDB_URI: STDB_HTTP, STDB_DATABASE: DATABASE, STDB_TOKEN_DIR: '.tokens/local' };
const children = [];

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
  process.exit(code);
}
process.on('SIGINT', () => void stop(0));
process.on('SIGTERM', () => void stop(0));

try {
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
  await run('sim setup', 'npm', ['run', '--silent', 'sim', '--', 'setup'], { cwd: sim, env: DB_ENV });
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

  start('app', 'npm', ['run', '--silent', 'app', '--', '--db=local', '--local-uri=ws://127.0.0.1:3000', ...process.argv.slice(2)], { cwd: resolve(ROOT, 'frontend/dashboard') })
    .on('exit', () => void stop(0));
  log('Ready. Press Play demo in the app (top right). For the Even simulator: cd frontend/glasses && npm run sim');
} catch (error) {
  console.error(`[demo] ${error instanceof Error ? error.message : String(error)}`);
  await stop(1);
}
