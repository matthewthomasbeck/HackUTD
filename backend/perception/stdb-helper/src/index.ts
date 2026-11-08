// Read-only SpacetimeDB helper for the perception service (docs/specs/perception.md section 8.1).
//
// Subscribes to detection, survivor, and search_cell through the generated TypeScript bindings and
// prints one JSON line per row event on stdout:
//   {"table":"detection","op":"insert"|"update"|"delete","row":{...}}
// plus {"status":"connected"} once the subscription has applied, and {"status":"disconnected"}.
// Rows use the contract names: snake_case fields, enum values as their tag string, options as the
// value or null, u64 as numbers (ids stay below 2^53), Timestamps as ISO strings, Identities as hex.
// It never writes; every write goes through Python over HTTP. watcher.py starts and restarts it.
//
// Built against the bindings path in docs/specs/spacetimedb.md section 1.6 (backend/spacetimedb-bindings/).
// This file does not build until those bindings are generated.

import * as fs from 'fs';
import * as path from 'path';
import { DbConnection } from '../../../spacetimedb-bindings';

const uri = process.env.STDB_URI ?? 'https://maincloud.spacetimedb.com';
const database = process.env.STDB_DATABASE ?? 'hackutd-rubble';

function loadToken(): string | undefined {
  if (process.env.STDB_TOKEN) return process.env.STDB_TOKEN;
  const idFile = path.join(__dirname, '..', '..', 'data', 'identity.json');
  try {
    return JSON.parse(fs.readFileSync(idFile, 'utf8')).token;
  } catch {
    return undefined;
  }
}

function emit(obj: unknown): void {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

// camelCase (bindings) to snake_case (contract): rescuerIdentity -> rescuer_identity.
function snake(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/([A-Z])([A-Z][a-z])/g, '$1_$2').toLowerCase();
}

// Convert one SDK value to plain JSON in the contract shape.
function plain(value: any): any {
  if (value === undefined || value === null) return null;
  if (typeof value === 'bigint') return Number(value);
  if (Array.isArray(value)) return value.map(plain);
  if (typeof value !== 'object') return value;
  if (typeof value.toDate === 'function' && 'microsSinceUnixEpoch' in value) {
    return value.toDate().toISOString(); // Timestamp
  }
  if (typeof value.toHexString === 'function') return value.toHexString(); // Identity, ConnectionId
  if (typeof value.tag === 'string') {
    // Enum. The bindings use PascalCase tags (EnRoute); the tables perception reads only have
    // lower snake_case variants, so snake() restores the contract spelling (en_route).
    const tag = snake(value.tag);
    return value.value === undefined ? tag : { [tag]: plain(value.value) };
  }
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(value)) out[snake(k)] = plain(v);
  return out;
}

const TABLES = ['detection', 'survivor', 'search_cell'] as const;

function watchTable(conn: any, sqlName: string): void {
  const accessor = sqlName.replace(/_([a-z])/g, (_m, c) => c.toUpperCase()); // search_cell -> searchCell
  const table = conn.db[accessor];
  if (!table) {
    emit({ status: 'error', message: `no table ${accessor} in the bindings` });
    return;
  }
  table.onInsert((_ctx: unknown, row: unknown) => emit({ table: sqlName, op: 'insert', row: plain(row) }));
  table.onDelete((_ctx: unknown, row: unknown) => emit({ table: sqlName, op: 'delete', row: plain(row) }));
  if (typeof table.onUpdate === 'function') {
    table.onUpdate((_ctx: unknown, _old: unknown, row: unknown) =>
      emit({ table: sqlName, op: 'update', row: plain(row) }));
  }
}

function main(): void {
  const builder = DbConnection.builder()
    .withUri(uri)
    .withDatabaseName(database)
    .onConnect((conn: any) => {
      for (const t of TABLES) watchTable(conn, t);
      conn
        .subscriptionBuilder()
        .onApplied(() => emit({ status: 'connected' }))
        .onError((_ctx: unknown, err: unknown) => {
          emit({ status: 'error', message: String(err) });
          process.exit(2);
        })
        .subscribe(TABLES.map((t) => `SELECT * FROM ${t}`));
    })
    .onDisconnect(() => {
      emit({ status: 'disconnected' });
      process.exit(1); // watcher.py restarts the helper with backoff
    })
    .onConnectError((_ctx: unknown, err: unknown) => {
      emit({ status: 'error', message: String(err) });
      process.exit(1);
    });
  const token = loadToken();
  (token ? builder.withToken(token) : builder).build();
}

main();
