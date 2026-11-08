// Arm, renew, and cancel helpers for every schedule table (docs/specs/spacetimedb.md section 7.1).
// Arming inserts a row, renewing updates scheduled_at and due_at of the existing row,
// and cancelling deletes the row. Each timer row carries due_at for dashboard countdowns.

import { ScheduleAt, Timestamp, type Identity } from 'spacetimedb';
import type { Ctx, HeartbeatKindTag, LeaseKindTag } from '../schema';
import { AGENT_WATCHDOG_DEMO_S, AGENT_WATCHDOG_S, SWEEP_INTERVAL_S, US_PER_S } from '../config';
import { isDemo } from './auth';

export function addSeconds(ctx: Ctx, seconds: number): bigint {
  return ctx.timestamp.microsSinceUnixEpoch + BigInt(Math.round(seconds * 1_000_000));
}

export function tsIn(ctx: Ctx, seconds: number): Timestamp {
  return new Timestamp(addSeconds(ctx, seconds));
}

export function watchdogSeconds(ctx: Ctx): number {
  return isDemo(ctx) ? AGENT_WATCHDOG_DEMO_S : AGENT_WATCHDOG_S;
}

// ---------------------------------------------------------------------------
// lease_timer: proposal, assignment, mission, agent_task (one row per entity and kind)
// ---------------------------------------------------------------------------

function leaseRows(ctx: Ctx, kind: LeaseKindTag, entity_id: bigint) {
  return [...ctx.db.lease_timer.entity_id.filter(entity_id)].filter(r => r.kind.tag === kind);
}

// Arm or move the lease timer of an entity so it fires at dueMicros.
export function setLease(ctx: Ctx, kind: LeaseKindTag, entity_id: bigint, dueMicros: bigint): void {
  const rows = leaseRows(ctx, kind, entity_id);
  const scheduled_at = ScheduleAt.time(dueMicros);
  const due_at = new Timestamp(dueMicros);
  if (rows.length === 0) {
    ctx.db.lease_timer.insert({ scheduled_id: 0n, scheduled_at, kind: { tag: kind }, entity_id, due_at });
    return;
  }
  ctx.db.lease_timer.scheduled_id.update({ ...rows[0], scheduled_at, due_at });
  // Keep one row per entity and kind.
  for (const extra of rows.slice(1)) ctx.db.lease_timer.scheduled_id.delete(extra.scheduled_id);
}

export function cancelLease(ctx: Ctx, kind: LeaseKindTag, entity_id: bigint): void {
  for (const r of leaseRows(ctx, kind, entity_id)) ctx.db.lease_timer.scheduled_id.delete(r.scheduled_id);
}

export function hasLease(ctx: Ctx, kind: LeaseKindTag, entity_id: bigint): boolean {
  return leaseRows(ctx, kind, entity_id).length > 0;
}

// ---------------------------------------------------------------------------
// heartbeat_timer: rescuer, robot, disconnect_grace
// ---------------------------------------------------------------------------

function heartbeatRows(ctx: Ctx, kind: HeartbeatKindTag, identity: Identity, robot_id: string) {
  return [...ctx.db.heartbeat_timer.identity.filter(identity)].filter(
    r => r.kind.tag === kind && r.robot_id === robot_id
  );
}

export function setHeartbeat(
  ctx: Ctx,
  kind: HeartbeatKindTag,
  identity: Identity,
  robot_id: string,
  seconds: number
): void {
  const due = addSeconds(ctx, seconds);
  const rows = heartbeatRows(ctx, kind, identity, robot_id);
  const scheduled_at = ScheduleAt.time(due);
  const due_at = new Timestamp(due);
  if (rows.length === 0) {
    ctx.db.heartbeat_timer.insert({ scheduled_id: 0n, scheduled_at, kind: { tag: kind }, identity, robot_id, due_at });
    return;
  }
  ctx.db.heartbeat_timer.scheduled_id.update({ ...rows[0], scheduled_at, due_at });
  for (const extra of rows.slice(1)) ctx.db.heartbeat_timer.scheduled_id.delete(extra.scheduled_id);
}

export function cancelHeartbeat(ctx: Ctx, kind: HeartbeatKindTag, identity: Identity, robot_id: string): void {
  for (const r of heartbeatRows(ctx, kind, identity, robot_id)) {
    ctx.db.heartbeat_timer.scheduled_id.delete(r.scheduled_id);
  }
}

// ---------------------------------------------------------------------------
// escalation_timer: one row per immediate, unassigned survivor
// ---------------------------------------------------------------------------

export function armEscalation(ctx: Ctx, survivor_id: bigint, level: number, since: Timestamp, dueMicros: bigint): void {
  cancelEscalation(ctx, survivor_id);
  ctx.db.escalation_timer.insert({
    scheduled_id: 0n,
    scheduled_at: ScheduleAt.time(dueMicros),
    survivor_id,
    level,
    since,
    due_at: new Timestamp(dueMicros),
  });
}

export function cancelEscalation(ctx: Ctx, survivor_id: bigint): void {
  for (const r of [...ctx.db.escalation_timer.survivor_id.filter(survivor_id)]) {
    ctx.db.escalation_timer.scheduled_id.delete(r.scheduled_id);
  }
}

export function hasEscalation(ctx: Ctx, survivor_id: bigint): boolean {
  for (const _r of ctx.db.escalation_timer.survivor_id.filter(survivor_id)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// agent_watchdog and the sweep
// ---------------------------------------------------------------------------

export function insertWatchdog(ctx: Ctx, last_seen: Timestamp): void {
  const due = addSeconds(ctx, watchdogSeconds(ctx));
  ctx.db.agent_watchdog.insert({
    scheduled_id: 0n,
    scheduled_at: ScheduleAt.time(due),
    agent_name: 'orchestrator',
    last_seen,
    due_at: new Timestamp(due),
  });
}

// Push the watchdog back after an orchestrator heartbeat.
export function resetWatchdog(ctx: Ctx): void {
  const rows = [...ctx.db.agent_watchdog.agent_name.filter('orchestrator')];
  if (rows.length === 0) {
    insertWatchdog(ctx, ctx.timestamp);
    return;
  }
  const due = addSeconds(ctx, watchdogSeconds(ctx));
  ctx.db.agent_watchdog.scheduled_id.update({
    ...rows[0],
    last_seen: ctx.timestamp,
    scheduled_at: ScheduleAt.time(due),
    due_at: new Timestamp(due),
  });
  for (const extra of rows.slice(1)) ctx.db.agent_watchdog.scheduled_id.delete(extra.scheduled_id);
}

// Insert the sweep interval row and the orchestrator watchdog if they are missing.
// Runs in init and in clientConnected, because init does not run again on a republish.
export function ensureSchedules(ctx: Ctx): void {
  let haveSweep = false;
  for (const _r of ctx.db.sweep_timer.iter()) {
    haveSweep = true;
    break;
  }
  if (!haveSweep) {
    ctx.db.sweep_timer.insert({
      scheduled_id: 0n,
      scheduled_at: ScheduleAt.interval(BigInt(SWEEP_INTERVAL_S) * US_PER_S),
    });
  }
  let haveWatchdog = false;
  for (const _r of ctx.db.agent_watchdog.agent_name.filter('orchestrator')) {
    haveWatchdog = true;
    break;
  }
  if (!haveWatchdog) insertWatchdog(ctx, ctx.timestamp);
}
