import { CellStatus, MissionStatus, RobotState, TerrainAction, TerrainClass } from '../../spacetimedb-bindings/types.js';
import type { Mission, SearchCell } from '../../spacetimedb-bindings/types.js';
import type { DemoSiteConfig, Offset } from './config.ts';
import { bearingDegrees, distanceMeters, offsetToLatLon, walkToward, type LatLon } from './geo.ts';
import { hiddenClinical, reportDetectionAndWait, writeClinical } from './finding.ts';
import type { SimActor, SimPool } from './pool.ts';
import { mulberry32 } from './rng.ts';
import { replayHouse3 } from './replay.ts';
import { SCALE_HOLD_REASON } from './scale.ts';

const SWEEP_S = 5;

export class SimRobotRunner {
  private readonly timers = new Map<string, NodeJS.Timeout[]>();
  private readonly states = new Map<string, RobotState>();
  private readonly positions = new Map<string, { point: LatLon; heading: number }>();
  private readonly started = new Map<string, number>();
  private readonly armed = new Set<number>();
  private missionLoop: AbortController | undefined;
  private replaying = false;

  constructor(private readonly config: DemoSiteConfig, private readonly pool: SimPool) {}

  get dogId(): string { return this.config.robots.sim.robot_id; }

  startDog(): void {
    this.startHeartbeat(this.dogId, this.config.robots.sim.home);
    if (this.missionLoop) return;
    const controller = new AbortController();
    this.missionLoop = controller;
    void this.runMissions(controller.signal)
      .catch((error: unknown) => { if (!controller.signal.aborted) console.error(`${this.dogId} mission loop stopped: ${errorText(error)}`); })
      .finally(() => { if (this.missionLoop === controller) this.missionLoop = undefined; });
  }

  startFleet(): void {
    for (let index = 0; index < this.config.robots.fleet_size; index += 1) {
      this.startHeartbeat(`${this.dogId}-${index + 2}`, { east_m: (index * 35) % 150 - 75, north_m: -80 - index * 10 });
    }
  }

  start(robotId: string): void {
    if (robotId === this.dogId) this.startDog();
    else this.startFleet();
  }

  startAll(): void { this.startFleet(); this.startDog(); }

  stop(robotId: string): void {
    for (const timer of this.timers.get(robotId) ?? []) clearInterval(timer);
    this.timers.delete(robotId);
    if (robotId === this.dogId) {
      this.missionLoop?.abort();
      this.missionLoop = undefined;
    }
  }

  stopAll(): void { for (const robotId of [...this.timers.keys()]) this.stop(robotId); }

  isRunning(robotId: string): boolean { return this.timers.has(robotId); }

  anyRunning(): boolean { return this.timers.size > 0 || this.missionLoop !== undefined; }

  armHidden(): number {
    for (let index = 0; index < this.config.hidden_survivors.length; index += 1) this.armed.add(index);
    return this.armed.size;
  }

  armedCount(): number { return this.armed.size; }

  async replayHouse3(): Promise<void> {
    if (this.replaying) throw new Error('robot replay is already running');
    const wasLooping = this.missionLoop !== undefined;
    this.missionLoop?.abort();
    this.missionLoop = undefined;
    this.replaying = true;
    const keepHeartbeat = this.isRunning(this.dogId);
    this.startHeartbeat(this.dogId, this.config.robots.sim.home);
    const controller = new AbortController();
    try {
      this.states.set(this.dogId, RobotState.Active);
      const anchor = this.config.demo_anchor;
      await this.walkTo(this.pointFor(anchor), controller.signal);
      const inside = this.pointFor({ east_m: anchor.east_m, north_m: anchor.north_m + 15 });
      await this.walkTo(inside, controller.signal);
      await replayHouse3(this.config, this.pool, this.dogId, this.currentMissionId(), inside);
    } finally {
      this.states.set(this.dogId, RobotState.Ready);
      this.replaying = false;
      if (wasLooping) this.startDog();
      else if (!keepHeartbeat) this.stop(this.dogId);
    }
  }

  private startHeartbeat(robotId: string, home: Offset): void {
    if (this.timers.has(robotId)) return;
    const actor = this.pool.get(robotId);
    if (!this.positions.has(robotId)) this.positions.set(robotId, { point: this.pointFor(home), heading: 0 });
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

  private async runMissions(signal: AbortSignal): Promise<void> {
    const actor = this.pool.get(this.dogId);
    while (!signal.aborted) {
      try {
        await actor.connection.reducers.claimNextMission({ robotId: this.dogId });
      } catch (error) {
        console.warn(`${this.dogId} could not claim a mission: ${errorText(error)}`);
        await delay(2_000, signal);
        continue;
      }
      const mission = this.ownMission(actor);
      if (!mission) {
        this.states.set(this.dogId, RobotState.Ready);
        await delay(1_000, signal);
        continue;
      }
      try {
        await this.runMission(actor, mission, signal);
      } catch (error) {
        if (!signal.aborted) console.warn(`${this.dogId} mission ${mission.id} stopped: ${errorText(error)}`);
        await delay(1_000, signal);
      } finally {
        this.states.set(this.dogId, RobotState.Ready);
      }
    }
  }

  private async runMission(actor: SimActor, mission: Mission, signal: AbortSignal): Promise<void> {
    const reducers = actor.connection.reducers;
    this.states.set(this.dogId, RobotState.Active);
    console.log(`${this.dogId} running mission ${mission.id} (${mission.kind.tag})`);
    if (mission.status.tag === 'Leased') await reducers.missionProgress({ missionId: mission.id, status: MissionStatus.Active, note: 'starting', observedAt: undefined });
    const terrain = new TerrainReporter(this.config, actor, this.dogId, mulberry32(this.config.scale.seed + Number(mission.id)));
    let note = '';
    if (mission.kind.tag === 'SearchCells') {
      const labels: string[] = [];
      for (const cellId of mission.targetCellIds) {
        const cell = Array.from(actor.connection.db.searchCell.iter()).find((row) => row.id === cellId);
        if (!cell || signal.aborted) continue;
        labels.push(cell.label);
        if (cell.status.tag === 'Searched') continue;
        await this.walkTo({ lat: cell.lat, lon: cell.lon }, signal, terrain);
        if (signal.aborted) return;
        await this.searchCell(actor, mission, cell, signal, terrain);
      }
      note = `searched ${labels.join(', ')}`;
    } else if (mission.kind.tag === 'Inspect' && mission.targetLat !== undefined && mission.targetLon !== undefined) {
      const target = { lat: mission.targetLat, lon: mission.targetLon };
      await this.walkTo(target, signal, terrain);
      const cell = this.cellAt(actor, target);
      if (cell) await this.reportHiddenIn(cell, mission.id);
      note = `inspected ${cell?.label ?? 'target point'}`;
    } else if (mission.kind.tag === 'ReturnHome') {
      await this.walkTo(this.pointFor(this.config.robots.sim.home), signal, terrain);
      note = 'returned home';
    } else if (mission.reason === SCALE_HOLD_REASON) {
      note = 'released a fleet hold mission requeued after its robot went offline';
    } else {
      while (!signal.aborted && !this.hasOtherQueuedMission(actor, mission.id)) await delay(1_000, signal);
      note = 'hold released for the next mission';
    }
    if (signal.aborted) return;
    await reducers.missionProgress({ missionId: mission.id, status: MissionStatus.Done, note, observedAt: undefined });
    console.log(`${this.dogId} mission ${mission.id} done: ${note}`);
  }

  private async searchCell(actor: SimActor, mission: Mission, cell: SearchCell, signal: AbortSignal, terrain: TerrainReporter): Promise<void> {
    const reducers = actor.connection.reducers;
    await reducers.markCell({ cellId: cell.id, status: CellStatus.Searching, observedAt: undefined });
    const house = this.config.houses.find((item) => item.label === cell.label);
    for (let second = 0; second < SWEEP_S && !signal.aborted; second += 1) {
      await terrain.report(this.positions.get(this.dogId)!.point, second === 1 && house?.view_blocked === true);
      await delay(1_000, signal);
    }
    if (signal.aborted) return;
    await this.reportHiddenIn(cell, mission.id);
    const status = house?.view_blocked ? CellStatus.PartiallySearched : CellStatus.Searched;
    await reducers.markCell({ cellId: cell.id, status, observedAt: undefined });
    console.log(`${this.dogId} marked ${cell.label} ${house?.view_blocked ? 'partially_searched' : 'searched'}`);
  }

  private async reportHiddenIn(cell: SearchCell, missionId: bigint): Promise<void> {
    for (const index of [...this.armed]) {
      const entry = this.config.hidden_survivors[index]!;
      if (entry.house !== cell.label) continue;
      const point = this.pointFor(entry);
      const survivorId = await reportDetectionAndWait(this.pool, { robotId: this.dogId, missionId, point, note: entry.note });
      await writeClinical(this.pool, survivorId, hiddenClinical(this.config, index));
      this.armed.delete(index);
      console.log(`${this.dogId} found the hidden survivor in ${entry.house} (survivor ${survivorId})`);
    }
  }

  private async walkTo(target: LatLon, signal: AbortSignal, terrain?: TerrainReporter): Promise<void> {
    const speed = 1.2 * this.config.timing.speedup;
    const stepMs = this.config.timing.position_ms;
    let lastTerrain = 0;
    while (!signal.aborted) {
      const current = this.positions.get(this.dogId)!;
      const distance = distanceMeters(current.point, target);
      if (distance < 0.5) return;
      const heading = bearingDegrees(current.point, target);
      this.positions.set(this.dogId, { point: walkToward(current.point, target, Math.min(distance, speed * stepMs / 1000)), heading });
      if (terrain && Date.now() - lastTerrain >= 1_000) {
        await terrain.report(this.positions.get(this.dogId)!.point, false);
        lastTerrain = Date.now();
      }
      await delay(stepMs, signal);
    }
  }

  private ownMission(actor: SimActor): Mission | undefined {
    return Array.from(actor.connection.db.mission.iter())
      .filter((row) => row.robotId === this.dogId && (row.status.tag === 'Leased' || row.status.tag === 'Active'))
      .sort((a, b) => Number(a.id - b.id))[0];
  }

  private hasOtherQueuedMission(actor: SimActor, missionId: bigint): boolean {
    return Array.from(actor.connection.db.mission.iter()).some((row) => row.id !== missionId && row.status.tag === 'Queued' && (row.robotId === '' || row.robotId === this.dogId));
  }

  private currentMissionId(): bigint {
    const actor = this.pool.get(this.dogId);
    return Array.from(actor.connection.db.robot.iter()).find((row) => row.robotId === this.dogId)?.currentMissionId ?? 0n;
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
