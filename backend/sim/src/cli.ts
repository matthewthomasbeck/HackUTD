import 'dotenv/config';
import { loadDemoConfig } from './config.ts';
import { reportConfiguredHouse, spawnSurvivor, walkGlassesRescuer, printStatus } from './commands.ts';
import { requireDemoMode } from './guard.ts';
import { SimPool } from './pool.ts';
import { scaleSurvivors } from './scale.ts';
import { setupSite } from './setup.ts';
import { endRun, startRun } from './run.ts';
import { createInterface } from 'node:readline';
import { RescuerRunner } from './rescuers.ts';
import { SimRobotRunner } from './simrobot.ts';
import { FailureController } from './failures.ts';
import { formatNamedCoordinates, getNamedCoordinates } from './coords.ts';
import { formatTimelineDryRun, loadTimeline } from './timeline.ts';

const [command, ...args] = process.argv.slice(2);
const config = loadDemoConfig();

if (!command || command === 'help' || command === '--help' || command === '-h') {
  printHelp();
} else if (command === 'console') {
  await runConsole();
} else if (command === 'coords') {
  const { getNamedCoordinates, formatNamedCoordinates } = await import('./coords.ts');
  console.log(formatNamedCoordinates(getNamedCoordinates(config)));
} else if (command === 'timeline' && args.length === 2 && args[1] === '--dry') {
  console.log(formatTimelineDryRun(await loadTimeline(args[0]!)));
  console.log('Dry run only: no database connection was opened. Await times use their full timeout bounds.');
} else if (command === 'timeline') {
  console.error('Live timeline execution is not implemented. Use `timeline <name> --dry`.');
  process.exitCode = 2;
} else if (command === 'setup') {
  await withPool(async (pool) => {
    const result = await setupSite(config, pool);
    console.log(`Site ${result.siteId}: ${result.cellCount} cells`);
    console.log(`Robots: ${result.robotNames.join(', ')}`);
    console.log(`Rescuers: ${result.rescuerNames.join(', ')}`);
  });
} else if (command === 'scale' || command === 's') {
  await withDemoPool(async (pool) => {
    await pool.connectConfiguredActors(config);
    const count = args[0] === undefined ? config.scale.count : parseCount(args[0], 'count');
    const rateIndex = args.indexOf('--rate');
    const rate = rateIndex < 0 ? config.scale.rate_per_s : parseRate(args[rateIndex + 1]);
    const inserted = await scaleSurvivors(config, pool, count, rate);
    console.log(`Reported ${inserted} simulated survivors.`);
  });
} else if (command === 'run' && (args[0] === 'start' || args[0] === 'rs')) {
  await withDemoPool(async (pool) => {
    const site = newestSite(pool);
    const runId = await startRun(pool.get('sim'), site.id, args.slice(1).join(' '));
    console.log(`Run ${runId} started: ${args.slice(1).join(' ') || 'Judging'}`);
  });
} else if (command === 'run' && (args[0] === 'end' || args[0] === 're')) {
  await withDemoPool(async (pool) => {
    await endRun(pool.get('sim'), args.slice(1).join(' '));
    console.log('Run ended.');
  });
} else if ((command === 'report' || command === 'rp') && args[0]) {
  await withDemoPool(async (pool) => {
    await reportConfiguredHouse(config, pool, args.join(' '));
    console.log(`Reported the configured family report for ${args.join(' ')}.`);
  });
} else if ((command === 'spawn' || command === 'sp') && args.length >= 2) {
  await withDemoPool(async (pool) => {
    await pool.connectConfiguredActors(config);
    const survivorId = await spawnSurvivor(config, pool, args[0]!, args.slice(1).join(' '));
    console.log(`Simulated survivor ${survivorId} reported by ${config.robots.sim.robot_id}.`);
  });
} else if ((command === 'walk' || command === 'w')) {
  await withDemoPool(async () => walkGlassesRescuer(config, args.join(' ') || undefined));
} else if (command === 'status' || command === '?') {
  await withDemoPool(async (pool) => printStatus(pool));
} else if (command === 'recover' || command === 'ok') {
  await withDemoPool(async (pool) => {
    const failures = new FailureController(config, pool, new SimRobotRunner(config, pool), new RescuerRunner(config, pool));
    await failures.recover();
    console.log('Recovery reducers sent. Start the console to keep heartbeats running.');
  });
} else if (command === 'reset') {
  console.error('Use `npm run reset` to republish with data deletion and then rerun setup.');
  process.exitCode = 2;
} else {
  console.error(`Command not implemented yet: ${[command, ...args].join(' ')}`);
  printHelp();
  process.exitCode = 2;
}

async function withPool<T>(action: (pool: SimPool) => Promise<T>): Promise<T> {
  const pool = new SimPool();
  try { return await action(pool); }
  finally { pool.disconnectAll(); }
}

async function withDemoPool<T>(action: (pool: SimPool) => Promise<T>): Promise<T> {
  return withPool(async (pool) => {
    await pool.connect('sim', 'sim', 'sim');
    requireDemoMode(pool.get('sim'));
    return action(pool);
  });
}

function newestSite(pool: SimPool) {
  const sites = Array.from(pool.get('sim').connection.db.site.iter()).sort((a, b) => Number(b.id - a.id));
  const site = sites[0];
  if (!site) throw new Error('No site exists. Run setup first.');
  return site;
}

function parseCount(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${label} must be a non-negative integer`);
  return parsed;
}
function parseRate(value: string | undefined): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error('--rate must be a non-negative number');
  return parsed;
}

function printHelp(): void {
  console.log(`HackUTD simulator commands:
  coords                         Print named config coordinates (offline)
  setup                          Create or reuse the demo site, cells, and actors
  run start [name]               Start a recorded run
  run end [notes]                End the active run
  scale [count] [--rate n]       Add seeded simulated survivors
  spawn <level> <house>          Report one simulated finding
  report <house>                 Record the configured person report
  walk                           Start Cayden's glasses demo walker for the current assignment
  console                        Run persistent simulator controls
  status                         Show the current board summary
  timeline <name> --dry          Validate and print a timeline without connecting
  reset                          Use npm run reset to republish and seed the module

Console currently supports rescuer loops and failure injections. Robot mission execution, hidden survivor arming, imbalance, and timelines are not implemented yet.`);
}

async function runConsole(): Promise<void> {
  const pool = new SimPool();
  const robots = new SimRobotRunner(config, pool);
  const rescuers = new RescuerRunner(config, pool);
  const failures = new FailureController(config, pool, robots, rescuers);
  await pool.connect('sim', 'sim', 'sim');
  if (Array.from(pool.get('sim').connection.db.site.iter()).length > 0) {
    requireDemoMode(pool.get('sim'));
    await pool.connectConfiguredActors(config);
    robots.startFleet();
  }
  const terminal = createInterface({ input: process.stdin, output: process.stdout, prompt: 'sim> ' });
  console.log('Simulator console. Type help for commands.');
  terminal.prompt();
  terminal.on('line', (line) => {
    const parts = line.trim().split(/\s+/).filter(Boolean);
    const next = parts.shift() ?? '';
    void executeConsoleCommand(next, parts, pool, robots, rescuers, failures)
      .catch((error: unknown) => console.error(error instanceof Error ? error.message : String(error)))
      .finally(() => terminal.prompt());
  });
  await new Promise<void>((resolve) => terminal.once('close', resolve));
  robots.stopAll();
  rescuers.stop();
  pool.disconnectAll();
}

async function executeConsoleCommand(next: string, args: string[], pool: SimPool, robots: SimRobotRunner, rescuers: RescuerRunner, failures: FailureController): Promise<void> {
  if (!next || next === 'help' || next === '?') { printHelp(); return; }
  if (next === 'coords') { console.log(formatNamedCoordinates(getNamedCoordinates(config))); return; }
  if (next === 'timeline' && args.length === 2 && args[1] === '--dry') {
    console.log(formatTimelineDryRun(await loadTimeline(args[0]!)));
    console.log('Dry run only: no database connection was opened. Await times use their full timeout bounds.');
    return;
  }
  if (next === 'timeline') throw new Error('Live timeline execution is not implemented. Use `timeline <name> --dry`.');
  if (next === 'setup') {
    const result = await setupSite(config, pool);
    await pool.connectConfiguredActors(config);
    robots.startFleet();
    console.log(`Site ${result.siteId}: ${result.cellCount} cells`);
    console.log(`Robots: ${result.robotNames.join(', ')}`);
    console.log(`Rescuers: ${result.rescuerNames.join(', ')}`);
    return;
  }
  requireDemoMode(pool.get('sim'));
  if (next === 'run' && (args[0] === 'start' || args[0] === 'rs')) {
    console.log(`Run ${await startRun(pool.get('sim'), newestSite(pool).id, args.slice(1).join(' '))} started.`);
  } else if (next === 'run' && (args[0] === 'end' || args[0] === 're')) {
    await endRun(pool.get('sim'), args.slice(1).join(' ')); console.log('Run ended.');
  } else if (next === 'scale' || next === 's') {
    const rateIndex = args.indexOf('--rate');
    const count = args[0] && args[0] !== '--rate' ? parseCount(args[0], 'count') : config.scale.count;
    const rate = rateIndex < 0 ? config.scale.rate_per_s : parseRate(args[rateIndex + 1]);
    console.log(`Reported ${await scaleSurvivors(config, pool, count, rate)} simulated survivors.`);
  } else if ((next === 'spawn' || next === 'sp') && args.length >= 2) {
    console.log(`Simulated survivor ${await spawnSurvivor(config, pool, args[0]!, args.slice(1).join(' '))} reported.`);
  } else if ((next === 'report' || next === 'rp') && args.length > 0) {
    const house = args.join(' '); await reportConfiguredHouse(config, pool, house); console.log(`Person report recorded for ${house}.`);
  } else if (next === 'walk' || next === 'w') {
    await walkGlassesRescuer(config, args.join(' ') || undefined);
  } else if (next === 'status') printStatus(pool);
  else if ((next === 'robot' && ['start', 'stop'].includes(args[0] ?? '')) || next === 'rb' || next === 'rbx') {
    const action = next === 'rb' || (next === 'robot' && args[0] === 'start') ? 'start' : 'stop';
    if (action === 'start') { robots.startDog(); console.log(`${config.robots.sim.robot_id} running.`); }
    else { robots.stop(config.robots.sim.robot_id); console.log(`${config.robots.sim.robot_id} stopped.`); }
  } else if ((next === 'rescuers' && ['start', 'stop'].includes(args[0] ?? '')) || next === 'rc' || next === 'rcx') {
    const action = next === 'rc' || (next === 'rescuers' && args[0] === 'start') ? 'start' : 'stop';
    if (action === 'start') { await pool.connectConfiguredActors(config); rescuers.start(); console.log('Sim rescuers running.'); }
    else { rescuers.stop(); console.log('Sim rescuers stopped.'); }
  } else if ((next === 'fail' && args.length >= 1) || ['f1', 'f2', 'f3', 'f4'].includes(next)) {
    const failure = next === 'fail' ? args[0]! : ({ f1: 'robot-offline', f2: 'rescuer-silent', f3: 'device', f4: 'rescuer-drop' } as Record<string, string>)[next]!;
    await failures.inject(failure, next === 'fail' ? args.slice(1) : args);
    console.log(`Injected ${failure}.`);
  } else if (next === 'recover' || next === 'ok') { await failures.recover(); console.log('Recovered simulated actors.'); }
  else console.error(`Command not implemented: ${[next, ...args].join(' ')}`);
}
