import { CellStatus, MissionStatus, RobotState, TerrainAction, TerrainClass } from '../../spacetimedb-bindings/types.js';
import type { Mission, SearchCell } from '../../spacetimedb-bindings/types.js';
import { simRobotHome, type DemoSiteConfig, type Offset } from './config.ts';
import { bearingDegrees, distanceMeters, offsetToLatLon, walkToward, type LatLon } from './geo.ts';
import { hiddenClinical, reportDetectionAndWait, writeClinical } from './finding.ts';
import type { SimActor, SimPool } from './pool.ts';
import { mulberry32 } from './rng.ts';
import { replayHouse3 } from './replay.ts';
import { SCALE_HOLD_REASON } from './scale.ts';

const SWEEP_S = 5;
// Remote driving, as the robot's TeleopBehavior (docs/specs/robot.md 18.1): drive on the newest teleop row and stop
// when it has not changed for the dead-man time. A full stick (the robot's 0.2 m/s limit) moves the sim dog at
// SIM_DRIVE_MPS, fast enough to show on the map and slow enough to steer, whatever timing.speedup is.
const TELEOP_DEADMAN_MS = 300;
const TELEOP_MAX_LIN_MPS = 0.2;
const TELEOP_STEP_MS = 100;
const TELEOP_REPORT_MS = 250;
const SIM_DRIVE_MPS = 4;

// Runs the sim robots: sim-dog (robots.sim) and sim-drone (robots.drone, 2026-11-08, in the old second dog's place).
// Both get the same heartbeats, positions, mission loop (search, inspect, return home, hold), findings, and remote
// driving. Only sim-dog reports terrain (the ground robot's lidar and IMU rules) and replays the house 3 find.
export class SimRobotRunner {
  private readonly timers = new Map<string, NodeJS.Timeout[]>();
  private readonly states = new Map<string, RobotState>();
  private readonly positions = new Map<string, { point: LatLon; heading: number }>();
  private readonly started = new Map<string, number>();
  private readonly armed = new Set<number>();
  private readonly missionLoops = new Map<string, AbortController>();
  private replaying = false;

  constructor(private readonly config: DemoSiteConfig, private readonly pool: SimPool) {}

  get dogId(): string { return this.config.robots.sim.robot_id; }
  get droneId(): string { return this.config.robots.drone.robot_id; }

  startDog(): void { this.startRobot(this.dogId); }

  // The drone runs whenever the simulator keeps its actors connected (the console), as the second dog's heartbeat did.
  startFleet(): void { this.startRobot(this.droneId); }

  start(robotId: string): void { this.startRobot(robotId); }

  startAll(): void { this.startFleet(); this.startDog(); }

  stop(robotId: string): void {
    for (const timer of this.timers.get(robotId) ?? []) clearInterval(timer);
    this.timers.delete(robotId);
    this.missionLoops.get(robotId)?.abort();
    this.missionLoops.delete(robotId);
  }

  stopAll(): void { for (const robotId of new Set([...this.timers.keys(), ...this.missionLoops.keys()])) this.stop(robotId); }

  isRunning(robotId: string): boolean { return this.timers.has(robotId); }

  anyRunning(): boolean { return this.timers.size > 0 || this.missionLoops.size > 0; }

  armHidden(): number {
    for (let index = 0; index < this.config.hidden_survivors.length; index += 1) this.armed.add(index);
    return this.armed.size;
  }

  armedCount(): number { return this.armed.size; }

  async replayHouse3(): Promise<void> {
    if (this.replaying) throw new Error('robot replay is already running');
    const dogId = this.dogId;
    const wasLooping = this.missionLoops.has(dogId);
    this.missionLoops.get(dogId)?.abort();
    this.missionLoops.delete(dogId);
    this.replaying = true;
    const keepHeartbeat = this.isRunning(dogId);
    this.startHeartbeat(dogId);
    const controller = new AbortController();
    try {
      this.states.set(dogId, RobotState.Active);
      const anchor = this.config.demo_anchor;
      await this.walkTo(dogId, this.pointFor(anchor), controller.signal);
      const inside = this.pointFor({ east_m: anchor.east_m, north_m: anchor.north_m + 15 });
      await this.walkTo(dogId, inside, controller.signal);
      await replayHouse3(this.config, this.pool, dogId, this.currentMissionId(dogId), inside);
    } finally {
      this.states.set(dogId, RobotState.Ready);
      this.replaying = false;
      if (wasLooping) this.startDog();
      else if (!keepHeartbeat) this.stop(dogId);
    }
  }

  private startRobot(robotId: string): void {
    this.homeOf(robotId); // throws for an id that is not a sim robot
    this.startHeartbeat(robotId);
    if (this.missionLoops.has(robotId)) return;
    const controller = new AbortController();
    this.missionLoops.set(robotId, controller);
    void this.runMissions(robotId, controller.signal)
      .catch((error: unknown) => { if (!controller.signal.aborted) console.error(`${robotId} mission loop stopped: ${errorText(error)}`); })
      .finally(() => { if (this.missionLoops.get(robotId) === controller) this.missionLoops.delete(robotId); });
  }

  private homeOf(robotId: string): Offset { return simRobotHome(this.config, robotId); }

  private startHeartbeat(robotId: string): void {
    if (this.timers.has(robotId)) return;
    const actor = this.pool.get(robotId);
    if (!this.positions.has(robotId)) this.positions.set(robotId, { point: this.pointFor(this.homeOf(robotId)), heading: 0 });
    if (!this.started.has(robotId)) this.started.set(robotId, Date.now());
    const beat = async () => {
      try {
        const minutes = (Date.now() - this.started.get(robotId)!) / 60_000;
        const batteryPct = Math.max(5, 95 - Math.floor(minutes));
        await actor.connection.reducers.robotHeartbeat({ robotId, state: this.states.get(robotId) ?? RobotState.Ready, batteryPct, observedAt: undefined });
      } catch (error) {
        console.error(`Sim robot ${robotId} heartbeat failed: ${errorText(error)}`);
      }
    };
    const report = async () => {
      const position = this.positions.get(robotId)!;
      try {
        await actor.connection.reducers.robotReportPosition({ robotId, ...position.point, gpsFix: false, indoorOffsetM: 0, headingDeg: position.heading, observedAt: undefined });
      } catch (error) {
        console.error(`Sim robot ${robotId} position failed: ${errorText(error)}`);
      }
    };
    void beat().then(report);
    this.timers.set(robotId, [
      setInterval(() => void beat(), this.config.timing.robot_heartbeat_ms),
      setInterval(() => void report(), this.config.timing.position_ms),
    ]);
  }

  private async runMissions(robotId: string, signal: AbortSignal): Promise<void> {
    const actor = this.pool.get(robotId);
    while (!signal.aborted) {
      try {
        await actor.connection.reducers.claimNextMission({ robotId });
      } catch (error) {
        console.warn(`${robotId} could not claim a mission: ${errorText(error)}`);
        await delay(2_000, signal);
        continue;
      }
      const mission = this.ownMission(actor, robotId);
      if (!mission) {
        this.states.set(robotId, RobotState.Ready);
        await delay(1_000, signal);
        continue;
      }
      try {
        await this.runMission(actor, robotId, mission, signal);
      } catch (error) {
        if (!signal.aborted) console.warn(`${robotId} mission ${mission.id} stopped: ${errorText(error)}`);
        await delay(1_000, signal);
      } finally {
        this.states.set(robotId, RobotState.Ready);
      }
    }
  }

  // Runs one mission until it is done, or until its row stops being this robot's leased or active mission (cancelled,
  // or paused by a take-over), as the bridge's cancel stops the real robot.
  private async runMission(actor: SimActor, robotId: string, mission: Mission, loopSignal: AbortSignal): Promise<void> {
    const ended = new AbortController();
    const stop = () => ended.abort();
    loopSignal.addEventListener('abort', stop, { once: true });
    const watch = setInterval(() => {
      const row = Array.from(actor.connection.db.mission.iter()).find((item) => item.id === mission.id);
      if (!row || row.robotId !== robotId || (row.status.tag !== 'Leased' && row.status.tag !== 'Active')) stop();
    }, 250);
    try {
      await this.runMissionSteps(actor, robotId, mission, ended.signal);
    } finally {
      clearInterval(watch);
      loopSignal.removeEventListener('abort', stop);
    }
  }

  private async runMissionSteps(actor: SimActor, robotId: string, mission: Mission, signal: AbortSignal): Promise<void> {
    const reducers = actor.connection.reducers;
    this.states.set(robotId, RobotState.Active);
    console.log(`${robotId} running mission ${mission.id} (${mission.kind.tag})`);
    if (mission.status.tag === 'Leased') await reducers.missionProgress({ missionId: mission.id, status: MissionStatus.Active, note: 'starting', observedAt: undefined });
    if (mission.kind.tag === 'Teleop') {
      await this.drive(actor, robotId, signal); // until the operator hands it back; a teleop mission never ends by itself
      return;
    }
    // Terrain is the ground robot's lidar and IMU rules, so the drone reports none.
    const terrain = robotId === this.dogId ? new TerrainReporter(this.config, actor, robotId, mulberry32(this.config.scale.seed + Number(mission.id))) : undefined;
    let note = '';
    if (mission.kind.tag === 'SearchCells') {
      const labels: string[] = [];
      for (const cellId of mission.targetCellIds) {
        const cell = Array.from(actor.connection.db.searchCell.iter()).find((row) => row.id === cellId);
        if (!cell || signal.aborted) continue;
        labels.push(cell.label);
        if (cell.status.tag === 'Searched') continue;
        await this.walkTo(robotId, { lat: cell.lat, lon: cell.lon }, signal, terrain);
        if (signal.aborted) return;
        await this.searchCell(actor, robotId, mission, cell, signal, terrain);
      }
      note = `searched ${labels.join(', ')}`;
    } else if (mission.kind.tag === 'Inspect' && mission.targetLat !== undefined && mission.targetLon !== undefined) {
      const target = { lat: mission.targetLat, lon: mission.targetLon };
      await this.walkTo(robotId, target, signal, terrain);
      const cell = this.cellAt(actor, target);
      if (cell) await this.reportHiddenIn(robotId, cell, mission.id);
      note = `inspected ${cell?.label ?? 'target point'}`;
    } else if (mission.kind.tag === 'ReturnHome') {
      await this.walkTo(robotId, this.pointFor(this.homeOf(robotId)), signal, terrain);
      note = 'returned home';
    } else if (mission.reason === SCALE_HOLD_REASON) {
      note = 'released a fleet hold mission requeued after its robot went offline';
    } else {
      while (!signal.aborted && !this.hasOtherQueuedMission(actor, robotId, mission.id)) await delay(1_000, signal);
      note = 'hold released for the next mission';
    }
    if (signal.aborted) return;
    await reducers.missionProgress({ missionId: mission.id, status: MissionStatus.Done, note, observedAt: undefined });
    console.log(`${robotId} mission ${mission.id} done: ${note}`);
  }

  private async searchCell(actor: SimActor, robotId: string, mission: Mission, cell: SearchCell, signal: AbortSignal, terrain: TerrainReporter | undefined): Promise<void> {
    const reducers = actor.connection.reducers;
    await reducers.markCell({ cellId: cell.id, status: CellStatus.Searching, observedAt: undefined });
    const house = this.config.houses.find((item) => item.label === cell.label);
    for (let second = 0; second < SWEEP_S && !signal.aborted; second += 1) {
      await terrain?.report(this.positions.get(robotId)!.point, second === 1 && house?.view_blocked === true);
      await delay(1_000, signal);
    }
    if (signal.aborted) return;
    await this.reportHiddenIn(robotId, cell, mission.id);
    const status = house?.view_blocked ? CellStatus.PartiallySearched : CellStatus.Searched;
    await reducers.markCell({ cellId: cell.id, status, observedAt: undefined });
    console.log(`${robotId} marked ${cell.label} ${house?.view_blocked ? 'partially_searched' : 'searched'}`);
  }

  private async reportHiddenIn(robotId: string, cell: SearchCell, missionId: bigint): Promise<void> {
    for (const index of [...this.armed]) {
      const entry = this.config.hidden_survivors[index]!;
      if (entry.house !== cell.label) continue;
      const point = this.pointFor(entry);
      const survivorId = await reportDetectionAndWait(this.pool, { robotId, missionId, point, note: entry.note });
      await writeClinical(this.pool, survivorId, hiddenClinical(this.config, index));
      this.armed.delete(index);
      console.log(`${robotId} found the hidden survivor in ${entry.house} (survivor ${survivorId})`);
    }
  }

  private async walkTo(robotId: string, target: LatLon, signal: AbortSignal, terrain?: TerrainReporter): Promise<void> {
    const speed = 1.2 * this.config.timing.speedup;
    const stepMs = this.config.timing.position_ms;
    let lastTerrain = 0;
    while (!signal.aborted) {
      const current = this.positions.get(robotId)!;
      const distance = distanceMeters(current.point, target);
      if (distance < 0.5) return;
      const heading = bearingDegrees(current.point, target);
      this.positions.set(robotId, { point: walkToward(current.point, target, Math.min(distance, speed * stepMs / 1000)), heading });
      if (terrain && Date.now() - lastTerrain >= 1_000) {
        await terrain.report(this.positions.get(robotId)!.point, false);
        lastTerrain = Date.now();
      }
      await delay(stepMs, signal);
    }
  }

  private async drive(actor: SimActor, robotId: string, signal: AbortSignal): Promise<void> {
    const scale = SIM_DRIVE_MPS / TELEOP_MAX_LIN_MPS;
    let lastSeq: bigint | undefined;
    let changedAt = 0;
    let reportedAt = 0;
    let moved = false;
    while (!signal.aborted) {
      const row = actor.connection.db.teleop.robotId.find(robotId);
      const now = Date.now();
      if (row && row.seq !== lastSeq) { lastSeq = row.seq; changedAt = now; }
      if (row && now - changedAt <= TELEOP_DEADMAN_MS && (row.vxMps !== 0 || row.vyMps !== 0 || row.wzDps !== 0)) {
        this.positions.set(robotId, teleopStep(this.positions.get(robotId)!, row, TELEOP_STEP_MS / 1000, scale));
        moved = true;
      }
      if (moved && now - reportedAt >= TELEOP_REPORT_MS) {
        moved = false;
        reportedAt = now;
        const position = this.positions.get(robotId)!;
        void actor.connection.reducers.robotReportPosition({ robotId, ...position.point, gpsFix: false, indoorOffsetM: 0, headingDeg: position.heading, observedAt: undefined })
          .catch((error: unknown) => console.error(`Sim robot ${robotId} position failed: ${errorText(error)}`));
      }
      await delay(TELEOP_STEP_MS, signal);
    }
  }

  private ownMission(actor: SimActor, robotId: string): Mission | undefined {
    return Array.from(actor.connection.db.mission.iter())
      .filter((row) => row.robotId === robotId && (row.status.tag === 'Leased' || row.status.tag === 'Active'))
      .sort((a, b) => Number(a.id - b.id))[0];
  }

  private hasOtherQueuedMission(actor: SimActor, robotId: string, missionId: bigint): boolean {
    return Array.from(actor.connection.db.mission.iter()).some((row) => row.id !== missionId && row.status.tag === 'Queued' && (row.robotId === '' || row.robotId === robotId));
  }

  private currentMissionId(robotId: string): bigint {
    const actor = this.pool.get(robotId);
    return Array.from(actor.connection.db.robot.iter()).find((row) => row.robotId === robotId)?.currentMissionId ?? 0n;
  }

  private cellAt(actor: SimActor, point: LatLon): SearchCell | undefined {
    return Array.from(actor.connection.db.searchCell.iter())
      .map((row) => ({ row, distance: distanceMeters(point, { lat: row.lat, lon: row.lon }) }))
      .filter((item) => item.distance <= item.row.sizeM / Math.SQRT2)
      .sort((a, b) => a.distance - b.distance)[0]?.row;
  }

  private pointFor(offset: Offset): LatLon {
    return offsetToLatLon({ lat: this.config.site.center_lat, lon: this.config.site.center_lon }, offset);
  }
}

// One remote driving step. heading is a compass bearing (clockwise from north) and + wz turns left (counterclockwise),
// so a turn subtracts; vx is forward along the heading and vy is to the left. scale multiplies the linear speeds.
export function teleopStep(position: { point: LatLon; heading: number }, command: { vxMps: number; vyMps: number; wzDps: number }, dtS: number, scale: number): { point: LatLon; heading: number } {
  const heading = ((position.heading - command.wzDps * dtS) % 360 + 360) % 360;
  const radians = heading * Math.PI / 180;
  const forward = command.vxMps * scale * dtS;
  const left = command.vyMps * scale * dtS;
  const point = offsetToLatLon(position.point, {
    east_m: forward * Math.sin(radians) - left * Math.cos(radians),
    north_m: forward * Math.cos(radians) + left * Math.sin(radians),
  });
  return { point, heading };
}

class TerrainReporter {
  private blocked = false;

  constructor(private readonly config: DemoSiteConfig, private readonly actor: SimActor, private readonly robotId: string, private readonly random: () => number) {}

  async report(point: LatLon, blockedHere: boolean): Promise<void> {
    const center = { lat: this.config.site.center_lat, lon: this.config.site.center_lon };
    const nearHouse = this.config.houses.some((house) => distanceMeters(point, offsetToLatLon(center, house)) <= 10);
    let terrainClass: TerrainClass = TerrainClass.Flat;
    let action: TerrainAction = TerrainAction.Continue;
    if (blockedHere && !this.blocked) {
      this.blocked = true;
      terrainClass = TerrainClass.Blocked;
      action = TerrainAction.Stop;
    } else if (nearHouse && this.random() < 0.7) {
      terrainClass = TerrainClass.Debris;
      action = TerrainAction.Slow;
    } else if (nearHouse) {
      terrainClass = TerrainClass.Step;
      action = TerrainAction.Steer;
    }
    try {
      await this.actor.connection.reducers.reportTerrain({
        robotId: this.robotId,
        ...point,
        terrainClass,
        confidence: 0.7 + this.random() * 0.2,
        source: 'lidar_imu_rules',
        action,
        imageUrl: undefined,
        observedAt: undefined,
      });
    } catch (error) {
      console.warn(`${this.robotId} terrain report failed: ${errorText(error)}`);
    }
  }
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, ms);
    const abort = () => { clearTimeout(timeout); resolve(); };
    signal.addEventListener('abort', abort, { once: true });
  });
}

function errorText(error: unknown): string { return error instanceof Error ? error.message : String(error); }
