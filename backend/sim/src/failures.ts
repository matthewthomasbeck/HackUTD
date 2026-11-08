import { DeviceHealth } from '../../spacetimedb-bindings/types.js';
import { spawnSurvivorAt } from './commands.ts';
import { simRobotIds, type DemoSiteConfig } from './config.ts';
import { distanceMeters, walkToward, type LatLon } from './geo.ts';
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
      if (!simRobotIds(this.config).includes(robotId)) throw new Error(`The simulator can only stop a simulated robot (${simRobotIds(this.config).join(', ')})`);
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
      await robot.connection.reducers.robotReportDevice({ robotId, device, status: health, detail: status === 'FAILED' ? 'no frames for 3 s' : `${device} ${status.toLowerCase()}`, observedAt: undefined });
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
    await logInjection(sim, 'imbalance', key);
    const wasHeld = this.rescuers.isHeld(key);
    this.rescuers.hold(key);
    let loadedOk = false;
    try {
      await loadRescuer(sim, loaded, loadedParticipant.identity, origin);
      loadedOk = true;
    } finally {
      if (!loadedOk && !wasHeld) this.rescuers.unhold(key);
    }
    const idle = this.pool.list()
      .filter((actor) => actor.role === 'rescuer' && actor.key !== key && openFor(actor.identity).length === 0 && this.rescuers.positionOf(actor.key))
      .sort((a, b) => distanceMeters(origin, this.rescuers.positionOf(a.key)!) - distanceMeters(origin, this.rescuers.positionOf(b.key)!))[0];
    if (idle) this.rescuers.placeNear(idle.key, walkToward(origin, this.rescuers.positionOf(idle.key)!, 25));
    const point = walkToward(origin, { lat: origin.lat + 0.00006, lon: origin.lon }, 6);
    const survivorId = await spawnSurvivorAt(this.config, this.pool, 'delayed', point, `next to ${loaded.name}`);
    const active = openFor(loaded.identity).filter((row) => row.status.tag === 'Active').length;
    console.log(`${loaded.name} holds ${active} active assignments; ${idle ? `${idle.name} is idle nearby` : 'no idle sim rescuer found'}; new delayed survivor ${survivorId} next to ${loaded.name}.`);
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

// Brings one held sim rescuer up to IMBALANCE_LOAD active assignments. The module allows one
// pending proposal per rescuer, and the module watchdog or the orchestrator can propose to the
// same rescuer at any moment. A proposal already pending for this rescuer is accepted as part of
// the load (the held sim loop no longer accepts it), and a rejected proposal is retried.
export async function loadRescuer(sim: SimActor, loaded: SimActor, rescuerIdentity: ReturnType<typeof participantFor>['identity'], origin: LatLon, load = IMBALANCE_LOAD, maxAttempts = 3 * IMBALANCE_LOAD): Promise<number> {
  const mine = () => Array.from(loaded.connection.db.myAssignment.iter()).filter((row) => hex(row.rescuerIdentity) === loaded.identity);
  const activeCount = () => mine().filter((row) => row.status.tag === 'Active').length;
  const skipped = new Set<bigint>();
  let lastError = '';
  for (let attempt = 0; attempt < maxAttempts && activeCount() < load; attempt += 1) {
    let proposal = mine().find((row) => row.status.tag === 'Proposed');
    if (!proposal) {
      const openSurvivors = new Set(Array.from(sim.connection.db.assignment.iter()).filter((row) => row.status.tag === 'Proposed' || row.status.tag === 'Active').map((row) => row.survivorId));
      const survivor = Array.from(sim.connection.db.survivor.iter())
        .filter((row) => row.status.tag === 'Unassigned' && row.criticalLevel.tag === 'Delayed' && !openSurvivors.has(row.id) && !skipped.has(row.id))
        .sort((a, b) => distanceMeters(origin, a) - distanceMeters(origin, b))[0];
      if (!survivor) throw new Error(`imbalance needs ${load - activeCount()} more unassigned delayed survivors; run scale first`);
      try {
        await sim.connection.reducers.proposeAssignment({ survivorId: survivor.id, rescuerIdentity, reason: 'sim imbalance: load one rescuer' });
        proposal = await waitForValue(loaded, () => mine().find((row) => row.survivorId === survivor.id && row.status.tag === 'Proposed'));
      } catch (error) {
        lastError = errorText(error);
        if (!/pending proposal/.test(lastError)) skipped.add(survivor.id);
        await new Promise((resolve) => setTimeout(resolve, 250));
        continue;
      }
    }
    const proposalId = proposal.id;
    try {
      await loaded.connection.reducers.acceptAssignment({ assignmentId: proposalId });
      await waitForValue(loaded, () => mine().find((row) => row.id === proposalId && row.status.tag === 'Active'));
    } catch (error) {
      lastError = errorText(error);
      skipped.add(proposal.survivorId);
      // Decline a proposal that is still pending but cannot be accepted, so it does not block the next one.
      if (mine().some((row) => row.id === proposalId && row.status.tag === 'Proposed')) {
        await loaded.connection.reducers.releaseAssignment({ assignmentId: proposalId }).catch(() => undefined);
      }
    }
  }
  const active = activeCount();
  if (active < load) throw new Error(`imbalance gave ${loaded.name} only ${active} of ${load} active assignments${lastError ? `: ${lastError}` : ''}`);
  return active;
}

function errorText(error: unknown): string { return error instanceof Error ? error.message : String(error); }

function participantFor(sim: SimActor, actor: SimActor) {
  const row = Array.from(sim.connection.db.participant.iter()).find((item) => hex(item.identity) === actor.identity);
  if (!row) throw new Error(`Participant not found for ${actor.name}`);
  return row;
}

function hex(identity: { toHexString(): string }): string { return identity.toHexString().toLowerCase().replace(/^0x/, ''); }
