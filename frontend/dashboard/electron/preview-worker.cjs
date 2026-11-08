// Owns only the inference child process. No camera or actuator access from Electron.
const { spawn } = require('node:child_process');

class PreviewWorker {
  constructor({ spawnProcess = spawn, restartMs = 3000, log = console.error } = {}) {
    this.spawnProcess = spawnProcess;
    this.restartMs = restartMs;
    this.log = log;
    this.child = null;
    this.timer = null;
    this.stopped = true;
  }
  start(python, script, robotUrl, dataDir) {
    this.stop();
    this.stopped = false;
    const launch = () => {
      if (this.stopped) return;
      const child = this.spawnProcess(python, [script, '--camera-url', `${robotUrl.replace(/\/$/, '')}/camera.jpg`,
        '--vision', '--no-thermal', '--host', '127.0.0.1', '--port', '8082'], {
        stdio: ['ignore', 'ignore', 'pipe'],
        env: { ...process.env, PERCEPTION_PATHS_DATA_DIR: dataDir },
      });
      this.child = child;
      child.stderr?.on('data', (line) => this.log(`[preview] ${line.toString().trim()}`));
      let finished = false;
      const retry = (error) => {
        if (finished) return;
        finished = true;
        if (error) this.log(`Preview worker: ${error.message}`);
        if (this.child === child) this.child = null;
        if (!this.stopped) this.timer = setTimeout(launch, this.restartMs);
      };
      child.once('error', retry);
      child.once('exit', () => retry());
    };
    launch();
  }
  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    const child = this.child;
    this.child = null;
    if (child) {
      child.kill('SIGTERM');
      const timeout = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }, 4000);
      timeout.unref?.();
      child.once('exit', () => clearTimeout(timeout));
    }
  }
}
module.exports = { PreviewWorker };
