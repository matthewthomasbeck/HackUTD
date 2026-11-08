// Decides, for each local message, whether it goes to SpacetimeDB now or to the spool, and keeps
// order: once anything is spooled, every later message (except heartbeats) goes to the end of the
// spool until the replay has drained it.
// - heartbeat: sent live whenever connected, never spooled (also during replay, so the robot stays
//   online and its lease renews while a long spool drains).
// - position, terrain: current state, sent without waiting behind slower messages; a failed send
//   is spooled only if no newer one of the same type has been seen.
// - device, cell, mission_progress, detection: one at a time, in arrival order.
// - mission_id 0 and positions with no lat/lon: logged only.
// - Until the robot row exists (the first robot_heartbeat creates it), everything else is spooled,
//   because the module rejects other robot reducers with "heartbeat first".

import { localOnlyReason, type LocalMessage } from './mapping.ts';
import type { SendOutcome, Spool } from './spool.ts';

export interface RouterDeps {
  isReady: () => boolean;
  /** The robot row for ROBOT_ID is in the subscription cache. */
  hasRobotRow: () => boolean;
  spool: Pick<Spool, 'append' | 'replay' | 'size' | 'replaying'>;
  /** Map and send one message (uploads first for a detection). */
  process: (msg: LocalMessage) => Promise<SendOutcome>;
  log: (line: string) => void;
}

const UNORDERED = new Set(['position', 'terrain']);

export class Router {
  private readonly queue: LocalMessage[] = [];
  private draining = false;
  private replayRun: Promise<void> | undefined;
  private readonly inFlight = new Set<Promise<unknown>>();
  /** Newest position and terrain handed to handle(), so an older failure cannot replace it. */
  private readonly newest = new Map<string, LocalMessage>();

  constructor(private readonly deps: RouterDeps) {}

  handle(msg: LocalMessage): void {
    const reason = localOnlyReason(msg);
    if (reason) {
      this.deps.log(`local only, not sent: ${msg.type} (${reason})`);
      return;
    }
    if (msg.type === 'heartbeat') {
      if (this.deps.isReady()) this.track(this.deps.process(msg));
      return;
    }
    if (UNORDERED.has(msg.type)) this.newest.set(msg.type, msg);
    // While the drain loop is busy or holds messages, it decides; spooling here would put this
    // message ahead of older ones still in the queue.
    if (this.draining || this.queue.length > 0) {
      this.queue.push(msg);
      this.startDrain();
      return;
    }
    if (this.mustSpool()) {
      this.spool(msg);
      this.startKick();
      return;
    }
    if (UNORDERED.has(msg.type)) {
      this.track(this.deps.process(msg).then((outcome) => {
        if (outcome === 'network' && this.newest.get(msg.type) === msg) this.spool(msg);
      }));
      return;
    }
    this.queue.push(msg);
    this.startDrain();
  }

  /** kick() for timers and callbacks: a spool disk error (ENOSPC) is logged, never unhandled. */
  startKick(): void {
    this.kick()?.catch((error: unknown) => this.deps.log(`spool replay failed: ${String(error)}`));
  }

  /** Start a replay if connected and the spool has entries. Safe to call often. */
  kick(): Promise<void> | undefined {
    if (this.replayRun || !this.canSend() || this.deps.spool.size === 0) return this.replayRun;
    this.replayRun = (async () => {
      try {
        const result = await this.deps.spool.replay(this.deps.process);
        if (result.sent + result.rejected > 0 || result.stopped) {
          this.deps.log(`spool replay: ${result.sent} sent, ${result.rejected} rejected${result.stopped ? ', stopped by a network failure' : ', done'}`);
        }
      } finally {
        this.replayRun = undefined;
      }
    })();
    return this.replayRun;
  }

  /** Wait for queued and in-flight work (tests and shutdown). */
  async idle(): Promise<void> {
    for (;;) {
      const waits = [...this.inFlight];
      if (this.replayRun) waits.push(this.replayRun);
      if (waits.length === 0 && !this.draining) return;
      await Promise.allSettled(waits);
      if (this.draining) await new Promise((resolve) => setImmediate(resolve));
    }
  }

  private canSend(): boolean {
    return this.deps.isReady() && this.deps.hasRobotRow();
  }

  private mustSpool(): boolean {
    return !this.canSend() || this.deps.spool.size > 0 || this.deps.spool.replaying;
  }

  private spool(msg: LocalMessage): void {
    try {
      const result = this.deps.spool.append(msg);
      if (result === 'dropped') this.deps.log(`spool full, lost a ${msg.type}`);
    } catch (error) {
      this.deps.log(`spool write failed, lost a ${msg.type}: ${String(error)}`); // disk full or gone
    }
  }

  private startDrain(): void {
    this.drain().catch((error: unknown) => this.deps.log(`send queue failed: ${String(error)}`));
  }

  private track(work: Promise<unknown>): void {
    const tracked = work.catch((error: unknown) => this.deps.log(`send failed: ${String(error)}`)).finally(() => this.inFlight.delete(tracked));
    this.inFlight.add(tracked);
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.queue.length > 0) {
        const msg = this.queue.shift()!;
        if (this.mustSpool()) {
          this.spool(msg);
          continue;
        }
        let outcome: SendOutcome;
        try {
          outcome = await this.deps.process(msg);
        } catch (error) {
          this.deps.log(`send failed: ${String(error)}`);
          outcome = 'network';
        }
        if (outcome === 'network') this.spool(msg);
      }
    } finally {
      this.draining = false;
    }
    this.startKick();
  }
}
