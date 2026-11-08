import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Role } from '../../spacetimedb-bindings/types.js';
import { enumTag, ReadOnlyDbSession, type ConnectionBuilderLike, type ConnectionLike, type DbConfig, type IdentityLike, type SubscriptionBuilderLike } from '../src/db.js';

let tempDirectory = '';
afterEach(async () => {
  if (tempDirectory) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try { await rm(tempDirectory, { recursive: true, force: true }); break; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOTEMPTY' || attempt === 4) throw error;
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    }
  }
  tempDirectory = '';
});

function fixtureConnection(identityHex: string, participantRows: Array<Record<string, unknown>> = []) {
  const errors: Array<(context: unknown, error: Error) => void> = [];
  const applied: Array<() => void> = [];
  const queries: unknown[] = [];
  const data: Record<string, Array<Record<string, unknown>>> = {
    participant: participantRows,
    myAssignment: [
      { id: 11, survivorId: 7, status: { Proposed: [] }, rescuerIdentity: { toHexString: () => identityHex } },
      { id: 12, survivorId: 8, status: { Active: [] }, rescuerIdentity: { toHexString: () => 'f'.repeat(64) } },
    ],
    myBriefing: [
      { id: 1, audience: 'all', text: 'site update' },
      { id: 2, audience: identityHex, text: 'your task' },
      { id: 3, audience: 'f'.repeat(64), text: 'private update' },
    ],
    mySurvivor: [{ id: 7 }, { id: 8 }],
    criticalOpen: [{ id: 7 }],
    survivor: [{ id: 7, criticalLevel: { Immediate: [] }, status: { Unassigned: [] } }, { id: 8, criticalLevel: { Delayed: [] }, status: { Assigned: [] } }],
    site: [], robot: [], assignment: [], briefing: [
      { id: 1, audience: 'all', text: 'site update' },
      { id: 2, audience: identityHex, text: 'your task' },
      { id: 3, audience: 'f'.repeat(64), text: 'private update' },
    ],
  };
  const registerParticipant = vi.fn(async () => undefined);
  const rowCallbacks: Record<string, Array<(...args: unknown[]) => void>> = {};
  const watch = (name: string) => (callback: (...args: unknown[]) => void) => { (rowCallbacks[name] ??= []).push(callback); };
  const connection: ConnectionLike = {
    db: Object.fromEntries(Object.entries(data).map(([name, rows]) => [name, { iter: () => rows, onInsert: watch(name), onUpdate: watch(name), onDelete: watch(name) }])),
    reducers: { registerParticipant } as unknown as ConnectionLike['reducers'],
    subscriptionBuilder: () => {
      let onError: ((context: unknown, error: Error) => void) | undefined;
      const builder: SubscriptionBuilderLike = {
        onApplied: callback => { applied.push(callback); return builder; },
        onError: callback => { onError = callback; return builder; },
        subscribe: query => { queries.push(query); if (onError) errors.push(onError); return { unsubscribe: vi.fn() }; },
      };
      return builder;
    },
    disconnect: vi.fn(),
  };
  let onConnect: ((connection: ConnectionLike, identity: IdentityLike, token: string) => void) | undefined;
  let withTokenValue: string | undefined;
  let uri = '';
  let database = '';
  const makeBuilder = (): ConnectionBuilderLike => {
    const builder: ConnectionBuilderLike = {
      withUri: value => { uri = value; return builder; },
      withDatabaseName: value => { database = value; return builder; },
      withToken: value => { withTokenValue = value; return builder; },
      withAutomaticReconnect: () => builder,
      onConnect: callback => { onConnect = callback; return builder; },
      onAutomaticReconnect: () => builder,
      onDisconnect: () => builder,
      onConnectError: () => builder,
      build: () => { queueMicrotask(() => onConnect?.(connection, { toHexString: () => identityHex }, 'test-token')); return connection; },
    };
    return builder;
  };
  return { connection, data, rowCallbacks, errors, applied, queries, registerParticipant, makeBuilder, get configValues() { return { uri, database, token: withTokenValue }; } };
}

describe('read-only SpacetimeDB session', () => {
  it('loads a per-rescuer token, saves the issued token, and subscribes only to display views and base rows', async () => {
    tempDirectory = await mkdtemp(join(tmpdir(), 'glasses-db-'));
    await writeFile(join(tempDirectory, 'alex.token'), 'configured-token\n', { mode: 0o600 });
    const fake = fixtureConnection('a'.repeat(64));
    const changed = vi.fn();
    const config: DbConfig = { uri: 'ws://127.0.0.1:3000', database: 'rubble-test', tokenDirectory: tempDirectory };
    const session = new ReadOnlyDbSession({ config, rescuer: 'alex', onChange: changed, makeBuilder: fake.makeBuilder });

    await session.connect();
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(fake.configValues).toEqual({ uri: config.uri, database: config.database, token: 'configured-token' });
    expect(fake.queries).toHaveLength(8);
    expect(session.snapshot().assignments.map(row => row.id)).toEqual([11]);
    expect(session.snapshot().briefings.map(row => row.id)).toEqual([1, 2]);
    expect(session.snapshot().assignedSurvivors.map(row => row.id)).toEqual([7]);
    expect(changed).toHaveBeenCalled();
    session.disconnect();
  });

  it('sends one fresh snapshot per batch of row changes after the subscription is applied', async () => {
    tempDirectory = await mkdtemp(join(tmpdir(), 'glasses-db-'));
    const identity = 'c'.repeat(64);
    const fake = fixtureConnection(identity);
    const changed = vi.fn();
    const session = new ReadOnlyDbSession({ config: { uri: 'ws://127.0.0.1:3000', database: 'rubble-test', tokenDirectory: tempDirectory }, rescuer: 'alex', onChange: changed, makeBuilder: fake.makeBuilder });
    await session.connect();
    await new Promise(resolve => setTimeout(resolve, 0));
    changed.mockClear();

    fake.data.myAssignment!.push({ id: 13, survivorId: 9, status: { Proposed: [] }, rescuerIdentity: { toHexString: () => identity } });
    for (const callback of [...fake.rowCallbacks.myAssignment!, ...fake.rowCallbacks.survivor!]) callback();
    await new Promise(resolve => setImmediate(resolve));

    expect(changed).toHaveBeenCalledOnce();
    expect(changed.mock.calls[0]![0].assignments.map((row: { id: number }) => row.id)).toEqual([11, 13]);
    session.disconnect();
  });

  it('registers the connection identity as a rescuer when it has no participant row', async () => {
    tempDirectory = await mkdtemp(join(tmpdir(), 'glasses-db-'));
    const identity = 'd'.repeat(64);
    const fake = fixtureConnection(identity);
    const session = new ReadOnlyDbSession({ config: { uri: 'ws://127.0.0.1:3000', database: 'rubble-test', tokenDirectory: tempDirectory }, rescuer: 'alex', onChange: () => undefined, makeBuilder: fake.makeBuilder });
    await session.connect();
    await new Promise(resolve => setTimeout(resolve, 0));
    fake.applied[4]?.();
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(fake.registerParticipant).toHaveBeenCalledOnce();
    expect(fake.registerParticipant).toHaveBeenCalledWith({ name: 'alex', role: Role.Rescuer });
    session.disconnect();
  });

  it('does not re-register an identity that already has a participant row', async () => {
    tempDirectory = await mkdtemp(join(tmpdir(), 'glasses-db-'));
    const identity = 'e'.repeat(64);
    const fake = fixtureConnection(identity, [{ identity: { toHexString: () => identity }, name: 'alex', role: { Rescuer: [] } }]);
    const session = new ReadOnlyDbSession({ config: { uri: 'ws://127.0.0.1:3000', database: 'rubble-test', tokenDirectory: tempDirectory }, rescuer: 'alex', onChange: () => undefined, makeBuilder: fake.makeBuilder });
    await session.connect();
    await new Promise(resolve => setTimeout(resolve, 0));
    fake.applied[4]?.();
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(fake.registerParticipant).not.toHaveBeenCalled();
    session.disconnect();
  });

  it('falls back from the assignment view to a base-table subscription and filters rows to this identity', async () => {
    tempDirectory = await mkdtemp(join(tmpdir(), 'glasses-db-'));
    const identity = 'b'.repeat(64);
    const fake = fixtureConnection(identity);
    const session = new ReadOnlyDbSession({ config: { uri: 'ws://127.0.0.1:3000', database: 'rubble-test', tokenDirectory: tempDirectory }, rescuer: 'alex', onChange: () => undefined, makeBuilder: fake.makeBuilder });
    await session.connect();
    await new Promise(resolve => setTimeout(resolve, 0));
    fake.errors[0]?.({}, new Error('missing view'));

    expect(fake.queries.at(-1)).toBe('SELECT * FROM assignment');
    expect(session.snapshot().viewFallbacks).toContain('my_assignment');
    expect(session.snapshot().assignments).toEqual([]);
    session.disconnect();
  });

  it('uses separate sender-scoped briefing fallback queries', async () => {
    tempDirectory = await mkdtemp(join(tmpdir(), 'glasses-db-'));
    const identity = 'c'.repeat(64);
    const fake = fixtureConnection(identity);
    const session = new ReadOnlyDbSession({ config: { uri: 'ws://127.0.0.1:3000', database: 'rubble-test', tokenDirectory: tempDirectory }, rescuer: 'alex', onChange: () => undefined, makeBuilder: fake.makeBuilder });
    await session.connect();
    await new Promise(resolve => setTimeout(resolve, 0));
    fake.errors[1]?.({}, new Error('missing view'));

    expect(fake.queries.slice(-2)).toEqual([
      "SELECT * FROM briefing WHERE audience = 'all'",
      `SELECT * FROM briefing WHERE audience = '${identity}'`,
    ]);
    expect(session.snapshot().briefings.map(row => row.id)).toEqual([1, 2]);
    session.disconnect();
  });

  it('normalizes live enum tag shapes from the generated bindings', () => {
    expect(enumTag({ Immediate: [] })).toBe('immediate');
    expect(enumTag({ tag: 'EnRoute' })).toBe('en_route');
    expect(enumTag('resolved')).toBe('resolved');
  });
});
