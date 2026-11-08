// Event log helpers (docs/specs/spacetimedb.md section 5.5).
// Every state change appends one event_log row whose payload_json is
// {"before":{...},"after":{...}} with only the changed fields.

import { Timestamp, Identity } from 'spacetimedb';
import type { Ctx } from '../schema';

export type Plain = string | number | boolean | null | Plain[] | { [key: string]: Plain };
export type PlainObject = { [key: string]: Plain };

// The run with no ended_at, else 0.
export function activeRunId(ctx: Ctx): bigint {
  for (const r of ctx.db.run.iter()) if (r.ended_at === undefined) return r.id;
  return 0n;
}

// Convert one scalar column value to JSON-safe form:
// bigint to a decimal string, Timestamp to ISO 8601, Identity to hex, enum to its tag, undefined to null.
function scalar(v: unknown): Plain {
  if (v === undefined || v === null) return null;
  if (typeof v === 'bigint') return v.toString();
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
  if (v instanceof Timestamp) return v.toISOString();
  if (v instanceof Identity) return v.toHexString();
  if (typeof v === 'object' && 'tag' in (v as object)) return String((v as { tag: unknown }).tag);
  return String(v);
}

// Convert a column value, including arrays of scalars (score_reasons, target_cell_ids).
export function toPlain(v: unknown): Plain {
  if (Array.isArray(v)) return v.map(scalar);
  return scalar(v);
}

// Convert a whole row (one level deep; rows hold only scalars and arrays of scalars).
export function rowToPlain(row: object): PlainObject {
  const out: PlainObject = {};
  for (const [k, v] of Object.entries(row)) out[k] = toPlain(v);
  return out;
}

// The fields that differ between two versions of a row.
export function diff(before: object, after: object): { before: PlainObject; after: PlainObject } {
  const b = rowToPlain(before);
  const a = rowToPlain(after);
  const outB: PlainObject = {};
  const outA: PlainObject = {};
  for (const key of Object.keys(a)) {
    if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) {
      outB[key] = b[key] ?? null;
      outA[key] = a[key];
    }
  }
  return { before: outB, after: outA };
}

export interface Change {
  before: PlainObject;
  after: PlainObject;
}

// Payload for a newly created row: before {} and the full row after.
export function created(row: object): Change {
  return { before: {}, after: rowToPlain(row) };
}

// Append one event_log row and return it (its id starts a chain for survivor_created).
export function logEvent(
  ctx: Ctx,
  kind: string,
  entity: string,
  entity_id: bigint,
  message: string,
  change?: Change,
  observed_at?: Timestamp
) {
  let payload = '{}';
  if (change) {
    const after: PlainObject = { ...change.after };
    if (observed_at) after.observed_at = observed_at.toISOString();
    const empty = Object.keys(change.before).length === 0 && Object.keys(after).length === 0;
    payload = empty ? '{}' : JSON.stringify({ before: change.before, after });
  } else if (observed_at) {
    payload = JSON.stringify({ before: {}, after: { observed_at: observed_at.toISOString() } });
  }
  return ctx.db.event_log.insert({
    id: 0n,
    run_id: activeRunId(ctx),
    kind,
    entity,
    entity_id,
    message,
    payload_json: payload,
    created_at: ctx.timestamp,
  });
}
