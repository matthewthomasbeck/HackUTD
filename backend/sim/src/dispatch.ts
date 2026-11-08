import { reportConfiguredHouse, printStatus, spawnSurvivor, walkGlassesRescuer, walkTargetWarning } from './commands.ts';
import type { DemoSiteConfig } from './config.ts';
import { formatNamedCoordinates, getNamedCoordinates } from './coords.ts';
import { FailureController } from './failures.ts';
import { requireDemoMode } from './guard.ts';
import { logInjection } from './inject.ts';
import type { SimPool } from './pool.ts';
import { RescuerRunner } from './rescuers.ts';
import { endRun, startRun } from './run.ts';
import { addDuplicatePairs, scaleSurvivors } from './scale.ts';
import { setupSite } from './setup.ts';
import { SimRobotRunner } from './simrobot.ts';
import { formatTimelineDryRun, loadTimeline, runTimeline } from './timeline.ts';
import { makeCondition } from './conditions.ts';

export type CommandName =
  | 'help' | 'coords' | 'setup' | 'run start' | 'run end' | 'scale' | 'hidden'
  | 'robot start' | 'robot stop' | 'robot replay' | 'rescuers start' | 'rescuers stop'
  | 'spawn' | 'report' | 'dupes' | 'imbalance' | 'walk' | 'fail' | 'recover' | 'timeline' | 'status';

export interface ParsedCommand { name: CommandName; args: string[] }

const SHORT: Record<string, string[]> = {
  rs: ['run', 'start'], re: ['run', 'end'], s: ['scale'], h: ['hidden'],
  rb: ['robot', 'start'], rbx: ['robot', 'stop'], rr: ['robot', 'replay', 'house3'],
  rc: ['rescuers', 'start'], rcx: ['rescuers', 'stop'], sp: ['spawn'], rp: ['report'],
  d: ['dupes'], ib: ['imbalance'], w: ['walk'], ok: ['recover'], t: ['timeline'], '?': ['status'],
  f1: ['fail', 'robot-offline'], f2: ['fail', 'rescuer-silent'], f3: ['fail', 'device'], f4: ['fail', 'rescuer-drop'],
};
const SIMPLE = new Set(['help', 'coords', 'setup', 'scale', 'hidden', 'spawn', 'report', 'dupes', 'imbalance', 'walk', 'fail', 'recover', 'timeline', 'status']);
const PAIRED: Record<string, string[]> = { run: ['start', 'end'], robot: ['start', 'stop', 'replay'], rescuers: ['start', 'stop'] };
const FAILURES = new Set(['robot-offline', 'rescuer-silent', 'rescuer-drop', 'device']);
const LEVELS = new Set(['immediate', 'delayed', 'minor', 'unknown']);

export function parseCommand(text: string): ParsedCommand {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const head = words.shift() ?? 'help';
  const expanded = [...(SHORT[head] ?? [head]), ...words];
  const first = expanded.shift()!;
  if (PAIRED[first]) {
    const second = expanded.shift();
    if (!second || !PAIRED[first]!.includes(second)) throw new Error(`Usage: ${first} ${PAIRED[first]!.join(' | ')}`);
    return { name: `${first} ${second}` as CommandName, args: expanded };
  }
  if (!SIMPLE.has(first)) throw new Error(`Unknown command: ${text.trim()}`);
  return { name: first as CommandName, args: expanded };
}

export function validateCommand(text: string, config: DemoSiteConfig): ParsedCommand {
  const command = parseCommand(text);
  const { name, args } = command;
  const house = args.join(' ');
  const knownHouse = (label: string) => config.houses.some((item) => item.label === label);
  const simKeys = new Set(config.rescuers.filter((item) => !item.real).map((item) => item.key));
  const fail = (message: string) => { throw new Error(`${text.trim()}: ${message}`); };
  if (name === 'scale' && args[0] !== undefined && args[0] !== '--rate' && !/^\d+$/.test(args[0])) fail('count must be a non-negative integer');
  if (name === 'dupes' && args[0] !== undefined && !/^\d+$/.test(args[0])) fail('n must be a non-negative integer');
  if (name === 'spawn' && (!LEVELS.has(args[0] ?? '') || !knownHouse(args.slice(1).join(' ')))) fail('usage: spawn <level> <house>');
  if (name === 'report' && !knownHouse(house)) fail('unknown house');
  if (name === 'walk' && house && !knownHouse(house)) fail('unknown house');
  if (name === 'robot replay' && house !== 'house3') fail('usage: robot replay house3');
  if (name === 'imbalance' && args[0] !== undefined && !simKeys.has(args[0]) && !/^r\d+$/.test(args[0])) fail('choose a simulated rescuer key');
  if (name === 'fail' && !FAILURES.has(args[0] ?? '')) fail(`failure must be one of ${[...FAILURES].join(', ')}`);
  if (name === 'fail' && (args[0] === 'rescuer-silent' || args[0] === 'rescuer-drop') && (!args[1] || args[1] === 'cayden')) fail('choose a simulated rescuer key, such as r2');
  if (name === 'timeline' && !args[0]) fail('usage: timeline <name> [--dry]');
  return command;
}

export async function runOfflineCommand(command: ParsedCommand, config: DemoSiteConfig): Promise<boolean> {
  if (command.name === 'help') console.log(HELP);
  else if (command.name === 'coords') console.log(formatNamedCoordinates(getNamedCoordinates(config)));
  else if (command.name === 'timeline' && command.args[1] === '--dry') {
    console.log(formatTimelineDryRun(await loadTimeline(command.args[0]!)));
    console.log('Dry run only: no database connection was opened. Await times use their full timeout bounds.');
  } else return false;
  return true;
}

export interface SessionOptions {
  persistent: boolean;
  waitForKey?: () => Promise<void>;
}

export class SimSession {
  readonly robots: SimRobotRunner;
  readonly rescuers: RescuerRunner;
  readonly failures: FailureController;
  private actorsConnected = false;
  private timelineRunning = false;

  constructor(readonly config: DemoSiteConfig, readonly pool: SimPool, readonly options: SessionOptions) {
    this.robots = new SimRobotRunner(config, pool);
    this.rescuers = new RescuerRunner(config, pool);
    this.failures = new FailureController(config, pool, this.robots, this.rescuers);
  }

  async ensureActors(): Promise<void> {
    if (this.actorsConnected) return;
    await this.pool.connectConfiguredActors(this.config);
    this.actorsConnected = true;
    if (this.options.persistent) this.robots.startFleet();
  }

  hasRunningLoops(): boolean { return this.robots.anyRunning() || this.rescuers.anyRunning(); }

  close(): void {
    this.robots.stopAll();
    this.rescuers.stop();
    this.pool.disconnectAll();
  }

  async execute(text: string): Promise<void> {
    const command = validateCommand(text, this.config);
    const { name, args } = command;
    const config = this.config;
    if (await runOfflineCommand(command, config)) return;
    await this.pool.connect('sim', 'sim', 'sim');
    if (name === 'setup') {
      const result = await setupSite(config, this.pool);
      this.actorsConnected = false;
      await this.ensureActors();
      console.log(`Site ${result.siteId}: ${result.cellCount} cells`);
      console.log(`Robots: ${result.robotNames.join(', ')}`);
      console.log(`Rescuers: ${result.rescuerNames.join(', ')}`);
      return;
    }
    const sim = this.pool.get('sim');
    requireDemoMode(sim);
    if (name === 'run start') {
      const site = Array.from(sim.connection.db.site.iter()).sort((a, b) => Number(b.id - a.id))[0]!;
      console.log(`Run ${await startRun(sim, site.id, args.join(' '))} started: ${args.join(' ') || 'Judging'}`);
    } else if (name === 'run end') {
      await endRun(sim, args.join(' '));
      console.log('Run ended.');
    } else if (name === 'status') {
      printStatus(this.pool);
    } else if (name === 'report') {
      await reportConfiguredHouse(config, this.pool, args.join(' '));
      console.log(`Person report recorded for ${args.join(' ')}.`);
    } else if (name === 'walk') {
      const house = args.join(' ') || undefined;
      const warning = house ? walkTargetWarning(config, sim, house) : undefined;
      if (warning) console.warn(warning);
      await walkGlassesRescuer(config, house);
    } else if (name === 'timeline') {
      await this.runTimelineByName(args[0]!);
    } else {
      await this.ensureActors();
      await this.executeActorCommand(name, args);
    }
  }

  private async executeActorCommand(name: CommandName, args: string[]): Promise<void> {
    const config = this.config;
    const sim = this.pool.get('sim');
    if (name === 'scale') {
      const rateIndex = args.indexOf('--rate');
      const count = args[0] && args[0] !== '--rate' ? Number(args[0]) : config.scale.count;
      const rate = rateIndex < 0 ? config.scale.rate_per_s : Number(args[rateIndex + 1]);
      if (!Number.isFinite(rate) || rate < 0) throw new Error('--rate must be a non-negative number');
      console.log(`Reported ${await scaleSurvivors(config, this.pool, count, rate)} simulated survivors.`);
    } else if (name === 'dupes') {
      console.log(`Added ${await addDuplicatePairs(config, this.pool, args[0] === undefined ? config.scale.duplicate_pairs : Number(args[0]))} possible duplicate pairs.`);
    } else if (name === 'hidden') {
      await logInjection(sim, 'hidden', config.hidden_survivors.map((item) => item.house).join(', '));
      console.log(`Armed ${this.robots.armHidden()} hidden survivors; ${config.robots.sim.robot_id} finds them when it searches those houses.`);
    } else if (name === 'spawn') {
      console.log(`Simulated survivor ${await spawnSurvivor(config, this.pool, args[0]!, args.slice(1).join(' '))} reported by ${config.robots.sim.robot_id}.`);
    } else if (name === 'robot start') {
      this.robots.startDog();
      console.log(`${config.robots.sim.robot_id} running: claims missions, searches cells, and reports findings.`);
    } else if (name === 'robot stop') {
      this.robots.stop(config.robots.sim.robot_id);
      console.log(`${config.robots.sim.robot_id} stopped.`);
    } else if (name === 'robot replay') {
      await logInjection(sim, 'robot replay', 'house3');
      await this.robots.replayHouse3();
      console.log('Replay of the house 3 detection done.');
    } else if (name === 'rescuers start') {
      this.rescuers.start();
      console.log('Sim rescuers running.');
    } else if (name === 'rescuers stop') {
      this.rescuers.stop();
      console.log('Sim rescuers stopped.');
    } else if (name === 'imbalance') {
      await this.failures.imbalance(args[0]);
    } else if (name === 'fail') {
      await this.failures.inject(args[0]!, args.slice(1));
      console.log(`Injected ${args[0]}.`);
    } else if (name === 'recover') {
      await this.failures.recover();
      console.log('Recovered simulated actors.');
    }
  }

  private async runTimelineByName(name: string): Promise<void> {
    if (this.timelineRunning) throw new Error('A timeline is already running');
    const steps = await loadTimeline(name);
    for (const step of steps) for (const cmd of [step.cmd, step.else]) if (cmd) validateCommand(cmd, this.config);
    this.timelineRunning = true;
    const sim = this.pool.get('sim');
    try {
      await this.ensureActors();
      await runTimeline(steps, {
        execute: (cmd) => this.execute(cmd),
        condition: (step) => makeCondition(step, sim, this.config),
        waitForKey: this.options.waitForKey ?? (() => Promise.resolve()),
        say: (text) => console.log(`\n========================================\n  SAY: ${text}\n========================================\n`),
        log: (text) => console.log(text),
      });
    } finally {
      this.timelineRunning = false;
    }
  }
}

export const HELP = `HackUTD simulator commands (one-shot: npm run sim -- <command>; or inside the console):
  coords                              Print named config coordinates (offline)
  setup                               Create or reuse the demo site, cells, and actors
  run start [name] | rs               Start a recorded run
  run end [notes] | re                End the active run
  scale [count] [--rate n] | s        Add seeded simulated survivors and partial cells (inj)
  dupes [n] | d                       Add n possible duplicate pairs near scale survivors (inj)
  hidden | h                          Arm the hidden survivors for sim-dog to find (inj)
  robot start | rb                    Run sim-dog: heartbeats, missions, cell search, findings
  robot stop | rbx                    Stop sim-dog
  robot replay house3 | rr            Fallback: sim-dog reports the house 3 detection with rehearsal media (inj)
  rescuers start | rc                 Run the sim rescuer loop
  rescuers stop | rcx                 Stop the sim rescuer loop
  spawn <level> <house> | sp          One survivor at a named house, found by sim-dog (inj)
  report <house> | rp                 Record the configured person report (inj)
  imbalance [key] | ib                Give one sim rescuer three active assignments (inj)
  walk [house] | w                    Start Cayden's glasses demo walker toward the current assignment
  fail robot-offline [robot_id] | f1  Stop heartbeats for a sim robot (inj)
  fail rescuer-silent <key> | f2      Stop heartbeats for a sim rescuer with an active assignment (inj)
  fail device [device] [status] [robot_id] | f3   Report a device status (inj)
  fail rescuer-drop <key> | f4        Close a sim rescuer's connection (inj)
  recover | ok                        Undo injected failures and holds, reconnect dropped rescuers (inj)
  timeline <name> [--dry] | t         Run timelines/<name>.json, or print it without connecting
  status | ?                          Headline and board summary
  console                             Run persistent simulator controls
  reset                               Use npm run reset to republish and seed the module

One-shot commands that start loops (robot start, rescuers start, recover) keep running until Ctrl-C.`;
