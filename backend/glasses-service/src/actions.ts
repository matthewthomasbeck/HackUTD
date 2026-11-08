import { Resolution } from '../../spacetimedb-bindings/types.js';
import { distanceM, type Point } from './geo.js';
import { enumTag, type DbSnapshot } from './db.js';

export type ResolutionName = 'rescued' | 'handed_off' | 'false_alarm' | 'duplicate';
export interface ReducerApi {
  registerParticipant(args: { name: string; role: unknown }): Promise<void>;
  rescuerHeartbeat(): Promise<void>;
  participantUpdatePosition(args: { lat: number; lon: number }): Promise<void>;
  acceptAssignment(args: { assignmentId: bigint }): Promise<void>;
  releaseAssignment(args: { assignmentId: bigint }): Promise<void>;
  startEnRoute(args: { assignmentId: bigint }): Promise<void>;
  markReached(args: { survivorId: bigint }): Promise<void>;
  resolveSurvivor(args: { survivorId: bigint; resolution: unknown; note: string }): Promise<void>;
  rescuerAsk(args: { text: string; audioUrl?: string; survivorId?: bigint }): Promise<void>;
}

export interface ActionOptions {
  getReducers(): ReducerApi | undefined;
  hasPrimary(): boolean;
  onNotice?(message: string, durationMs: number): void;
  onAsk?(): void;
  now?(): number;
}

export type RescuerAction =
  | { action: 'accept'; assignment_id: number | string | bigint }
  | { action: 'decline'; assignment_id: number | string | bigint }
  | { action: 'release'; assignment_id: number | string | bigint }
  | { action: 'reached'; survivor_id: number | string | bigint }
  | { action: 'resolve'; survivor_id: number | string | bigint; resolution: ResolutionName; note?: string }
  | { action: 'ask' };

export class RescuerActions {
  private snapshot: DbSnapshot | undefined;
  private lastHeartbeatAt = 0;
  private lastPosition: Point | undefined;
  private lastPositionAt = 0;
  private acceptedAt: Map<string, { at: number; point?: Point }> = new Map();
  private ackAttempts = new Set<string>();
  private readonly now: () => number;

  constructor(private readonly options: ActionOptions) { this.now = options.now ?? Date.now; }

  updateSnapshot(snapshot: DbSnapshot): void { this.snapshot = snapshot; }

  async heartbeat(fromPrimarySocket: boolean): Promise<boolean> {
    if (!this.canWrite(fromPrimarySocket)) return false;
    const now = this.now();
    if (now - this.lastHeartbeatAt < 4000) return false;
    this.lastHeartbeatAt = now;
    const reducers = this.options.getReducers();
    if (!reducers) return this.failure(new Error('Database connection is not ready.'));
    try { await reducers.rescuerHeartbeat(); await this.maybeStartEnRoute(reducers); return true; }
    catch (error) { return this.failure(error); }
  }

  async position(point: Point, fromPrimarySocket: boolean): Promise<boolean> {
    if (!this.canWrite(fromPrimarySocket) || !Number.isFinite(point.lat) || !Number.isFinite(point.lon)) return false;
    const now = this.now();
    const moved = this.lastPosition ? distanceM(this.lastPosition, point) : Number.POSITIVE_INFINITY;
    if (this.lastPosition && (now - this.lastPositionAt < 2000 || (moved <= 2 && now - this.lastPositionAt < 5000))) return false;
    this.lastPosition = { ...point };
    this.lastPositionAt = now;
    const reducers = this.options.getReducers();
    if (!reducers) return this.failure(new Error('Database connection is not ready.'));
    try {
      await reducers.participantUpdatePosition(point);
      await this.maybeStartEnRoute(reducers);
      return true;
    } catch (error) { return this.failure(error); }
  }

  async acknowledge(id: number | string | bigint, fromPrimarySocket: boolean): Promise<boolean> {
    if (!this.canWrite(fromPrimarySocket)) return false;
    const assignment = this.ownAssignment(id, 'proposed');
    if (!assignment) return false;
    const assignmentId = toBigInt(assignment.id);
    if (assignmentId === undefined) return false;
    return this.acceptOwned(assignmentId);
  }

  async submitQuestion(text: string, audioUrl: string, fromPrimarySocket: boolean): Promise<boolean> {
    if (!this.canWrite(fromPrimarySocket) || !text.trim()) return false;
    const reducers = this.options.getReducers();
    if (!reducers) return this.failure(new Error('Database connection is not ready.'));
    const assignments = this.snapshot?.assignments ?? [];
    const assignment = assignments.find(row => ['active', 'en_route', 'reached'].includes(enumTag(row.status))) ?? assignments.find(row => enumTag(row.status) === 'proposed');
    const survivorId = assignment ? toBigInt(assignment.survivorId) : 0n;
    if (assignment && survivorId === undefined) return false;
    try { await reducers.rescuerAsk({ text: text.trim().slice(0, 1000), audioUrl, survivorId: survivorId ?? 0n }); return true; }
    catch (error) { return this.failure(error); }
  }

  async action(action: RescuerAction): Promise<{ ok: true } | { ok: false; error: string }> {
    if (!this.canWrite(true)) return { ok: false, error: 'No primary glasses session is connected.' };
    if (action.action === 'ask') { this.options.onAsk?.(); this.options.onNotice?.('ASKING - speak now', 8000); return { ok: true }; }
    const reducers = this.options.getReducers();
    if (!reducers) return { ok: false, error: 'Database connection is not ready.' };
    const rawId = action.action === 'reached' || action.action === 'resolve' ? action.survivor_id : action.assignment_id;
    const id = toBigInt(rawId);
    if (id === undefined) return { ok: false, error: 'Invalid id.' };
    try {
      if (action.action === 'accept') {
        const assignment = this.ownAssignment(id, 'proposed');
        if (!assignment) return { ok: false, error: 'Assignment is not a proposal for this rescuer.' };
        if (!await this.acceptOwned(id)) return { ok: false, error: 'Assignment could not be accepted.' };
      } else if (action.action === 'decline' || action.action === 'release') {
        if (!this.ownAssignment(id)) return { ok: false, error: 'Assignment does not belong to this rescuer.' };
        await reducers.releaseAssignment({ assignmentId: id });
      } else if (action.action === 'reached') {
        if (!this.ownsSurvivor(id)) return { ok: false, error: 'Survivor is not assigned to this rescuer.' };
        await reducers.markReached({ survivorId: id });
      } else if (action.action === 'resolve') {
        if (!this.ownsSurvivor(id)) return { ok: false, error: 'Survivor is not assigned to this rescuer.' };
        const resolutions = {
          rescued: Resolution.Rescued,
          handed_off: Resolution.HandedOff,
          false_alarm: Resolution.FalseAlarm,
          duplicate: Resolution.Duplicate,
        };
        await reducers.resolveSurvivor({ survivorId: id, resolution: resolutions[action.resolution], note: action.note ?? '' });
      }
      return { ok: true };
    } catch (error) {
      const message = errorText(error);
      this.options.onNotice?.(message, 5000);
      return { ok: false, error: message };
    }
  }

  private async maybeStartEnRoute(reducers: ReducerApi): Promise<void> {
    for (const [id, accepted] of this.acceptedAt) {
      if (this.snapshot?.assignments.some(row => String(row.id) === id && enumTag(row.status) === 'en_route')) {
        this.acceptedAt.delete(id);
        continue;
      }
      const moved = accepted.point && this.lastPosition ? distanceM(accepted.point, this.lastPosition) >= 10 : false;
      if (!moved && this.now() - accepted.at < 30_000) continue;
      this.acceptedAt.delete(id);
      try { await reducers.startEnRoute({ assignmentId: BigInt(id) }); }
      catch (error) { this.options.onNotice?.(errorText(error), 5000); }
    }
  }

  private async acceptOwned(assignmentId: bigint): Promise<boolean> {
    const key = assignmentId.toString();
    if (this.ackAttempts.has(key)) return false;
    const reducers = this.options.getReducers();
    if (!reducers) return this.failure(new Error('Database connection is not ready.'));
    this.ackAttempts.add(key);
    try {
      await reducers.acceptAssignment({ assignmentId });
      this.acceptedAt.set(key, { at: this.now(), ...(this.lastPosition ? { point: this.lastPosition } : {}) });
      return true;
    } catch (error) { return this.failure(error); }
  }

  private ownAssignment(id: number | string | bigint, status?: string): Record<string, unknown> | undefined {
    const targetId = toBigInt(id)?.toString();
    if (!targetId) return undefined;
    return this.snapshot?.assignments.find(row => String(row.id) === targetId && (!status || enumTag(row.status) === status));
  }

  private ownsSurvivor(id: bigint): boolean {
    const targetId = id.toString();
    return Boolean(this.snapshot?.assignments.some(row => String(row.survivorId) === targetId && ['active', 'en_route', 'reached'].includes(enumTag(row.status))));
  }

  private canWrite(fromPrimarySocket: boolean): boolean { return fromPrimarySocket && this.options.hasPrimary(); }
  private failure(error: unknown): false { this.options.onNotice?.(errorText(error), 5000); return false; }
}

function toBigInt(value: unknown): bigint | undefined {
  if (typeof value !== 'number' && typeof value !== 'string' && typeof value !== 'bigint') return undefined;
  if (typeof value === 'number' && !Number.isSafeInteger(value)) return undefined;
  try { const result = BigInt(value); return result >= 0n && result <= 18_446_744_073_709_551_615n ? result : undefined; }
  catch { return undefined; }
}

function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/[^\x20-\x7e]/g, '?').slice(0, 56) || 'Action failed.';
}
