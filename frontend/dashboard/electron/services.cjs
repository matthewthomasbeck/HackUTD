// The local demo services for the UnderDog app: when the app opens on the local server it runs
// `scripts/demo.mjs --services` from the repo it was built from (SpacetimeDB, a fresh board, the sim, the glasses
// service, and the glasses pages), waits for "Services ready.", and stops them when the app quits. Their output goes
// to a log file, which the error message names when they fail.
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const READY = '[demo] Services ready.';

// The repo the app was built from: the source tree when run from it, else the path the build wrote to repo.json
// (scripts/stamp-repo.mjs, run by app:pack and app:dmg).
function repoRoot(appDir, packaged) {
  if (!packaged) return path.resolve(appDir, '..', '..', '..');
  try { return JSON.parse(fs.readFileSync(path.join(appDir, 'repo.json'), 'utf8')).root; } catch { return undefined; }
}

// An app opened from the Dock or Spotlight gets a bare PATH (no Homebrew node, npm, or spacetime), so use the PATH
// the user's login shell sets up.
function shellPath() {
  const shell = process.env.SHELL || '/bin/zsh';
  const result = spawnSync(shell, ['-ilc', 'printf "__PATH__%s__PATH__" "$PATH"'], { encoding: 'utf8', timeout: 8000 });
  const match = /__PATH__(.*)__PATH__/.exec(result.stdout || '');
  return match ? match[1] : `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH || ''}`;
}

class DemoServices {
  constructor(root, logFile) {
    this.root = root;
    this.logFile = logFile;
    this.child = null;
  }

  running() { return Boolean(this.child && this.child.exitCode === null && this.child.signalCode === null); }

  // Resolves once the services are ready; rejects with the reason and the last log lines otherwise.
  start(timeoutMs = 180_000) {
    if (this.running()) return Promise.resolve();
    const script = this.root && path.join(this.root, 'frontend', 'dashboard', 'scripts', 'demo.mjs');
    if (!script || !fs.existsSync(script)) return Promise.reject(new Error(`The demo scripts were not found${this.root ? ` in ${this.root}` : ''}. Rebuild the app from the repo (npm run app:pack).`));
    fs.mkdirSync(path.dirname(this.logFile), { recursive: true });
    const log = fs.createWriteStream(this.logFile, { flags: 'w' });
    const child = spawn('node', [script, '--services'], { cwd: path.dirname(script), env: { ...process.env, PATH: shellPath() }, stdio: ['ignore', 'pipe', 'pipe'] });
    this.child = child;
    let tail = '';
    return new Promise((resolve, reject) => {
      const fail = (reason) => { clearTimeout(timer); reject(new Error(`${reason}\n\nLast lines of ${this.logFile}:\n${tail.split('\n').slice(-8).join('\n')}`)); };
      const timer = setTimeout(() => fail('The demo services did not get ready in time.'), timeoutMs);
      const onData = (chunk) => {
        log.write(chunk);
        tail = (tail + chunk).slice(-4000);
        if (tail.includes(READY)) { clearTimeout(timer); resolve(); }
      };
      child.stdout.on('data', onData);
      child.stderr.on('data', onData);
      child.on('error', (error) => fail(`Could not start node (${error.message}).`));
      child.on('exit', (code, signal) => { log.end(); if (!tail.includes(READY)) fail(`The demo services stopped (${signal ?? code}).`); });
    });
  }

  // demo.mjs stops everything it started when it gets SIGTERM.
  stop() {
    if (this.running()) this.child.kill('SIGTERM');
    this.child = null;
  }
}

module.exports = { DemoServices, repoRoot };
