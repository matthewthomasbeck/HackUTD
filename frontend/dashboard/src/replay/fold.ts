import type { ReplayHistoryItem } from './history';

export type ReplayEntities = Map<string, Map<string, Record<string, unknown>>>;

export interface ReplaySnapshot {
  atMs: number;
  cursor: number;
  entities: ReplayEntities;
  malformedCount: number;
}

export interface ReplayTimeline {
  history: readonly ReplayHistoryItem[];
  startMs: number;
  endMs: number;
  snapshots: readonly ReplaySnapshot[];
}

export function buildReplayTimeline(history: readonly ReplayHistoryItem[], startMs: number, endMs: number, intervalMs = 10_000): ReplayTimeline {
  const sorted = history.slice().sort((a, b) => a.createdAtMs - b.createdAtMs || compareIds(a.id, b.id));
  const base = emptySnapshot(startMs);
  const snapshots: ReplaySnapshot[] = [cloneSnapshot(base)];
  let cursor = 0;
  let state = base;
  let nextSnapshotAt = startMs + Math.max(1, intervalMs);
  while (cursor < sorted.length && sorted[cursor].createdAtMs <= endMs) {
    const item = sorted[cursor];
    if (item.createdAtMs >= nextSnapshotAt) {
      state = { ...state, atMs: item.createdAtMs, cursor };
      snapshots.push(cloneSnapshot(state));
      nextSnapshotAt += Math.max(1, intervalMs) * (Math.floor((item.createdAtMs - nextSnapshotAt) / Math.max(1, intervalMs)) + 1);
    }
    applyItem(state, item);
    cursor += 1;
    state.cursor = cursor;
    state.atMs = item.createdAtMs;
  }
  return { history: sorted, startMs, endMs: Math.max(startMs, endMs), snapshots };
}

export function foldReplayAt(timeline: ReplayTimeline, atMs: number): ReplaySnapshot {
  const target = Math.min(timeline.endMs, Math.max(timeline.startMs, atMs));
  let base = timeline.snapshots[0];
  for (const snapshot of timeline.snapshots) {
    if (snapshot.atMs > target) break;
    base = snapshot;
  }
  const state = cloneSnapshot(base);
  let cursor = state.cursor;
  while (cursor < timeline.history.length) {
    const item = timeline.history[cursor];
    if (item.createdAtMs > target || item.createdAtMs > timeline.endMs) break;
    applyItem(state, item);
    cursor += 1;
  }
  state.cursor = cursor;
  state.atMs = target;
  return state;
}

function emptySnapshot(atMs: number): ReplaySnapshot {
  return { atMs, cursor: 0, entities: new Map(), malformedCount: 0 };
}

function cloneSnapshot(snapshot: ReplaySnapshot): ReplaySnapshot {
  const entities: ReplayEntities = new Map();
  for (const [name, rows] of snapshot.entities) {
    entities.set(name, new Map(Array.from(rows, ([id, row]) => [id, structuredClone(row)])));
  }
  return { ...snapshot, entities };
}

function applyItem(state: ReplaySnapshot, item: ReplayHistoryItem) {
  if (item.source !== 'event_log') return;
  let payload: Record<string, unknown> | undefined;
  try {
    payload = asRecord(JSON.parse(item.payloadJson || '{}'));
  } catch {
    state.malformedCount += 1;
    return;
  }
  if (!payload) { state.malformedCount += 1; return; }
  if (item.kind === 'run_started') {
    const after = asRecord(payload.after);
    const snapshot = asRecord(after?.snapshot);
    if (snapshot) seedEntities(state.entities, snapshot);
    return;
  }
  const entityName = canonicalEntity(item.entity);
  const after = asRecord(payload.after);
  if (item.kind === 'robot_online') {
    const robotId = item.message?.split(/\s+/)[0];
    if (robotId) mergeEntity(state.entities, 'robot', robotId, { online: true });
    return;
  }
  if (!entityName || !after) return;
  if (item.kind === 'device_status') {
    const [robotId, deviceLabel] = (item.message ?? '').split(/\s+(.+?):\s/);
    const rows = state.entities.get('device_status');
    const target = rows && Array.from(rows.entries()).find(([, row]) => row.robot_id === robotId && row.device === deviceLabel);
    if (target) mergeEntity(state.entities, 'device_status', target[0], after);
    return;
  }
  const id = entityName === 'robot'
    ? String(after.robot_id ?? item.message?.split(/\s+/)[0] ?? '')
    : String(after.id ?? (item.entityId === '0' ? '' : item.entityId));
  if (!id) return;
  mergeEntity(state.entities, entityName, id, after);
  const nestedSurvivor = asRecord(after.survivor);
  if (nestedSurvivor?.id !== undefined) mergeEntity(state.entities, 'survivor', String(nestedSurvivor.id), nestedSurvivor);
}

function seedEntities(entities: ReplayEntities, snapshot: Record<string, unknown>) {
  for (const [name, value] of Object.entries(snapshot)) {
    if (!Array.isArray(value)) continue;
    for (const raw of value) {
      const row = asRecord(raw);
      if (!row) continue;
      const key = row.id ?? row.robot_id ?? row.identity;
      if (key === undefined) continue;
      mergeEntity(entities, canonicalEntity(name) ?? name, String(key), row);
    }
  }
}

function mergeEntity(entities: ReplayEntities, name: string, id: string, update: Record<string, unknown>) {
  const rows = entities.get(name) ?? new Map<string, Record<string, unknown>>();
  const previous = rows.get(id) ?? {};
  rows.set(id, { ...previous, ...structuredClone(update) });
  entities.set(name, rows);
}

function canonicalEntity(entity?: string): string | undefined {
  if (!entity) return undefined;
  const key = entity.toLowerCase().replaceAll('-', '_');
  const aliases: Record<string, string> = { cell: 'search_cell', searchcell: 'search_cell', search_cell: 'search_cell', devicestatus: 'device_status', device_status: 'device_status', agenttask: 'agent_task', agent_task: 'agent_task', auditflag: 'audit_flag', audit_flag: 'audit_flag' };
  return aliases[key] ?? key;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function compareIds(left: string, right: string): number {
  try { const a = BigInt(left); const b = BigInt(right); return a < b ? -1 : a > b ? 1 : 0; }
  catch { return left.localeCompare(right); }
}
