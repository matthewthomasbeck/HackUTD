import 'dotenv/config';
import { createInterface } from 'node:readline';
import { loadDemoConfig } from './config.ts';
import { HELP, SimSession, runOfflineCommand, validateCommand } from './dispatch.ts';
import { requireDemoMode } from './guard.ts';
import { SimPool } from './pool.ts';

const argv = process.argv.slice(2);
const config = loadDemoConfig();
const first = argv[0];

if (!first || first === 'help' || first === '--help' || first === '-h') {
  console.log(HELP);
} else if (first === 'console') {
  await runConsole();
} else if (first === 'reset') {
  console.error('Use `npm run reset` to republish with data deletion and then rerun setup.');
  process.exitCode = 2;
} else {
  await runOneShot(argv.join(' '));
}

async function runOneShot(text: string): Promise<void> {
  let command;
  try { command = validateCommand(text, config); }
  catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.log(HELP);
    process.exitCode = 2;
    return;
  }
  if (await runOfflineCommand(command, config)) return;
  const isTimeline = command.name === 'timeline';
  const keys = isTimeline ? createKeyReader() : undefined;
  const session = new SimSession(config, new SimPool(), { persistent: isTimeline, ...(keys ? { waitForKey: keys.next } : {}) });
  try {
    await session.execute(text);
    if (!isTimeline && session.hasRunningLoops()) {
      console.log('Simulated loops are running. Press Ctrl-C to stop.');
      await new Promise<void>((resolve) => process.once('SIGINT', () => resolve()));
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = /demo mode/.test(String(error)) ? 2 : 1;
  } finally {
    keys?.close();
    session.close();
  }
}

function createKeyReader(): { next: () => Promise<void>; close: () => void } {
  const terminal = createInterface({ input: process.stdin });
  const waiting: Array<() => void> = [];
  let closed = false;
  terminal.on('line', () => waiting.shift()?.());
  terminal.on('close', () => { closed = true; while (waiting.length) waiting.shift()!(); });
  return {
    next: () => {
      if (closed) { console.log('stdin is closed, continuing without Enter.'); return Promise.resolve(); }
      return new Promise((resolve) => waiting.push(resolve));
    },
    close: () => terminal.close(),
  };
}

async function runConsole(): Promise<void> {
  const pool = new SimPool();
  const keyWaiters: Array<() => void> = [];
  const session = new SimSession(config, pool, {
    persistent: true,
    waitForKey: () => new Promise((resolve) => { keyWaiters.push(resolve); console.log('Press Enter to continue the timeline.'); }),
  });
  await pool.connect('sim', 'sim', 'sim');
  if (Array.from(pool.get('sim').connection.db.site.iter()).length > 0) {
    requireDemoMode(pool.get('sim'));
    await session.ensureActors();
  }
  const terminal = createInterface({ input: process.stdin, output: process.stdout, prompt: 'sim> ' });
  console.log('Simulator console. Type help for commands.');
  terminal.prompt();
  terminal.on('line', (line) => {
    const waiter = keyWaiters.shift();
    if (waiter) { waiter(); terminal.prompt(); return; }
    if (!line.trim()) { terminal.prompt(); return; }
    const running = session.execute(line)
      .catch((error: unknown) => console.error(error instanceof Error ? error.message : String(error)))
      .finally(() => terminal.prompt());
    if (/^\s*(t|timeline)\s/.test(line)) terminal.prompt();
    void running;
  });
  await new Promise<void>((resolve) => terminal.once('close', resolve));
  session.close();
}
