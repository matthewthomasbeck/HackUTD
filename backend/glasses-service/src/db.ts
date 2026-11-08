import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DbConnection, tables } from '../../spacetimedb-bindings/index.js';
import { Role } from '../../spacetimedb-bindings/types.js';
import type { ReducerApi } from './actions.js';

type Row = Record<string, unknown>;
type Query = unknown;
export interface ConnectionLike {
  db: Record<string, { iter(): Iterable<Row> }>;
  reducers?: ReducerApi;
  subscriptionBuilder(): SubscriptionBuilderLike;
  disconnect(): void;
}
export interface SubscriptionBuilderLike {
  onApplied(callback: () => void): this;
  onError(callback: (context: unknown, error: Error) => void): this;
  subscribe(query: Query): { unsubscribe?(): void };
}
export interface ConnectionBuilderLike {
  withUri(uri: string): this;
  withDatabaseName(database: string): this;
  withToken(token?: string): this;
  withAutomaticReconnect(options?: { minDelayMs?: number; maxDelayMs?: number }): this;
  onConnect(callback: (connection: ConnectionLike, identity: IdentityLike, token: string) => void): this;
  onAutomaticReconnect(callback: (connection: ConnectionLike, identity: IdentityLike, token: string) => void): this;
  onDisconnect(callback: (context: unknown, error?: Error) => void): this;
  onConnectError(callback: (context: unknown, error: Error) => void): this;
  build(): ConnectionLike;
}
export interface IdentityLike { toHexString(): string }
export interface DbConfig { uri: string; database: string; tokenDirectory: string; env?: NodeJS.ProcessEnv }
export type DbStatus = 'disconnected' | 'connecting' | 'connected' | 'error';
export interface DbSnapshot {
  status: DbStatus;
  identityHex?: string;
  assignments: Row[];
  briefings: Row[];
  assignedSurvivors: Row[];
  criticalOpen: Row[];
  survivors: Row[];
  sites: Row[];
  robots: Row[];
  viewFallbacks: string[];
  lastMessageAt: number | null;
}
export interface DbSessionOptions {
  config: DbConfig;
  rescuer: string;
  onChange(snapshot: DbSnapshot): void;
  onError?(error: Error): void;
  makeBuilder?: () => ConnectionBuilderLike;
}

const VIEW_QUERIES: Array<{ name: string; table: Query; fallback?: (identityHex: string) => string[] }> = [
  { name: 'my_assignment', table: tables.myAssignment, fallback: () => ['SELECT * FROM assignment'] },
  { name: 'my_briefing', table: tables.myBriefing, fallback: identityHex => [
    "SELECT * FROM briefing WHERE audience = 'all'",
    `SELECT * FROM briefing WHERE audience = '${identityHex}'`,
  ] },
  { name: 'my_survivor', table: tables.mySurvivor },
  { name: 'critical_open', table: tables.criticalOpen },
];
const BASE_QUERIES: Array<{ name: string; table: Query }> = [
  { name: 'participant', table: tables.participant },
  { name: 'site', table: tables.site },
  { name: 'robot', table: tables.robot },
  { name: 'survivor', table: tables.survivor },
];

export function enumTag(value: unknown): string {
  let tag: unknown = value;
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    tag = record.tag ?? Object.keys(record)[0] ?? '';
  }
  if (typeof tag !== 'string') return '';
  return tag.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

export function safeRescuerName(value: string): string {
  const name = value.trim();
  if (!/^[a-zA-Z0-9_-]{1,48}$/.test(name)) throw new Error('Rescuer name must contain only letters, numbers, underscore, or dash.');
  return name;
}

function tokenEnvKey(rescuer: string): string {
  return `STDB_TOKEN_${rescuer.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
}

export async function readRescuerToken(rescuer: string, config: DbConfig): Promise<string | undefined> {
  const name = safeRescuerName(rescuer);
  const env = config.env ?? process.env;
  const fromEnv = env[tokenEnvKey(name)] ?? (name === 'default' || name === 'alex' ? env.STDB_TOKEN : undefined);
  if (fromEnv?.trim()) return fromEnv.trim();
  const tokenPath = resolve(config.tokenDirectory, `${name}.token`);
  try {
    const token = (await readFile(tokenPath, 'utf8')).trim();
    return token || undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

async function persistToken(rescuer: string, token: string, tokenDirectory: string): Promise<void> {
  if (!token) return;
  const name = safeRescuerName(rescuer);
  const directory = resolve(tokenDirectory);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = resolve(directory, `${name}.token`);
  const tempPath = `${path}.${process.pid}.tmp`;
  await writeFile(tempPath, `${token}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(tempPath, path);
}

function rows(connection: ConnectionLike, accessor: string): Row[] {
  const table = connection.db[accessor];
  return table ? Array.from(table.iter()) : [];
}

function rowIdentity(row: Row): string {
  return identityValue(row.rescuerIdentity);
}

function identityValue(value: unknown): string {
  if (typeof value === 'object' && value !== null && 'toHexString' in value) {
    return (value as IdentityLike).toHexString().toLowerCase();
  }
  if (typeof value === 'string') return value.replace(/^0x/, '').toLowerCase();
  return '';
}

export class ReadOnlyDbSession {
  private connection: ConnectionLike | null = null;
  private identityHex: string | undefined;
  private status: DbStatus = 'disconnected';
  private lastMessageAt: number | null = null;
  private readonly fallbacks = new Set<string>();
  private readonly applied = new Set<string>();
  private readonly fallbackStarted = new Set<string>();
  private readonly subscriptions: Array<{ unsubscribe?(): void }> = [];
  private readonly registrationInFlight = new Set<string>();
  private readonly registrationComplete = new Set<string>();
  private readonly makeBuilder: () => ConnectionBuilderLike;
  private disposed = false;

  constructor(private readonly options: DbSessionOptions) {
    this.makeBuilder = options.makeBuilder ?? (() => DbConnection.builder() as unknown as ConnectionBuilderLike);
  }

  get isConnected(): boolean { return this.status === 'connected'; }
  get reducers(): ReducerApi | undefined { return this.connection?.reducers; }

  async connect(): Promise<void> {
    if (this.connection || this.disposed) return;
    this.status = 'connecting';
    this.emit();
    const token = await readRescuerToken(this.options.rescuer, this.options.config);
    const builder = this.makeBuilder()
      .withUri(this.options.config.uri)
      .withDatabaseName(this.options.config.database)
      .withToken(token)
      .withAutomaticReconnect();
    const onConnected = (connection: ConnectionLike, identity: IdentityLike, savedToken: string) => {
      this.connection = connection;
      this.identityHex = identity.toHexString().toLowerCase();
      this.status = 'connected';
      void persistToken(this.options.rescuer, savedToken, this.options.config.tokenDirectory).catch((err: unknown) => this.options.onError?.(asError(err)));
      this.subscribe(connection);
      this.emit();
    };
    builder
      .onConnect(onConnected)
      .onAutomaticReconnect(onConnected)
      .onDisconnect((_context, error) => {
        this.status = 'disconnected';
        if (error) this.options.onError?.(error);
        this.emit();
      })
      .onConnectError((_context, error) => {
        this.status = 'error';
        this.options.onError?.(error);
        this.emit();
      });
    this.connection = builder.build();
  }

  disconnect(): void {
    this.disposed = true;
    for (const handle of this.subscriptions.splice(0)) handle.unsubscribe?.();
    const connection = this.connection;
    this.connection = null;
    this.status = 'disconnected';
    connection?.disconnect();
    this.emit();
  }

  snapshot(): DbSnapshot {
    const connection = this.connection;
    const identity = this.identityHex ?? '';
    const baseAssignments = rows(connection ?? EMPTY_CONNECTION, 'assignment');
    const assignments = (this.fallbacks.has('my_assignment') ? baseAssignments : rows(connection ?? EMPTY_CONNECTION, 'myAssignment'))
      .filter(row => rowIdentity(row) === identity);
    const briefings = (this.fallbacks.has('my_briefing') ? rows(connection ?? EMPTY_CONNECTION, 'briefing') : rows(connection ?? EMPTY_CONNECTION, 'myBriefing'))
      .filter(row => row.audience === 'all' || row.audience === identity);
    const survivorRows = rows(connection ?? EMPTY_CONNECTION, 'survivor');
    const ownedSurvivorIds = new Set(assignments.filter(row => ['proposed', 'active'].includes(enumTag(row.status))).map(row => String(row.survivorId)));
    const assignedSurvivors = this.fallbacks.has('my_survivor')
      ? survivorRows.filter(row => ownedSurvivorIds.has(String(row.id)))
      : rows(connection ?? EMPTY_CONNECTION, 'mySurvivor').filter(row => ownedSurvivorIds.has(String(row.id)));
    const criticalOpen = this.fallbacks.has('critical_open')
      ? survivorRows.filter(row => enumTag(row.criticalLevel) === 'immediate' && enumTag(row.status) !== 'resolved')
      : rows(connection ?? EMPTY_CONNECTION, 'criticalOpen');
    return {
      status: this.status,
      ...(this.identityHex ? { identityHex: this.identityHex } : {}),
      assignments,
      briefings,
      assignedSurvivors,
      criticalOpen,
      survivors: survivorRows,
      sites: rows(connection ?? EMPTY_CONNECTION, 'site'),
      robots: rows(connection ?? EMPTY_CONNECTION, 'robot'),
      viewFallbacks: [...this.fallbacks],
      lastMessageAt: this.lastMessageAt,
    };
  }

  private subscribe(connection: ConnectionLike): void {
    for (const { name, table, fallback } of VIEW_QUERIES) this.subscribeQuery(connection, name, table, fallback);
    for (const { name, table } of BASE_QUERIES) {
      if (name === 'participant') this.subscribeParticipant(connection, table);
      else this.subscribeQuery(connection, name, table);
    }
  }

  private subscribeParticipant(connection: ConnectionLike, query: Query): void {
    const builder = connection.subscriptionBuilder()
      .onApplied(() => {
        this.lastMessageAt = Date.now();
        void this.ensureRescuerParticipant(connection);
        this.emit();
      })
      .onError((_context, error) => {
        this.options.onError?.(new Error('Participant subscription failed; rescuer registration cannot be verified.', { cause: error }));
      });
    this.subscriptions.push(builder.subscribe(query));
  }

  private async ensureRescuerParticipant(connection: ConnectionLike): Promise<void> {
    const identityHex = this.identityHex;
    if (!identityHex || this.disposed || this.registrationComplete.has(identityHex) || this.registrationInFlight.has(identityHex)) return;
    if (rows(connection, 'participant').some(row => identityValue(row.identity) === identityHex)) {
      this.registrationComplete.add(identityHex);
      return;
    }
    const register = connection.reducers?.registerParticipant;
    if (!register) {
      this.options.onError?.(new Error('Database connection does not expose registerParticipant.'));
      return;
    }
    this.registrationInFlight.add(identityHex);
    try {
      await register({ name: this.options.rescuer, role: Role.Rescuer });
      this.registrationComplete.add(identityHex);
    } catch (error) {
      this.options.onError?.(asError(error));
    } finally {
      this.registrationInFlight.delete(identityHex);
    }
  }

  private subscribeQuery(connection: ConnectionLike, name: string, query: Query, fallback?: (identityHex: string) => string[]): void {
    let builder = connection.subscriptionBuilder()
      .onApplied(() => {
        this.applied.add(name);
        this.lastMessageAt = Date.now();
        this.emit();
      })
      .onError((_context, error) => {
        if (fallback && !this.fallbackStarted.has(name) && !this.disposed) {
          this.fallbackStarted.add(name);
          this.fallbacks.add(name);
          this.options.onError?.(new Error(`Subscription ${name} failed; using the base-table fallback.`, { cause: error }));
          for (const queryText of fallback(this.identityHex ?? '')) {
            builder = connection.subscriptionBuilder()
              .onApplied(() => {
                this.lastMessageAt = Date.now();
                this.emit();
              })
              .onError((_ctx, fallbackError) => this.options.onError?.(fallbackError));
            this.subscriptions.push(builder.subscribe(queryText));
          }
          this.emit();
          return;
        }
        if (!fallback && ['my_survivor', 'critical_open'].includes(name)) {
          this.fallbacks.add(name);
          this.options.onError?.(new Error(`Subscription ${name} failed; using the subscribed survivor table.`, { cause: error }));
          this.emit();
          return;
        }
        this.status = 'error';
        this.options.onError?.(error);
        this.emit();
      });
    this.subscriptions.push(builder.subscribe(query));
  }

  private emit(): void { this.options.onChange(this.snapshot()); }
}

const EMPTY_CONNECTION: ConnectionLike = {
  db: {},
  subscriptionBuilder: () => { throw new Error('No database connection.'); },
  disconnect: () => undefined,
};

function asError(error: unknown): Error { return error instanceof Error ? error : new Error(String(error)); }
