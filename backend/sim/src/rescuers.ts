import { Resolution } from '../../spacetimedb-bindings/types.js';
import type { DemoSiteConfig } from './config.ts';
import { distanceMeters, offsetToLatLon, walkToward, type LatLon } from './geo.ts';
import { generateExtraRescuerStarts } from './setup.ts';
import type { SimActor, SimPool } from './pool.ts';
import { waitForValue } from './wait.ts';
import { mulberry32 } from './rng.ts';

export class RescuerRunner {
  private readonly controllers = new Map<string, AbortController>();
  private readonly paused = new Set<string>();
  private readonly dropped = new Set<string>();
  private readonly held = new Set<string>();
  private readonly positions = new Map<string, LatLon>();

  constructor(private readonly config: DemoSiteConfig, private readonly pool: SimPool) {}

  start(): void {
    for (const actor of this.pool.list()) if (actor.role === 'rescuer' && actor.key !== 'cayden') this.startActor(actor);
  }

  startActor(actor: SimActor): void {
    if (this.controllers.has(actor.key)) return;
    const controller = new AbortController();
    this.controllers.set(actor.key, controller);
    void this.runActor(actor, controller.signal).catch((error: unknown) => {
      if (!controller.signal.aborted) console.error(`Rescuer ${actor.name} stopped: ${errorText(error)}`);
    }).finally(() => this.controllers.delete(actor.key));
  }

  anyRunning(): boolean { return this.controllers.size > 0; }

  pause(key: string): void { this.paused.add(key); }
  resume(key: string): void {
    this.paused.delete(key);
    this.dropped.delete(key);
    const actor = this.pool.get(key);
    this.startActor(actor);
  }

  hold(key: string): void { this.held.add(key); }
  releaseHolds(): void { this.held.clear(); }

  injectedKeys(): string[] { return [...new Set([...this.paused, ...this.dropped])]; }

  positionOf(key: string): LatLon | undefined { return this.positions.get(key) ?? this.startPoint(key); }

  placeNear(key: string, point: LatLon): void { this.positions.set(key, point); }

  drop(key: string): void {
    this.pause(key);
    this.dropped.add(key);
    this.controllers.get(key)?.abort();
    this.controllers.delete(key);
    const actor = this.pool.get(key);
    actor.disconnect();
  }

  stop(): void {
    for (const [key, controller] of this.controllers) {
      controller.abort();
      this.controllers.delete(key);
    }
  }

  private async runActor(actor: SimActor, signal: AbortSignal): Promise<void> {
    const start = this.startPoint(actor.key);
    if (!start) return;
    if (!this.positions.has(actor.key)) this.positions.set(actor.key, start);
    const random = mulberry32(this.config.scale.seed + actor.key.split('').reduce((seed, char) => seed * 31 + char.charCodeAt(0), 0));
    let lastPosition = 0;
    const completed = new Set<string>();
    let heartbeatBusy = false;
    await actor.connection.reducers.rescuerHeartbeat({});
    const heartbeatTimer = setInterval(() => {
      if (signal.aborted || this.paused.has(actor.key) || heartbeatBusy) return;
      heartbeatBusy = true;
      void actor.connection.reducers.rescuerHeartbeat({})
        .catch((error: unknown) => console.warn(`Rescuer ${actor.name} heartbeat failed: ${errorText(error)}`))
        .finally(() => { heartbeatBusy = false; });
    }, this.config.timing.rescuer_heartbeat_ms);
    try {
    while (!signal.aborted) {
      if (this.paused.has(actor.key)) {
        await delay(200, signal);
        continue;
      }
      const now = Date.now();
      if (now - lastPosition >= this.config.timing.position_ms) {
        await actor.connection.reducers.participantUpdatePosition(this.positions.get(actor.key)!);
        lastPosition = now;
      }
      const assignment = this.held.has(actor.key) ? undefined : Array.from(actor.connection.db.myAssignment.iter()).find((row) => (
        sameIdentity(row.rescuerIdentity, actor.identity) && row.status.tag === 'Proposed' && !completed.has(row.id.toString())
      ));
      if (assignment) {
        const assignmentId = assignment.id;
        completed.add(assignmentId.toString());
        const [minimum, maximum] = this.config.timing.accept_delay_s;
        await delay(minimum * 1000 + Math.floor(random() * (maximum - minimum + 1)) * 1000, signal);
        if (signal.aborted || this.paused.has(actor.key)) continue;
        try {
          await actor.connection.reducers.acceptAssignment({ assignmentId });
          await actor.connection.reducers.startEnRoute({ assignmentId });
        } catch (error) {
          completed.delete(assignmentId.toString());
          console.warn(`Rescuer ${actor.name} could not accept assignment ${assignmentId}: ${errorText(error)}`);
          continue;
        }
        const survivor = await waitForValue(actor, () => Array.from(actor.connection.db.mySurvivor.iter()).find((row) => row.id === assignment.survivorId), 10_000);
        if (!survivor) throw new Error(`Survivor ${assignment.survivorId} disappeared from the subscription`);
        await this.walkTo(actor, { lat: survivor.lat, lon: survivor.lon }, signal);
        if (signal.aborted) return;
        try { await actor.connection.reducers.markReached({ survivorId: survivor.id }); }
        catch (error) { console.warn(`Rescuer ${actor.name} could not mark reached: ${errorText(error)}`); }
        if (this.config.timing.auto_resolve_sim_rescues) {
          await delay(this.config.timing.on_scene_s * 1000, signal);
          if (signal.aborted) return;
          try { await actor.connection.reducers.resolveSurvivor({ survivorId: survivor.id, resolution: Resolution.Rescued, note: 'simulated rescuer reached the person' }); }
          catch (error) { console.warn(`Rescuer ${actor.name} could not resolve survivor: ${errorText(error)}`); }
        }
        await this.walkTo(actor, start, signal);
        lastPosition = 0;
      } else {
        await delay(200, signal);
      }
    }
    } finally {
      clearInterval(heartbeatTimer);
    }
  }

  private async walkTo(actor: SimActor, target: LatLon, signal: AbortSignal): Promise<void> {
    const speed = 1.4 * this.config.timing.speedup;
    while (!signal.aborted) {
      const point = this.positions.get(actor.key)!;
      const distance = distanceMeters(point, target);
      if (distance <= 5) return;
      const next = walkToward(point, target, Math.min(distance, speed * this.config.timing.position_ms / 1000));
      this.positions.set(actor.key, next);
      await actor.connection.reducers.participantUpdatePosition(next);
      await delay(this.config.timing.position_ms, signal);
    }
  }

  private startPoint(key: string): LatLon | undefined {
    const configured = this.config.rescuers.find((rescuer) => rescuer.key === key);
    if (configured?.start) {
      return offsetToLatLon({ lat: this.config.site.center_lat, lon: this.config.site.center_lon }, configured.start);
    }
    const extra = generateExtraRescuerStarts(this.config).find((rescuer) => rescuer.key === key);
    return extra ? { lat: extra.lat, lon: extra.lon } : undefined;
  }
}

function sameIdentity(value: { toHexString(): string }, identity: string): boolean {
  return value.toHexString().toLowerCase().replace(/^0x/, '') === identity;
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
