import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DbConnection, tables } from '../../spacetimedb-bindings/index.js';
import { Role } from '../../spacetimedb-bindings/types.js';
import { extraRescuerNumber, type DemoSiteConfig } from './config.ts';

export type SimRole = 'sim' | 'robot' | 'rescuer';
export interface SimActor {
  key: string;
  name: string;
  role: SimRole;
  connection: DbConnection;
  identity: string;
  disconnect(): void;
}

export interface PoolOptions {
  uri?: string;
  database?: string;
  tokenDirectory?: string;
  env?: NodeJS.ProcessEnv;
}

export class SimPool {
  private readonly actors = new Map<string, SimActor>();
  private readonly uri: string;
  private readonly database: string;
  private readonly tokenDirectory: string;
  private readonly env: NodeJS.ProcessEnv;

  constructor(options: PoolOptions = {}) {
    this.env = options.env ?? process.env;
    this.uri = options.uri ?? this.env.STDB_URI ?? '';
    this.database = options.database ?? this.env.STDB_DATABASE ?? '';
    this.tokenDirectory = resolve(options.tokenDirectory ?? '.tokens');
    if (!this.uri) throw new Error('STDB_URI is required');
    if (!this.database) throw new Error('STDB_DATABASE is required');
  }

  get(key: string): SimActor {
    const actor = this.actors.get(key);
    if (!actor) throw new Error(`Simulator actor is not connected: ${key}`);
    return actor;
  }

  list(): SimActor[] { return [...this.actors.values()]; }

  async connect(key: string, name: string, role: SimRole): Promise<SimActor> {
    const existing = this.actors.get(key);
    if (existing) return existing;
    const token = await this.readToken(key);
    const builder = DbConnection.builder()
      .withUri(this.uri)
      .withDatabaseName(this.database)
      .withToken(token);

    const actor = await new Promise<SimActor>((resolveActor, reject) => {
      let settled = false;
      let connection: DbConnection | undefined;
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        connection?.disconnect();
        reject(error);
      };
      const connected = (conn: DbConnection, identity: { toHexString(): string }, savedToken: string) => {
        connection = conn;
        const subscriptions = role === 'sim'
          ? [
            tables.site, tables.searchCell, tables.participant, tables.robot, tables.deviceStatus,
            tables.mission, tables.detection, tables.survivor, tables.assignment, tables.personReport,
            tables.agentTask, tables.auditFlag, tables.eventLog, tables.run, tables.leaseTimer,
            tables.heartbeatTimer, tables.escalationTimer, tables.agentWatchdog, tables.agentAction,
            tables.briefing, tables.criticalOpen, tables.myAssignment, tables.myBriefing, tables.mySurvivor,
          ]
          : role === 'robot'
            ? [tables.site, tables.searchCell, tables.robot, tables.mission]
            : [tables.site, tables.myAssignment, tables.mySurvivor];
        let pending = subscriptions.length;
        let registrationStarted = false;
        const startRegistration = async () => {
          if (registrationStarted || settled) return;
          registrationStarted = true;
          try {
            const roles = { sim: Role.Sim, robot: Role.Robot, rescuer: Role.Rescuer };
            await conn.reducers.registerParticipant({ name, role: roles[role] });
            await this.writeToken(key, savedToken);
            const result: SimActor = {
              key,
              name,
              role,
              connection: conn,
              identity: identity.toHexString().toLowerCase().replace(/^0x/, ''),
              disconnect: () => {
                this.actors.delete(key);
                conn.disconnect();
              },
            };
            this.actors.set(key, result);
            settled = true;
            resolveActor(result);
          } catch (error) {
            fail(asError(error));
          }
        };
        for (const table of subscriptions) {
          conn.subscriptionBuilder()
            .onApplied(() => {
              pending -= 1;
              if (pending === 0) void startRegistration();
            })
            .onError((context) => fail(context.event ?? new Error('Subscription failed')))
            .subscribe(table);
        }
      };
      builder
        .onConnect(connected)
        .onAutomaticReconnect(connected)
        .onConnectError((_context, error) => fail(error))
        .build();
    });
    return actor;
  }

  async connectConfiguredActors(config: DemoSiteConfig): Promise<void> {
    await this.connect('sim', 'sim', 'sim');
    const pending: Promise<SimActor>[] = [];
    for (let index = 0; index <= config.robots.fleet_size; index += 1) {
      const robotId = index === 0 ? config.robots.sim.robot_id : `${config.robots.sim.robot_id}-${index + 1}`;
      pending.push(this.connect(robotId, robotId, 'robot'));
    }
    for (const rescuer of config.rescuers) {
      if (!rescuer.real) pending.push(this.connect(rescuer.key, rescuer.name, 'rescuer'));
    }
    for (let index = 0; index < config.extra_sim_rescuers; index += 1) {
      const number = extraRescuerNumber(config, index);
      const name = `R${number} (sim)`;
      pending.push(this.connect(`r${number}`, name, 'rescuer'));
    }
    await Promise.all(pending);
  }

  disconnectAll(): void {
    for (const actor of this.actors.values()) actor.disconnect();
    this.actors.clear();
  }

  private async readToken(key: string): Promise<string | undefined> {
    const envKey = `STDB_TOKEN_${key.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
    const envToken = this.env[envKey] ?? (key === 'sim' ? this.env.STDB_TOKEN : undefined);
    if (envToken?.trim()) return envToken.trim();
    try {
      const token = (await readFile(resolve(this.tokenDirectory, `${key}.token`), 'utf8')).trim();
      return token || undefined;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }

  private async writeToken(key: string, token: string): Promise<void> {
    if (!token) return;
    await mkdir(this.tokenDirectory, { recursive: true, mode: 0o700 });
    const path = resolve(this.tokenDirectory, `${key}.token`);
    const temporaryPath = `${path}.${process.pid}.tmp`;
    await writeFile(temporaryPath, `${token}\n`, { encoding: 'utf8', mode: 0o600 });
    await rename(temporaryPath, path);
  }
}

function asError(error: unknown): Error { return error instanceof Error ? error : new Error(String(error)); }
