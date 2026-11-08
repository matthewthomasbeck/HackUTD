// The robot's one SpacetimeDB connection (robot.md 9.2), through the TypeScript SDK and the
// generated bindings in backend/spacetimedb-bindings.
// - The token file is the robot's identity: mode 0600, one file per server (config.tokenPathFor).
// - After connect: subscribe to the seven queries, call register_participant(ROBOT_ID, robot), and
//   only then report ready, so nothing is sent (and rejected) before the role exists.
// - withAutomaticReconnect handles drops; our own backoff (1, 2, 4 ... 30 s) covers the first
//   connect and any case where the SDK stops retrying.
// - A reducer that throws SenderError (or InternalError) is a rejection and is never retried;
//   anything else (not connected, lost before acknowledged, timeout) counts as a network failure.
// - Each connect() starts a new generation. Callbacks from an older connection (its onDisconnect
//   fires synchronously when we drop it) are ignored, so one failure arms one reconnect timer.

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { DbConnection } from '../../../backend/spacetimedb-bindings/index.js';
import { Role, type Mission, type Site, type Teleop } from '../../../backend/spacetimedb-bindings/types.js';
import { tokenPathFor, type BridgeConfig } from './config.ts';
import type { ReducerCall } from './mapping.ts';
import type { DetectionRef } from './media.ts';
import type { SendOutcome } from './spool.ts';

export interface StdbHandlers {
  onReady: () => void;
  onLost: () => void;
  onMissionInsert: (row: Mission) => void;
  onMissionUpdate: (oldRow: Mission, newRow: Mission) => void;
  onMissionDelete: (row: Mission) => void;
  onSiteChange: () => void;
  onRobotRow: () => void;
  /** live: a reducer just wrote the row (not a row replayed by a new subscription). */
  onTeleop: (row: Teleop, live: boolean) => void;
}

const CALL_TIMEOUT_MS = 15_000;
const REGISTER_RETRY_MS = 5_000;

export type ConnectionBuilder = ReturnType<typeof DbConnection.builder>;

export function subscriptionQueries(robotId: string): string[] {
  return [
    `SELECT * FROM mission WHERE robot_id = '${robotId}'`,
    "SELECT * FROM mission WHERE robot_id = ''",
    `SELECT * FROM robot WHERE robot_id = '${robotId}'`,
    `SELECT * FROM detection WHERE robot_id = '${robotId}'`,
    `SELECT * FROM teleop WHERE robot_id = '${robotId}'`,
    'SELECT * FROM site',
    'SELECT * FROM search_cell',
  ];
}

/** Rejections are the module saying no; everything else may succeed later. */
export function classifyError(error: unknown): Exclude<SendOutcome, 'ok'> {
  const name = error instanceof Error ? error.name : '';
  return name === 'SenderError' || name === 'InternalError' ? 'rejected' : 'network';
}

/**
 * True for a row change a reducer just made: `Transaction` when another client called it (the dashboard's
 * teleop_drive), `Reducer` when this client did. False for rows a (re)subscription replays (`SubscribeApplied`).
 */
export function isLiveEvent(tag: string): boolean {
  return tag === 'Transaction' || tag === 'Reducer';
}

/** Our own reconnect waits: 1, 2, 4, 8, 16, 30, 30 ... seconds. */
export function reconnectDelayMs(attempt: number): number {
  return Math.min(1000 * 2 ** attempt, 30_000);
}

export function readToken(path: string): string | undefined {
  if (!existsSync(path)) return undefined;
  const token = readFileSync(path, 'utf8').trim();
  return token || undefined;
}

export function saveToken(path: string, token: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${token}\n`, { mode: 0o600 });
  chmodSync(path, 0o600); // writeFileSync keeps the mode of an existing file
}

function errorText(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

/** Reject if `work` is not settled in CALL_TIMEOUT_MS; a timeout counts as a network failure. */
async function withTimeout<T>(work: Promise<T>, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${what} not acknowledged in ${CALL_TIMEOUT_MS} ms`)), CALL_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export class StdbLink {
  private conn: DbConnection | undefined;
  private readyNow = false;
  private stopped = false;
  private attempt = 0;
  private retryTimer: NodeJS.Timeout | undefined;
  private registerTimer: NodeJS.Timeout | undefined;
  /** Bumped by every connect() and stop(); callbacks from an older generation are ignored. */
  private generation = 0;
  private readonly tokenPath: string;

  constructor(
    private readonly config: BridgeConfig,
    private readonly handlers: StdbHandlers,
    private readonly log: (line: string) => void,
    /** Injected in tests; the SDK builder otherwise. */
    private readonly newBuilder: () => ConnectionBuilder = () => DbConnection.builder(),
  ) {
    this.tokenPath = tokenPathFor(config.tokenFile, config.stdbUri);
  }

  get ready(): boolean { return this.readyNow; }

  start(): void {
    if (this.config.stdbMode === 'http') {
      this.log('stdb: STDB_MODE=http is not implemented in the bridge (robot.md 9.10); using the sdk');
    }
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.retryTimer);
    clearTimeout(this.registerTimer);
    this.setReady(false);
    this.dropConnection();
  }

  async call(call: ReducerCall): Promise<SendOutcome> {
    const conn = this.conn;
    if (!conn || !this.readyNow) return 'network';
    const reducer = conn.reducers[call.reducer] as (args: unknown) => Promise<void>;
    try {
      await withTimeout(reducer(call.args), call.reducer);
      return 'ok';
    } catch (error) {
      const outcome = classifyError(error);
      this.log(`stdb: ${call.reducer} ${outcome === 'rejected' ? 'rejected' : 'failed'}: ${errorText(error)}`);
      return outcome;
    }
  }

  /** Same timeout as call(), so a lost acknowledgement cannot leave a claim pending forever. */
  async claim(): Promise<void> {
    const conn = this.conn;
    if (!conn || !this.readyNow) throw new Error('not connected');
    await withTimeout(conn.reducers.claimNextMission({ robotId: this.config.robotId }), 'claimNextMission');
  }

  findDetection(clientRef: string): DetectionRef | undefined {
    if (!this.conn) return undefined;
    for (const row of this.conn.db.detection.iter()) {
      if (row.clientRef === clientRef) return { id: row.id, survivorId: row.survivorId };
    }
    return undefined;
  }

  hasRobotRow(): boolean {
    return this.conn?.db.robot.robotId.find(this.config.robotId) != null; // find returns null when absent
  }

  missions(): Mission[] {
    return this.conn ? [...this.conn.db.mission.iter()] : [];
  }

  sites(): Site[] {
    return this.conn ? [...this.conn.db.site.iter()] : [];
  }

  private setReady(value: boolean): void {
    if (this.readyNow === value) return;
    this.readyNow = value;
    if (value) this.handlers.onReady();
    else this.handlers.onLost();
  }

  private scheduleReconnect(reason: string): void {
    if (this.stopped || this.retryTimer) return;
    const delay = reconnectDelayMs(this.attempt);
    this.attempt += 1;
    this.log(`stdb: ${reason}; reconnecting in ${delay / 1000} s`);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      this.connect();
    }, delay);
  }

  /**
   * Forget the current connection before dropping it: the SDK fires its onDisconnect
   * synchronously, and that callback must see a stale generation and do nothing.
   */
  private dropConnection(): void {
    const old = this.conn;
    this.conn = undefined;
    this.generation += 1;
    clearTimeout(this.registerTimer);
    old?.disconnect();
  }

  private connect(): void {
    if (this.stopped) return;
    this.setReady(false);
    this.dropConnection();
    const generation = this.generation;
    const current = () => generation === this.generation && !this.stopped;
    const token = this.config.stdbToken ?? readToken(this.tokenPath);
    this.log(`stdb: connecting to ${this.config.stdbUri} database ${this.config.stdbDatabase} (${token ? 'saved identity' : 'new identity'})`);
    const conn = this.newBuilder()
      .withUri(this.config.stdbUri)
      .withDatabaseName(this.config.stdbDatabase)
      .withToken(token)
      .withAutomaticReconnect()
      .onConnect((connected, identity, newToken) => {
        if (!current()) {
          connected.disconnect(); // a late connect from a replaced connection
          return;
        }
        this.attempt = 0;
        if (!this.config.stdbToken) saveToken(this.tokenPath, newToken);
        this.log(`stdb: connected as identity ${identity.toHexString().replace(/^0x/, '').toLowerCase()} (token ${this.config.stdbToken ? 'from STDB_TOKEN' : this.tokenPath})`);
        this.subscribe(connected);
      })
      .onAutomaticReconnect((connected) => {
        if (!current()) return;
        this.attempt = 0;
        this.log('stdb: reconnected');
        this.register(connected); // the SDK replays the subscriptions itself
      })
      .onConnectError((_ctx, error, nextAttempt, nextDelayMs) => {
        if (!current()) return;
        this.setReady(false);
        if (nextAttempt === undefined) this.scheduleReconnect(`connect failed (${errorText(error)})`);
        else this.log(`stdb: reconnect failed, sdk retries in ${Math.round((nextDelayMs ?? 0) / 1000)} s`);
      })
      .onDisconnect((_ctx, error, nextAttempt) => {
        if (!current()) return;
        this.setReady(false);
        clearTimeout(this.registerTimer);
        if (nextAttempt === undefined) this.scheduleReconnect(`disconnected${error ? ` (${errorText(error)})` : ''}`);
        else this.log(`stdb: disconnected${error ? ` (${errorText(error)})` : ''}, sdk is reconnecting`);
      })
      .build();
    this.conn = conn;
    conn.db.mission.onInsert((_ctx, row) => this.handlers.onMissionInsert(row));
    conn.db.mission.onUpdate((_ctx, oldRow, newRow) => this.handlers.onMissionUpdate(oldRow, newRow));
    conn.db.mission.onDelete((_ctx, row) => this.handlers.onMissionDelete(row));
    conn.db.robot.onInsert(() => this.handlers.onRobotRow());
    conn.db.teleop.onInsert((ctx, row) => this.handlers.onTeleop(row, isLiveEvent(ctx.event.tag)));
    conn.db.teleop.onUpdate((ctx, _oldRow, newRow) => this.handlers.onTeleop(newRow, isLiveEvent(ctx.event.tag)));
    conn.db.site.onInsert(() => this.handlers.onSiteChange());
    conn.db.site.onUpdate(() => this.handlers.onSiteChange());
  }

  private subscribe(conn: DbConnection): void {
    conn.subscriptionBuilder()
      .onApplied(() => {
        this.log('stdb: subscriptions applied');
        this.register(conn);
      })
      .onError((ctx) => {
        this.log(`stdb: subscription failed: ${errorText((ctx as { event?: unknown }).event)}`);
      })
      .subscribe(subscriptionQueries(this.config.robotId));
  }

  /** register_participant(name = ROBOT_ID, role = robot); retried until the role is granted. */
  private register(conn: DbConnection): void {
    clearTimeout(this.registerTimer);
    if (this.stopped || conn !== this.conn) return;
    conn.reducers.registerParticipant({ name: this.config.robotId, role: Role.Robot })
      .then(() => {
        if (conn !== this.conn) return;
        this.log(`stdb: registered as ${this.config.robotId} (robot)`);
        this.setReady(true);
      })
      .catch((error: unknown) => {
        if (conn !== this.conn) return;
        this.log(`stdb: register_participant failed: ${errorText(error)}. Outside demo mode a coordinator must grant_role this identity the robot role; retrying in ${REGISTER_RETRY_MS / 1000} s`);
        this.registerTimer = setTimeout(() => this.register(conn), REGISTER_RETRY_MS);
      });
  }
}
