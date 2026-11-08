import { DeviceHealth } from '../../spacetimedb-bindings/types.js';
import { spawnSurvivorAt } from './commands.ts';
import type { DemoSiteConfig } from './config.ts';
import { distanceMeters, walkToward } from './geo.ts';
import { logInjection } from './inject.ts';
import type { SimActor, SimPool } from './pool.ts';
import { waitForValue } from './wait.ts';
import { RescuerRunner } from './rescuers.ts';
import { SimRobotRunner } from './simrobot.ts';

const IMBALANCE_LOAD = 3;

export class FailureController {
  private readonly offlineRobots = new Set<string>();

  constructor(
    private readonly config: DemoSiteConfig,
    private readonly pool: SimPool,
    private readonly robots: SimRobotRunner,
    private readonly rescuers: RescuerRunner,
  ) {}

  async inject(kind: string, args: string[]): Promise<void> {
    const sim = this.pool.get('sim');
    if (kind === 'robot-offline') {
      const robotId = args[0] ?? this.config.robots.sim.robot_id;
      if (!robotId.startsWith(this.config.robots.sim.robot_id)) throw new Error('The simulator can only stop a simulated robot');
      this.pool.get(robotId);
      await logInjection(sim, 'fail robot-offline', robotId);
      this.robots.stop(robotId);
      this.offlineRobots.add(robotId);
      return;
    }
    if (kind === 'rescuer-silent' || kind === 'rescuer-drop') {
      const key = args[0];
      if (!key || key === 'cayden') throw new Error('Choose a simulated rescuer key, such as r2');
      const actor = this.pool.get(key);
      if (kind === 'rescuer-silent') {
        const assignments = Array.from(actor.connection.db.myAssignment.iter());
        if (!assignments.some((row) => row.status.tag === 'Active')) {
          throw new Error(`${key} needs an active assignment before rescuer-silent`);
        }
        await logInjection(sim, 'fail rescuer-silent', key);
        this.rescuers.pause(key);
      } else {
        await logInjection(sim, 'fail rescuer-drop', key);
        this.rescuers.drop(key);
      }
      return;
    }
    if (kind === 'device') {
      const device = args[0] ?? 'thermal';
      const status = args[1] ?? 'FAILED';
      const robotId = args[2] ?? this.config.robots.sim.robot_id;
      if (!['OK', 'DEGRADED', 'FAILED'].includes(status)) throw new Error('device status must be OK, DEGRADED, or FAILED');
      const robot = this.pool.get(robotId);
      const health = status === 'OK' ? DeviceHealth.Ok : status === 'DEGRADED' ? DeviceHealth.Degraded : DeviceHealth.Failed;
      await logInjection(sim, 'fail device', `${device} ${status} ${robotId}`);
      await robot.connection.reducers.robotReportDevice({ robotId, device, status: health, detail: status === 'FAILED' ? 'no frames for 3 s' : `simulated ${status.toLowerCase()} status`, observedAt: undefined });
      return;
    }
    throw new Error(`Unknown failure: ${kind}`);
  }

  async imbalance(key = 'r1'): Promise<void> {
    if (key === 'cayden') throw new Error('Choose a simulated rescuer key, such as r1');
    const sim = this.pool.get('sim');
    const loaded = this.pool.get(key);
    const loadedParticipant = participantFor(sim, loaded);
    const origin = this.rescuers.positionOf(key) ?? (loadedParticipant.lat !== undefined && loadedParticipant.lon !== undefined ? { lat: loadedParticipant.lat, lon: loadedParticipant.lon } : undefined);
    if (!origin) throw new Error(`${key} has no position yet`);
    const openFor = (identity: string) => Array.from(sim.connection.db.assignment.iter()).filter((row) => hex(row.rescuerIdentity) === identity && (row.status.tag === 'Proposed' || row.status.tag === 'Active'));
    const proposedSurvivors = new Set(Array.from(sim.connection.db.assignment.iter()).filter((row) => row.status.tag === 'Proposed' || row.status.tag === 'Active').map((row) => row.survivorId));
    const survivors = Array.from(sim.connection.db.survivor.iter())
      .filter((row) => row.status.tag === 'Unassigned' && row.criticalLevel.tag === 'Delayed' && !proposedSurvivors.has(row.id))
      .sort((a, b) => distanceMeters(origin, a) - distanceMeters(origin, b))
      .slice(0, IMBALANCE_LOAD);
    if (survivors.length < IMBALANCE_LOAD) throw new Error(`imbalance needs ${IMBALANCE_LOAD} unassigned delayed survivors; run scale first`);
    const idle = this.pool.list()
      .filter((actor) => actor.role === 'rescuer' && actor.key !== key && openFor(actor.identity).length === 0 && this.rescuers.positionOf(actor.key))
      .sort((a, b) => distanceMeters(origin, this.rescuers.positionOf(a.key)!) - distanceMeters(origin, this.rescuers.positionOf(b.key)!))[0];
    await logInjection(sim, 'imbalance', key);
    this.rescuers.hold(key);
    for (const survivor of survivors) {
      await sim.connection.reducers.proposeAssignment({ survivorId: survivor.id, rescuerIdentity: loadedParticipant.identity, reason: 'sim imbalance: load one rescuer' });
      const proposal = await waitForValue(loaded, () => Array.from(loaded.connection.db.myAssignment.iter()).find((row) => row.survivorId === survivor.id && row.status.tag === 'Proposed'));
      await loaded.connection.reducers.acceptAssignment({ assignmentId: proposal.id });
      await waitForValue(loaded, () => Array.from(loaded.connection.db.myAssignment.iter()).find((row) => row.id === proposal.id && row.status.tag === 'Active'));
    }
    if (idle) this.rescuers.placeNear(idle.key, walkToward(origin, this.rescuers.positionOf(idle.key)!, 25));
    const point = walkToward(origin, { lat: origin.lat + 0.00006, lon: origin.lon }, 6);
    const survivorId = await spawnSurvivorAt(this.config, this.pool, 'delayed', point, `next to ${loaded.name}`);
    console.log(`${loaded.name} holds ${openFor(loaded.identity).length} active assignments; ${idle ? `${idle.name} is idle nearby` : 'no idle sim rescuer found'}; new delayed survivor ${survivorId} next to ${loaded.name}.`);
  }

  async recover(): Promise<void> {
    await logInjection(this.pool.get('sim'), 'recover', 'all');
    await this.pool.connectConfiguredActors(this.config);
    for (const robotId of this.offlineRobots) this.robots.start(robotId);
    this.offlineRobots.clear();
    for (const actor of this.pool.list()) {
      if (actor.role === 'robot') await actor.connection.reducers.robotReportDevice({ robotId: actor.name, device: 'thermal', status: DeviceHealth.Ok, detail: 'recovered by simulator', observedAt: undefined });
    }
    for (const key of this.rescuers.injectedKeys()) this.rescuers.resume(key);
    this.rescuers.releaseHolds();
  }
}

function participantFor(sim: SimActor, actor: SimActor) {
  const row = Array.from(sim.connection.db.participant.iter()).find((item) => hex(item.identity) === actor.identity);
  if (!row) throw new Error(`Participant not found for ${actor.name}`);
  return row;
}

function hex(identity: { toHexString(): string }): string { return identity.toHexString().toLowerCase().replace(/^0x/, ''); }
