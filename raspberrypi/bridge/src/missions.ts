// Mission leasing and forwarding (robot.md 9.5).
// - Every CLAIM_INTERVAL_MS, call claim_next_mission only when SpacetimeDB is connected, the robot
//   said READY in its latest heartbeat, no mission is current, and the C++ client is connected.
// - A mission row for this robot that becomes `leased` is forwarded once per C++ client session
//   (dedupe by id; the id is forgotten when the row leaves leased/active, so a re-leased mission is
//   forwarded again).
// - Cancel is level-triggered: a mission that was forwarded (or is current) and whose row stops
//   being this robot's leased or active row for any reason but done or failed (cancelled, lease
//   expired and requeued, reassigned, deleted) gets a `cancel`. Cancels wait in pendingCancel
//   until a send succeeds, so one sent while no client is connected is not lost. After the cancel
//   the robot says READY and the normal claim path leases (and forwards) the next mission.
// - When a new C++ client connects, the current leased or active mission is sent again, because a
//   restarted robot program has lost it while its heartbeats would keep renewing the lease.
// - When a heartbeat says READY while `current` is this robot's open row and it has not been
//   forwarded to this client (the bridge restarted mid-mission and the row arrived as an insert),
//   it is forwarded. The C++ side ignores a mission id it is already running, so resends are safe.
// The bridge never reads agent_task. Besides mission, cancel, and site, it sends teleop and terrain_hint (index.ts).

import type { Mission } from '../../../backend/spacetimedb-bindings/types.js';
import { cancelMessage, missionMessage } from './to_wire.ts';

export interface MissionDeps {
  robotId: string;
  /** Write one line to the C++ client; false when no client is connected. */
  sendToRobot: (message: object) => boolean;
  claim: () => Promise<void>;
  isReady: () => boolean;
  isClientConnected: () => boolean;
  /** Mission rows in the subscription cache. */
  missions: () => Iterable<Mission>;
  log: (line: string) => void;
}

const OPEN = new Set(['Leased', 'Active']);
/** Ends the robot reported itself; no cancel is needed for these. */
const ROBOT_FINISHED = new Set(['Done', 'Failed']);

export class MissionLink {
  private robotState: string | undefined;
  private current: bigint | undefined;
  /** Mission ids sent to the current C++ client session. */
  private readonly forwarded = new Set<bigint>();
  /** Mission ids that need a `cancel`; an id leaves only after a successful send. */
  private readonly pendingCancel = new Set<bigint>();
  private claiming = false;

  constructor(private readonly deps: MissionDeps) {}

  get currentMissionId(): bigint | undefined { return this.current; }
  get latestRobotState(): string | undefined { return this.robotState; }
  get cancelsPending(): bigint[] { return [...this.pendingCancel]; }

  /** Contract spelling from the latest heartbeat (READY, ACTIVE, ...). */
  onHeartbeat(state: unknown): void {
    if (typeof state === 'string') this.robotState = state;
    this.flushCancels();
    if (this.robotState !== 'READY' || this.current === undefined || this.forwarded.has(this.current)) return;
    const row = this.findRow(this.current);
    if (row && this.isOpen(row)) {
      this.deps.log(`missions: robot is READY but mission ${row.id} is ${row.status.tag.toLowerCase()}; forwarding it`);
      this.forward(row);
    }
  }

  onClientConnected(): void {
    this.robotState = undefined;
    this.forwarded.clear();
    this.flushCancels();
    for (const row of this.deps.missions()) {
      if (this.isOpen(row)) this.forward(row);
    }
  }

  onClientDisconnected(): void {
    this.robotState = undefined;
  }

  onMissionInsert(row: Mission): void {
    this.onRow(row.id, row);
  }

  onMissionUpdate(_oldRow: Mission, newRow: Mission): void {
    this.onRow(newRow.id, newRow);
  }

  onMissionDelete(row: Mission): void {
    this.onRow(row.id, undefined);
  }

  /** One claim attempt if every gate is open. Called on a timer. */
  async tick(): Promise<boolean> {
    if (this.claiming) return false;
    if (!this.deps.isReady() || !this.deps.isClientConnected()) return false;
    if (this.robotState !== 'READY' || this.current !== undefined) return false;
    this.claiming = true;
    try {
      await this.deps.claim();
      return true;
    } catch (error) {
      this.deps.log(`missions: claim_next_mission failed: ${error instanceof Error ? error.message : String(error)}`);
      return true;
    } finally {
      this.claiming = false;
    }
  }

  private isOpen(row: Mission): boolean {
    return row.robotId === this.deps.robotId && OPEN.has(row.status.tag);
  }

  private findRow(id: bigint): Mission | undefined {
    for (const row of this.deps.missions()) if (row.id === id) return row;
    return undefined;
  }

  /** `row` is undefined when the row left the subscription (deleted, or reassigned elsewhere). */
  private onRow(id: bigint, row: Mission | undefined): void {
    if (row && this.isOpen(row)) {
      this.pendingCancel.delete(id); // open for this robot again: the robot may keep running it
      if (row.status.tag === 'Leased') this.forward(row);
      else this.current = id;
      return;
    }
    const sent = this.forwarded.has(id) || this.current === id;
    this.forwarded.delete(id);
    if (this.current === id) this.current = undefined;
    const robotEnded = row !== undefined && row.robotId === this.deps.robotId && ROBOT_FINISHED.has(row.status.tag);
    if (!sent || robotEnded) return;
    this.deps.log(`missions: mission ${id} is ${row ? `${row.status.tag.toLowerCase()} for '${row.robotId}'` : 'gone'}; cancelling it on the robot`);
    this.pendingCancel.add(id);
    this.flushCancels();
  }

  private flushCancels(): void {
    for (const id of [...this.pendingCancel]) {
      if (!this.deps.sendToRobot(cancelMessage(id))) return; // kept for the next send or client
      this.pendingCancel.delete(id);
      this.deps.log(`missions: forwarded cancel for mission ${id}`);
    }
  }

  private forward(row: Mission): void {
    this.current = row.id;
    if (this.forwarded.has(row.id)) return;
    this.flushCancels(); // a cancel for the old mission goes before the new one
    if (!this.deps.sendToRobot(missionMessage(row))) return; // sent again when a client connects
    this.forwarded.add(row.id);
    this.deps.log(`missions: forwarded ${row.status.tag.toLowerCase()} mission ${row.id} (${row.kind.tag})`);
  }
}
