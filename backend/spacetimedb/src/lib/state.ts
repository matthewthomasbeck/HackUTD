// The survivor state machine and the assignment helpers (docs/specs/spacetimedb.md sections 5.3 and 8.6).
// setSurvivorStatus is the only code that writes survivor.status.

import { SenderError } from 'spacetimedb/server';
import { Timestamp } from 'spacetimedb';
import type {
  AssignmentRow,
  BriefingKindTag,
  BriefingPriorityTag,
  Ctx,
  ParticipantRow,
  ReleaseCauseTag,
  SurvivorRow,
  SurvivorStatusTag,
} from '../schema';
import { MODULE_ACTOR, RESCUER_HEARTBEAT_S, SITE_TIMINGS_NORMAL } from '../config';
import { activeSite } from './auth';
import { activeRunId, diff, logEvent, rowToPlain, type Change } from './events';
import { haversineM } from './geo';
import { addSeconds, armEscalation, cancelEscalation, cancelHeartbeat, cancelLease, setHeartbeat, setLease } from './timers';

// Lease and escalation timings from the active site (section 2.1), with the normal defaults.
export function siteTimings(ctx: Ctx) {
  const s = activeSite(ctx);
  if (!s) return SITE_TIMINGS_NORMAL;
  return {
    mission_lease_s: s.mission_lease_s,
    assignment_lease_s: s.assignment_lease_s,
    proposal_lease_s: s.proposal_lease_s,
    escalate_after_s: s.escalate_after_s,
  };
}

// The survivor's chain id (its survivor_created event id), or 0.
export function chainFor(ctx: Ctx, survivor_id: bigint): bigint {
  return ctx.db.survivor_chain.survivor_id.find(survivor_id)?.chain_id ?? 0n;
}

// Allowed steps (contract "Status steps"). resolved is terminal.
const NEXT: Record<SurvivorStatusTag, SurvivorStatusTag[]> = {
  unassigned: ['assigned'],
  assigned: ['en_route', 'unassigned'],
  en_route: ['reached', 'unassigned'],
  reached: ['resolved', 'unassigned'],
  resolved: [],
};

export interface StatusOptions {
  // A coordinator or commander resolving an unresolved survivor as false_alarm or duplicate.
  override?: boolean;
  // Extra fields written in the same update (resolution, resolved_by).
  extra?: Partial<SurvivorRow>;
}

// Move a survivor to a new status, or throw 'bad transition <from> -> <to>'.
// Also keeps the escalation timer in step: re-armed when an immediate survivor goes back
// to unassigned, deleted when the survivor leaves unassigned.
export function setSurvivorStatus(
  ctx: Ctx,
  s: SurvivorRow,
  to: SurvivorStatusTag,
  opts: StatusOptions = {}
): { row: SurvivorRow; change: Change } {
  const from = s.status.tag;
  const allowed = NEXT[from].includes(to) || (opts.override === true && from !== 'resolved' && to === 'resolved');
  if (!allowed) throw new SenderError(`bad transition ${from} -> ${to}`);

  const row: SurvivorRow = { ...s, ...opts.extra, status: { tag: to }, updated_at: ctx.timestamp };
  ctx.db.survivor.id.update(row);

  if (from === 'unassigned' || to === 'resolved') cancelEscalation(ctx, s.id);
  if (to === 'unassigned' && s.critical_level.tag === 'immediate') {
    const n = siteTimings(ctx).escalate_after_s;
    armEscalation(ctx, s.id, 1, ctx.timestamp, addSeconds(ctx, n));
  }
  return { row, change: diff(s, row) };
}

// Add the survivor's status change to an assignment event's payload,
// so replay can apply it from the assignment row alone.
function withSurvivor(change: Change, survivor_id: bigint, sc?: Change): Change {
  if (!sc || sc.after.status === undefined) return change;
  return {
    before: { ...change.before, survivor: { id: survivor_id.toString(), status: sc.before.status } },
    after: { ...change.after, survivor: { id: survivor_id.toString(), status: sc.after.status } },
  };
}

export function activeAssignmentsOf(ctx: Ctx, rescuer: ParticipantRow['identity']): AssignmentRow[] {
  return [...ctx.db.assignment.rescuer_identity.filter(rescuer)].filter(a => a.status.tag === 'active');
}

export function openProposalOf(ctx: Ctx, rescuer: ParticipantRow['identity']): AssignmentRow | undefined {
  for (const a of ctx.db.assignment.rescuer_identity.filter(rescuer)) if (a.status.tag === 'proposed') return a;
  return undefined;
}

export function assignmentsOfSurvivor(ctx: Ctx, survivor_id: bigint, status: 'proposed' | 'active'): AssignmentRow[] {
  return [...ctx.db.assignment.survivor_id.filter(survivor_id)].filter(a => a.status.tag === status);
}

// Release a proposed or active assignment. For an active one, the survivor goes back to
// unassigned (escalation re-armed when immediate). Writes one event row.
export function releaseAssignment(
  ctx: Ctx,
  a: AssignmentRow,
  cause: ReleaseCauseTag,
  kind: 'assignment_released' | 'assignment_expired',
  message: string
): void {
  const wasActive = a.status.tag === 'active';
  const updated: AssignmentRow = {
    ...a,
    status: { tag: 'released' },
    release_cause: { tag: cause },
    updated_at: ctx.timestamp,
  };
  ctx.db.assignment.id.update(updated);
  cancelLease(ctx, 'proposal', a.id);
  cancelLease(ctx, 'assignment', a.id);

  let survivorChange: Change | undefined;
  if (wasActive) {
    const s = ctx.db.survivor.id.find(a.survivor_id);
    if (s && ['assigned', 'en_route', 'reached'].includes(s.status.tag)) {
      survivorChange = setSurvivorStatus(ctx, s, 'unassigned').change;
    }
    // The rescuer heartbeat timer only exists while the rescuer holds an active assignment.
    const left = activeAssignmentsOf(ctx, a.rescuer_identity);
    if (left.length === 0) cancelHeartbeat(ctx, 'rescuer', a.rescuer_identity, '');
  }
  logEvent(ctx, kind, 'assignment', a.id, message, withSurvivor(diff(a, updated), a.survivor_id, survivorChange));
}

// Mark the active assignment of a resolved survivor completed.
export function completeAssignment(ctx: Ctx, a: AssignmentRow, survivorChange: Change | undefined): void {
  const updated: AssignmentRow = { ...a, status: { tag: 'completed' }, updated_at: ctx.timestamp };
  ctx.db.assignment.id.update(updated);
  cancelLease(ctx, 'proposal', a.id);
  cancelLease(ctx, 'assignment', a.id);
  const left = activeAssignmentsOf(ctx, a.rescuer_identity);
  if (left.length === 0) cancelHeartbeat(ctx, 'rescuer', a.rescuer_identity, '');
  logEvent(
    ctx,
    'assignment_completed',
    'assignment',
    a.id,
    `assignment ${a.id} completed`,
    withSurvivor(diff(a, updated), a.survivor_id, survivorChange)
  );
}

// Accept a proposal: the assignment becomes active and the survivor assigned.
export function acceptProposal(ctx: Ctx, a: AssignmentRow, s: SurvivorRow): void {
  const t = siteTimings(ctx);
  const updated: AssignmentRow = {
    ...a,
    status: { tag: 'active' },
    accepted_at: ctx.timestamp,
    lease_expires_at: tsAt(addSeconds(ctx, t.assignment_lease_s)),
    updated_at: ctx.timestamp,
  };
  ctx.db.assignment.id.update(updated);
  cancelLease(ctx, 'proposal', a.id);
  setLease(ctx, 'assignment', a.id, updated.lease_expires_at.microsSinceUnixEpoch);

  // Accepting is a sign of life, so start the rescuer heartbeat window from now.
  const p = ctx.db.participant.identity.find(a.rescuer_identity);
  if (p) ctx.db.participant.identity.update({ ...p, last_heartbeat: ctx.timestamp, last_seen: ctx.timestamp });
  setHeartbeatRescuer(ctx, a.rescuer_identity);

  const { change: sc } = setSurvivorStatus(ctx, s, 'assigned');
  logEvent(
    ctx,
    'assignment_accepted',
    'assignment',
    a.id,
    `assignment ${a.id} accepted for survivor ${s.id}`,
    withSurvivor(diff(a, updated), s.id, sc)
  );

  // Any other open proposal for this survivor is released.
  for (const other of assignmentsOfSurvivor(ctx, s.id, 'proposed')) {
    if (other.id !== a.id) {
      releaseAssignment(ctx, other, 'reassigned', 'assignment_released', `proposal ${other.id} released: survivor ${s.id} accepted by another rescuer`);
    }
  }
}

function tsAt(micros: bigint): Timestamp {
  return new Timestamp(micros);
}

export function setHeartbeatRescuer(ctx: Ctx, identity: ParticipantRow['identity']): void {
  setHeartbeat(ctx, 'rescuer', identity, '', RESCUER_HEARTBEAT_S);
}

// Renew the caller's active assignment leases and heartbeat timer (rescuer_heartbeat, position updates).
export function renewRescuer(ctx: Ctx, identity: ParticipantRow['identity']): void {
  const t = siteTimings(ctx);
  const due = addSeconds(ctx, t.assignment_lease_s);
  const active = activeAssignmentsOf(ctx, identity);
  for (const a of active) {
    ctx.db.assignment.id.update({ ...a, lease_expires_at: tsAt(due), updated_at: ctx.timestamp });
    setLease(ctx, 'assignment', a.id, due);
  }
  if (active.length > 0) setHeartbeatRescuer(ctx, identity);
}

export interface ProposalInput {
  survivor: SurvivorRow;
  target: ParticipantRow;
  reason: string;
  createdBy: string;
  // Coordinators reassign: an existing active assignment or proposal of the survivor is released first.
  reassign: boolean;
  // Orchestrator and watchdog proposals get a review task for the auditor.
  review: boolean;
}

// Create a proposed assignment (shared by propose_assignment and the watchdog fallback).
export function createProposal(ctx: Ctx, input: ProposalInput): AssignmentRow {
  const { survivor: s, target, reason, createdBy } = input;
  if (s.status.tag === 'resolved') throw new SenderError('survivor resolved');
  if (!['rescuer', 'coordinator', 'commander'].includes(target.role.tag)) {
    throw new SenderError('target is not a rescuer');
  }
  if (!target.online) throw new SenderError('rescuer offline');
  if (openProposalOf(ctx, target.identity)) throw new SenderError('rescuer has a pending proposal');

  const active = assignmentsOfSurvivor(ctx, s.id, 'active');
  const proposed = assignmentsOfSurvivor(ctx, s.id, 'proposed');
  if (!input.reassign) {
    if (active.length > 0) throw new SenderError('already assigned');
    if (proposed.length > 0) throw new SenderError('proposal pending');
  } else {
    for (const a of [...active, ...proposed]) {
      releaseAssignment(ctx, a, 'reassigned', 'assignment_released', `assignment ${a.id} released: reassigned by ${createdBy}`);
    }
  }

  const t = siteTimings(ctx);
  const due = addSeconds(ctx, t.proposal_lease_s);
  const chain_id = chainFor(ctx, s.id);
  const fresh = ctx.db.survivor.id.find(s.id) ?? s;
  const a = ctx.db.assignment.insert({
    id: 0n,
    chain_id,
    survivor_id: s.id,
    rescuer_identity: target.identity,
    status: { tag: 'proposed' },
    lease_expires_at: tsAt(due),
    accepted_at: undefined,
    release_cause: undefined,
    created_by: createdBy,
    created_at: ctx.timestamp,
    updated_at: ctx.timestamp,
  });
  setLease(ctx, 'proposal', a.id, due);
  logEvent(ctx, 'assignment_proposed', 'assignment', a.id, `proposed ${target.name} for survivor ${s.id}: ${reason}`, {
    before: {},
    after: { ...rowToPlain(a), reason },
  });

  if (input.review) {
    const distance =
      target.lat !== undefined && target.lon !== undefined
        ? Math.round(haversineM(target.lat, target.lon, fresh.lat, fresh.lon) * 10) / 10
        : null;
    const payload = JSON.stringify({
      assignment_id: a.id.toString(),
      survivor_id: s.id.toString(),
      rescuer_identity: target.identity.toHexString(),
      distance_m: distance,
      critical_level: fresh.critical_level.tag,
      reason,
    });
    const task = ctx.db.agent_task.insert({
      id: 0n,
      run_id: activeRunId(ctx),
      chain_id,
      from_agent: createdBy,
      to_agent: { tag: 'auditor' },
      kind: 'review',
      payload_json: payload,
      priority: { tag: fresh.critical_level.tag === 'immediate' ? 'critical' : 'high' },
      status: { tag: 'open' },
      claimed_at: undefined,
      lease_expires_at: undefined,
      result_json: undefined,
      reason: `review proposal ${a.id}`,
      created_at: ctx.timestamp,
      updated_at: ctx.timestamp,
    });
    logEvent(ctx, 'agent_task_posted', 'agent_task', task.id, `review task ${task.id} for proposal ${a.id}`, {
      before: {},
      after: { id: task.id.toString(), kind: 'review', to_agent: 'auditor', from_agent: createdBy, status: 'open' },
    });
  }
  return a;
}

// Insert a briefing row. Module-written briefings skip the per-sender rate limit.
export function insertBriefing(
  ctx: Ctx,
  audience: string,
  text: string,
  priority: BriefingPriorityTag,
  kind: BriefingKindTag | undefined,
  survivor_id: bigint | undefined,
  created_by: string = MODULE_ACTOR
): void {
  ctx.db.briefing.insert({
    id: 0n,
    run_id: activeRunId(ctx),
    chain_id: survivor_id !== undefined ? chainFor(ctx, survivor_id) : 0n,
    audience,
    text: text.slice(0, 120),
    priority: { tag: priority },
    kind: kind === undefined ? undefined : { tag: kind },
    survivor_id,
    created_by,
    created_at: ctx.timestamp,
  });
}
