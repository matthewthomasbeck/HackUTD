import { SenderError, t } from 'spacetimedb/server';
import { Timestamp, ScheduleAt } from 'spacetimedb';
import spacetimedb, {
  Role, Breathing, Role as _Role, CellStatus, RobotState, DeviceHealth, MissionKind, MissionStatus,
  DetectionSource, CriticalLevel, Resolution, AssignmentStatus, ReleaseCause, BriefingPriority,
  BriefingKind, AgentName, TaskPriority, TaskStatus, TerrainClass, TerrainAction, PersonReportKind,
  PersonReportSource, AuditFlagKind, AuditFlagStatus, participant, site, search_cell, robot, device_status, mission, detection, survivor, assignment,
  briefing, agent_task, event_log, run, audit_flag, agent_action, person_report, lease_timer,
  heartbeat_timer, escalation_timer, agent_watchdog, sweep_timer, teleop,
} from './schema';
import { ensureSchedules, setLease, setHeartbeat, cancelLease, cancelHeartbeat, armEscalation, cancelEscalation, addSeconds, resetWatchdog, insertWatchdog } from './lib/timers';
import { anySite, callerParticipant, isDemo, authorize, requireRobot, activeSite, isCoordinator } from './lib/auth';
import type { Ctx } from './schema';
import type { Infer } from 'spacetimedb/server';
import { checkLatLon, checkNumber, checkConfidence, checkUrl, freeText, checkName, checkKind, checkJson, checkLen } from './lib/text';
import { logEvent, diff, created, activeRunId, rowToPlain, type Plain } from './lib/events';
import { cellForPoint, siteForPoint, haversineM, metersToDeg } from './lib/geo';
import { createProposal, setSurvivorStatus, releaseAssignment, acceptProposal, renewRescuer, insertBriefing, chainFor, siteTimings, activeAssignmentsOf, assignmentsOfSurvivor, completeAssignment } from './lib/state';
import { DISCONNECT_GRACE_S, ROBOT_DISCONNECT_GRACE_S, ROBOT_HEARTBEAT_S, RESCUER_HEARTBEAT_S, AGENT_TASK_LEASE_S, AGENT_TASK_MAX_ATTEMPTS, MIN_THERMAL_CONFIDENCE, MODULE_ACTOR, MAX_OPEN_AGENT_PROPOSALS, MAX_OPEN_TASKS_PER_AGENT, MAX_GRID_CELLS, UNATTENDED_HEADLINE_S, UNPROPOSED_BACKSTOP_S, UNPROPOSED_BACKSTOP_DEMO_S, MERGE_RADIUS_M, DUPLICATE_RADIUS_M, OBSERVED_AT_MAX_FUTURE_US, TELEOP_MAX_LIN_MPS, TELEOP_MAX_TURN_DPS } from './config';

type RoleValue = Infer<typeof Role>;

function checkObservedAt(ctx: Ctx, observedAt: Timestamp | undefined): void {
  if (!observedAt) return;
  if (observedAt.microsSinceUnixEpoch > ctx.timestamp.microsSinceUnixEpoch + OBSERVED_AT_MAX_FUTURE_US) throw new SenderError('observed_at too far in the future');
  for (const run of ctx.db.run.iter()) if (run.ended_at === undefined && observedAt.microsSinceUnixEpoch < run.started_at.microsSinceUnixEpoch) throw new SenderError('observed_at is before active run');
}

export { default } from './schema';

function roleAllowedAtBootstrap(ctx: Ctx, role: string): boolean {
  if (role === 'rescuer' || isDemo(ctx) || !anySite(ctx)) return true;
  const grant = ctx.db.role_grant.identity.find(ctx.sender);
  return grant?.role.tag === role;
}

function validateParticipantName(name: string, role: string): void {
  if (name.length < 1 || name.length > 40) throw new SenderError('name must be 1 to 40 characters');
  if (role === 'robot' && !/^[a-z0-9_-]{1,16}$/.test(name)) {
    throw new SenderError('robot name must match ^[a-z0-9_-]{1,16}$');
  }
  if (role === 'agent' && name !== 'orchestrator' && name !== 'comms_agent') {
    throw new SenderError('agent name must be orchestrator or comms_agent');
  }
  if (role === 'auditor' && name !== 'auditor') throw new SenderError('auditor name must be auditor');
}

function upsertParticipant(ctx: Ctx, name: string, role: RoleValue): void {
  const prior = ctx.db.participant.identity.find(ctx.sender);
  const now = ctx.timestamp;
  const row = {
    identity: ctx.sender,
    name,
    role,
    lat: prior?.lat,
    lon: prior?.lon,
    online: true,
    last_heartbeat: now,
    last_seen: now,
  };
  if (prior) ctx.db.participant.identity.update(row);
  else ctx.db.participant.insert(row);
}

function connectionKey(ctx: Ctx): string | undefined { return ctx.connectionId?.toString(); }
function markConnected(ctx: Ctx): void {
  const id = connectionKey(ctx); if (id) {
    const prior = ctx.db.presence.connection_id.find(id);
    if (!prior) ctx.db.presence.insert({ connection_id: id, identity: ctx.sender, connected_at: ctx.timestamp });
  }
  cancelHeartbeat(ctx, 'disconnect_grace', ctx.sender, '');
  const p = ctx.db.participant.identity.find(ctx.sender);
  if (p) ctx.db.participant.identity.update({ ...p, online: true, last_seen: ctx.timestamp });
}
function markDisconnected(ctx: Ctx): void {
  const id = connectionKey(ctx); if (!id) return;
  const row = ctx.db.presence.connection_id.find(id); if (row) ctx.db.presence.connection_id.delete(id);
  const p = ctx.db.participant.identity.find(ctx.sender); if (!p) return;
  ctx.db.participant.identity.update({ ...p, last_seen: ctx.timestamp });
  if ([...ctx.db.presence.identity.filter(ctx.sender)].length > 0) return;
  if (p.role.tag === 'rescuer' || p.role.tag === 'coordinator' || p.role.tag === 'commander') setHeartbeat(ctx, 'disconnect_grace', ctx.sender, '', DISCONNECT_GRACE_S);
  else if (p.role.tag === 'robot') setHeartbeat(ctx, 'disconnect_grace', ctx.sender, p.name, ROBOT_DISCONNECT_GRACE_S);
}
export const init = spacetimedb.init(ctx => ensureSchedules(ctx));
export const onConnect = spacetimedb.clientConnected(ctx => { ensureSchedules(ctx); markConnected(ctx); });
export const onDisconnect = spacetimedb.clientDisconnected(ctx => markDisconnected(ctx));

export const register_participant = spacetimedb.reducer(
  { name: 'register_participant' },
  { name: t.string(), role: Role },
  (ctx, { name, role }) => {
    const roleName = role.tag;
    validateParticipantName(name, roleName);
    if (!roleAllowedAtBootstrap(ctx, roleName)) throw new SenderError('role not granted');
    if (roleName === 'agent' || roleName === 'auditor') {
      for (const p of ctx.db.participant.name.filter(name)) {
        if (p.identity.toHexString() !== ctx.sender.toHexString() && p.online) {
          throw new SenderError('agent name is held by another online identity');
        }
      }
    }
    upsertParticipant(ctx, name, role);
  }
);

export const grant_role = spacetimedb.reducer(
  { name: 'grant_role' },
  { identity: t.identity(), role: Role },
  (ctx, { identity, role }) => {
    const caller = callerParticipant(ctx);
    const bootstrap = !anySite(ctx);
    if (!bootstrap && caller?.role.tag !== 'coordinator' && caller?.role.tag !== 'commander') {
      throw new SenderError('coordinator or commander required');
    }
    const granted_by = caller?.name ?? 'bootstrap';
    const grant = { identity, role, granted_by };
    if (ctx.db.role_grant.identity.find(identity)) ctx.db.role_grant.identity.update(grant);
    else ctx.db.role_grant.insert(grant);
    const existing = ctx.db.participant.identity.find(identity);
    if (existing) ctx.db.participant.identity.update({ ...existing, role });
  }
);

// Per-rescuer live views (section 11.2). All lookups use indexes.
export const my_assignment = spacetimedb.view(
  { name: 'my_assignment', public: true },
  t.array(assignment.rowType),
  ctx => [...ctx.db.assignment.rescuer_identity.filter(ctx.sender)]
);
export const my_briefing = spacetimedb.view(
  { name: 'my_briefing', public: true },
  t.array(briefing.rowType),
  ctx => [...ctx.db.briefing.audience.filter('all'), ...ctx.db.briefing.audience.filter(ctx.sender.toHexString())]
);
export const my_survivor = spacetimedb.view(
  { name: 'my_survivor', public: true },
  t.array(survivor.rowType),
  ctx => {
    const rows = new Map<bigint, Infer<typeof survivor.rowType>>();
    for (const a of ctx.db.assignment.rescuer_identity.filter(ctx.sender)) {
      if (a.status.tag !== 'proposed' && a.status.tag !== 'active') continue;
      const s = ctx.db.survivor.id.find(a.survivor_id);
      if (s) rows.set(s.id, s);
    }
    return [...rows.values()];
  }
);
export const critical_open = spacetimedb.view(
  { name: 'critical_open', public: true },
  t.array(survivor.rowType),
  ctx => [...ctx.db.survivor.critical_level.filter({ tag: 'immediate' })].filter(s => s.status.tag !== 'resolved')
);

export const participant_update_position = spacetimedb.reducer(
  { name: 'participant_update_position' },
  { lat: t.f64(), lon: t.f64() },
  (ctx, { lat, lon }) => {
    const p = authorize(ctx, { roles: ['rescuer', 'coordinator', 'commander'] });
    checkLatLon(lat, lon);
    ctx.db.participant.identity.update({ ...p, lat, lon, online: true, last_heartbeat: ctx.timestamp, last_seen: ctx.timestamp });
    renewRescuer(ctx, p.identity);
  }
);
export const rescuer_heartbeat = spacetimedb.reducer(ctx => {
  const p = authorize(ctx, { roles: ['rescuer', 'coordinator', 'commander'] });
  ctx.db.participant.identity.update({ ...p, online: true, last_heartbeat: ctx.timestamp, last_seen: ctx.timestamp });
  renewRescuer(ctx, p.identity);
});

export const create_site = spacetimedb.reducer(
  { name: 'create_site' },
  { name: t.string(), center_lat: t.f64(), center_lon: t.f64(), radius_m: t.f64(), demo_mode: t.bool(), require_mission_approval: t.bool() },
  (ctx, args) => {
    const p = callerParticipant(ctx); if (!p) throw new SenderError('not registered');
    const simBootstrap = p.role.tag === 'sim' && !anySite(ctx) && args.demo_mode;
    if (!simBootstrap && p.role.tag !== 'coordinator' && p.role.tag !== 'commander' && !(p.role.tag === 'sim' && isDemo(ctx) && args.demo_mode)) throw new SenderError('not allowed to create site');
    if (p.role.tag === 'sim' && !args.demo_mode) throw new SenderError('sim sites must use demo mode');
    checkName(args.name); checkLatLon(args.center_lat, args.center_lon); checkNumber(args.radius_m, 10, 5000, 'radius_m');
    const timing = args.demo_mode
      ? { mission_lease_s: 15, assignment_lease_s: 30, proposal_lease_s: 30, escalate_after_s: 45 }
      : { mission_lease_s: 30, assignment_lease_s: 120, proposal_lease_s: 60, escalate_after_s: 180 };
    ctx.db.site.insert({ id: 0n, ...args, ...timing, created_at: ctx.timestamp });
  }
);

export const set_site_timings = spacetimedb.reducer({ name: 'set_site_timings' }, { site_id: t.u64(), mission_lease_s: t.u32(), assignment_lease_s: t.u32(), proposal_lease_s: t.u32(), escalate_after_s: t.u32() }, (ctx, args) => {
  authorize(ctx, { roles: ['coordinator', 'commander'], sim: true });
  for (const [k, v] of Object.entries(args).slice(1)) checkNumber(v as number, 5, 3600, k);
  const s = ctx.db.site.id.find(args.site_id); if (!s) throw new SenderError('site not found');
  const row = { ...s, mission_lease_s: args.mission_lease_s, assignment_lease_s: args.assignment_lease_s, proposal_lease_s: args.proposal_lease_s, escalate_after_s: args.escalate_after_s };
  ctx.db.site.id.update(row); logEvent(ctx, 'timings_changed', 'site', s.id, 'site timings changed', diff(s, row));
});

export const create_search_cell = spacetimedb.reducer({ name: 'create_search_cell' }, { site_id: t.u64(), lat: t.f64(), lon: t.f64(), size_m: t.f64(), label: t.string() }, (ctx, args) => {
  authorize(ctx, { roles: ['coordinator', 'commander'], sim: true }); checkLatLon(args.lat, args.lon); checkNumber(args.size_m, 5, 200, 'size_m'); checkName(args.label);
  const s = ctx.db.site.id.find(args.site_id); if (!s || haversineM(s.center_lat, s.center_lon, args.lat, args.lon) > s.radius_m + args.size_m / 2) throw new SenderError('cell outside site');
  const cell = ctx.db.search_cell.insert({ id: 0n, site_id: args.site_id, lat: args.lat, lon: args.lon, size_m: args.size_m, label: args.label, status: { tag: 'unsearched' }, searched_by: undefined, found: 0, reported_missing: 0, reported_safe: 0, unaccounted: 0, updated_at: ctx.timestamp });
  logEvent(ctx, 'cell_status', 'search_cell', cell.id, `cell ${cell.label} created`, created(cell));
});

export const create_search_grid = spacetimedb.reducer({ name: 'create_search_grid' }, { site_id: t.u64(), size_m: t.f64() }, (ctx,args) => {
  authorize(ctx,{roles:['coordinator','commander'],sim:true}); checkNumber(args.size_m,5,200,'size_m'); const s=ctx.db.site.id.find(args.site_id); if(!s) throw new SenderError('site not found');
  if([...ctx.db.search_cell.site_id.filter(s.id)].length) throw new SenderError('site already has cells');
  const step=metersToDeg(s.center_lat,args.size_m); const latMin=s.center_lat-(s.radius_m/111320); const latMax=s.center_lat+(s.radius_m/111320); const lonSpan=s.radius_m/(111320*Math.cos(s.center_lat*Math.PI/180));
  const planned: Array<{lat:number;lon:number;label:string}> = [];
  let rowIndex=0; for(let lat=latMin;lat<=latMax+step.dLat/2;lat+=step.dLat,rowIndex++) { let col=0;
    for(let lon=s.center_lon-lonSpan;lon<=s.center_lon+lonSpan+step.dLon/2;lon+=step.dLon,col++) if(haversineM(s.center_lat,s.center_lon,lat,lon)<=s.radius_m+args.size_m/2) {
      planned.push({lat,lon,label:`${String.fromCharCode(65+(rowIndex%26))}${col+1}`});
      if(planned.length>MAX_GRID_CELLS) throw new SenderError('grid exceeds MAX_GRID_CELLS');
    }
  }
  if(planned.length>MAX_GRID_CELLS) throw new SenderError('grid exceeds MAX_GRID_CELLS');
  const cells=[]; for(const c of planned) cells.push(ctx.db.search_cell.insert({id:0n,site_id:s.id,lat:c.lat,lon:c.lon,size_m:args.size_m,label:c.label,status:{tag:'unsearched'},searched_by:undefined,found:0,reported_missing:0,reported_safe:0,unaccounted:0,updated_at:ctx.timestamp}));
  logEvent(ctx,'grid_created','search_cell',0n,`created ${cells.length} search cells`,{before:{},after:{cells:cells.map(rowToPlain)}});
});

export const label_cell = spacetimedb.reducer({ name: 'label_cell' }, { cell_id: t.u64(), label: t.string() }, (ctx, args) => {
  authorize(ctx, { roles: ['coordinator', 'commander'], sim: true }); checkName(args.label); const c = ctx.db.search_cell.id.find(args.cell_id); if (!c) throw new SenderError('cell not found');
  const row = { ...c, label: args.label, updated_at: ctx.timestamp }; ctx.db.search_cell.id.update(row); logEvent(ctx, 'cell_status', 'search_cell', c.id, `cell ${c.id} labelled ${args.label}`, diff(c, row));
});

export const report_person = spacetimedb.reducer({ name: 'report_person' }, { cell_id: t.u64(), kind: PersonReportKind, count: t.u32(), name_or_unit: t.option(t.string()), note: t.string(), source: PersonReportSource }, (ctx, args) => {
  const p = authorize(ctx, { roles: ['coordinator', 'commander'], sim: true }); const c = ctx.db.search_cell.id.find(args.cell_id); if (!c) throw new SenderError('cell not found');
  checkNumber(args.count, 1, 500, 'count'); const note = freeText(args.note, 500, 'note');
  const row = ctx.db.person_report.insert({ id: 0n, run_id: activeRunId(ctx), cell_id: c.id, kind: args.kind, count: args.count, name_or_unit: args.name_or_unit, note, source: args.source, reported_by: p.name, created_at: ctx.timestamp });
  logEvent(ctx, 'person_report', 'search_cell', c.id, `${args.kind.tag} report count ${args.count}`, created(row)); recomputeCell(ctx, c.id);
});

function recomputeCell(ctx: Ctx, cellId: bigint): void {
  const c = ctx.db.search_cell.id.find(cellId); if (!c) return;
  const found = [...ctx.db.survivor.cell_id.filter(cellId)].filter(s => !(s.status.tag === 'resolved' && (s.resolution?.tag === 'false_alarm' || s.resolution?.tag === 'duplicate'))).length;
  let missing = 0; let safe = 0;
  for (const report of ctx.db.person_report.cell_id.filter(cellId)) { if (report.kind.tag === 'missing') missing += report.count; else safe += report.count; }
  const unaccounted = Math.max(0, missing - found - safe); const row = { ...c, found, reported_missing: missing, reported_safe: safe, unaccounted, updated_at: ctx.timestamp };
  ctx.db.search_cell.id.update(row);
  if (unaccounted > c.unaccounted) logEvent(ctx, 'unaccounted', 'search_cell', c.id, `cell ${c.id} has ${unaccounted} unaccounted people`, diff(c, row));
}

export const lease_expired = spacetimedb.reducer({ onSchedule: lease_timer }, { arg: lease_timer.rowType }, (ctx, { arg }) => {
  const now = ctx.timestamp.microsSinceUnixEpoch;
  if (arg.kind.tag === 'proposal' || arg.kind.tag === 'assignment') {
    const a = ctx.db.assignment.id.find(arg.entity_id); if (!a || a.lease_expires_at.microsSinceUnixEpoch > now) return;
    const status = arg.kind.tag === 'proposal' ? 'proposed' : 'active'; if (a.status.tag !== status) return;
    releaseAssignment(ctx, a, 'expired', 'assignment_expired', `assignment ${a.id} expired`); return;
  }
  if (arg.kind.tag === 'mission') {
    const m = ctx.db.mission.id.find(arg.entity_id); if (!m || !m.lease_expires_at || m.lease_expires_at.microsSinceUnixEpoch > now || (m.status.tag !== 'leased' && m.status.tag !== 'active')) return;
    if (m.kind.tag === 'teleop') { endTeleop(ctx, m, 'lease expired'); return; }
    const r = ctx.db.robot.robot_id.find(m.robot_id); const row = { ...m, status: { tag: 'queued' as const }, robot_id: r?.online ? m.robot_id : '', lease_expires_at: undefined, updated_at: ctx.timestamp };
    ctx.db.mission.id.update(row); if (r?.current_mission_id === m.id) ctx.db.robot.robot_id.update({ ...r, current_mission_id: undefined }); reopenMissionCells(ctx, m); logEvent(ctx, 'mission_requeued', 'mission', m.id, `mission ${m.id} requeued`, diff(m, row)); return;
  }
  const task = ctx.db.agent_task.id.find(arg.entity_id); if (!task) return; expireTaskLease(ctx, task);
});

function expireTaskLease(ctx: Ctx, task: Infer<typeof agent_task.rowType>): void {
  const now = ctx.timestamp.microsSinceUnixEpoch;
  if (task.status.tag !== 'claimed' || !task.lease_expires_at || task.lease_expires_at.microsSinceUnixEpoch > now) return;
  const attempt = ctx.db.task_attempts.task_id.find(task.id); const attempts = (attempt?.attempts ?? 0) + 1;
  if (attempt) ctx.db.task_attempts.task_id.update({ ...attempt, attempts }); else ctx.db.task_attempts.insert({ task_id: task.id, attempts });
  const status = attempts >= AGENT_TASK_MAX_ATTEMPTS ? 'expired' as const : 'open' as const;
  const row = { ...task, status: { tag: status }, claimed_at: undefined, lease_expires_at: undefined, updated_at: ctx.timestamp }; ctx.db.agent_task.id.update(row);
  logEvent(ctx, 'agent_task_expired', 'agent_task', task.id, `task ${task.id} lease expired`, diff(task, row));
}

function requeueExpiredMission(ctx: Ctx, missionRow: Infer<typeof mission.rowType>): void {
  if (missionRow.kind.tag === 'teleop') { endTeleop(ctx, missionRow, 'lease expired'); return; }
  const r = ctx.db.robot.robot_id.find(missionRow.robot_id);
  const row = { ...missionRow, status: { tag: 'queued' as const }, robot_id: r?.online ? missionRow.robot_id : '', lease_expires_at: undefined, updated_at: ctx.timestamp };
  ctx.db.mission.id.update(row);
  if (r?.current_mission_id === missionRow.id) ctx.db.robot.robot_id.update({ ...r, current_mission_id: undefined });
  reopenMissionCells(ctx, missionRow);
  logEvent(ctx, 'mission_requeued', 'mission', missionRow.id, `mission ${missionRow.id} requeued`, diff(missionRow, row));
}

function markRobotOffline(ctx: Ctx, robotId: string): void {
  const r = ctx.db.robot.robot_id.find(robotId); if (!r || !r.online) return;
  const row = { ...r, online: false }; ctx.db.robot.robot_id.update(row); logEvent(ctx, 'robot_offline', 'robot', 0n, `${robotId} offline`, diff(r, row));
  for (const c of [...ctx.db.search_cell.iter()]) if (c.searched_by === robotId && c.status.tag === 'searching') {
    const updated = { ...c, status: { tag: 'unsearched' as const }, searched_by: undefined, updated_at: ctx.timestamp }; ctx.db.search_cell.id.update(updated); logEvent(ctx, 'cell_reopened', 'search_cell', c.id, `cell ${c.id} reopened after robot offline`, diff(c, updated));
  }
  insertBriefing(ctx, 'coordinators', `${robotId} offline`, 'warning', 'briefing', undefined);
}

function unassignedSince(ctx: Ctx, s: Infer<typeof survivor.rowType>): Timestamp {
  let latest = 0n;
  for (const event of ctx.db.event_log.iter()) {
    if (event.entity === 'survivor' && event.entity_id === s.id && event.kind === 'score_changed') {
      try { const after = JSON.parse(event.payload_json).after; if (after.critical_level === 'immediate' && event.created_at.microsSinceUnixEpoch > latest) latest = event.created_at.microsSinceUnixEpoch; } catch { /* malformed legacy rows do not set a timer origin */ }
    }
    if ((event.kind === 'assignment_released' || event.kind === 'assignment_expired') && event.entity === 'assignment') {
      try {
        const after = JSON.parse(event.payload_json).after;
        if (after.survivor?.id === s.id.toString() && after.survivor?.status === 'unassigned' && event.created_at.microsSinceUnixEpoch > latest) latest = event.created_at.microsSinceUnixEpoch;
      } catch { /* malformed legacy rows do not set a timer origin */ }
    }
  }
  return latest === 0n ? ctx.timestamp : new Timestamp(latest);
}

// Escalation event kinds already logged for this survivor in the unattended period that began at `since`.
function escalationsFiredSince(ctx: Ctx, survivor_id: bigint, since: Timestamp): Set<string> {
  const fired = new Set<string>();
  for (const event of ctx.db.event_log.entity_id.filter(survivor_id)) {
    if (event.entity === 'survivor' && (event.kind === 'escalation' || event.kind === 'escalation_commander') && event.created_at.microsSinceUnixEpoch >= since.microsSinceUnixEpoch) fired.add(event.kind);
  }
  return fired;
}

export const heartbeat_missed = spacetimedb.reducer({ onSchedule: heartbeat_timer }, { arg: heartbeat_timer.rowType }, (ctx, { arg }) => {
  if (arg.kind.tag === 'disconnect_grace' && [...ctx.db.presence.identity.filter(arg.identity)].length > 0) return;
  if (arg.kind.tag === 'robot' || (arg.kind.tag === 'disconnect_grace' && arg.robot_id !== '')) {
    const robotId = arg.robot_id; const r = ctx.db.robot.robot_id.find(robotId); if (!r || !r.online) return;
    const row = { ...r, online: false }; ctx.db.robot.robot_id.update(row); logEvent(ctx, 'robot_offline', 'robot', 0n, `${robotId} offline`, diff(r, row));
    for (const c of ctx.db.search_cell.iter()) if (c.searched_by === robotId && c.status.tag === 'searching') {
      const updated = { ...c, status: { tag: 'unsearched' as const }, searched_by: undefined, updated_at: ctx.timestamp }; ctx.db.search_cell.id.update(updated); logEvent(ctx, 'cell_reopened', 'search_cell', c.id, `cell ${c.id} reopened after robot offline`, diff(c, updated));
    }
    insertBriefing(ctx, 'coordinators', `${robotId} offline`, 'warning', 'briefing', undefined); return;
  }
  const p = ctx.db.participant.identity.find(arg.identity); if (!p || !p.online) return;
  if (arg.kind.tag === 'disconnect_grace' && [...ctx.db.presence.identity.filter(arg.identity)].length > 0) return;
  if (arg.kind.tag === 'rescuer' && p.last_heartbeat.microsSinceUnixEpoch + BigInt(RESCUER_HEARTBEAT_S) * 1_000_000n > ctx.timestamp.microsSinceUnixEpoch) return;
  ctx.db.participant.identity.update({ ...p, online: false, last_seen: ctx.timestamp });
  for (const a of [...ctx.db.assignment.rescuer_identity.filter(arg.identity)]) if (a.status.tag === 'active' || a.status.tag === 'proposed') releaseAssignment(ctx, a, arg.kind.tag === 'disconnect_grace' ? 'disconnected' : 'heartbeat', 'assignment_released', `assignment ${a.id} released after rescuer offline`);
  cancelHeartbeat(ctx, 'rescuer', arg.identity, '');
  logEvent(ctx, 'rescuer_offline', 'participant', 0n, `${p.name} offline`);
});

export const escalate = spacetimedb.reducer({ onSchedule: escalation_timer }, { arg: escalation_timer.rowType }, (ctx, { arg }) => {
  const s = ctx.db.survivor.id.find(arg.survivor_id); if (!s || s.status.tag !== 'unassigned' || s.critical_level.tag !== 'immediate') return;
  const elapsed = Math.floor(Number(ctx.timestamp.microsSinceUnixEpoch - arg.since.microsSinceUnixEpoch) / 1_000_000);
  if (arg.level === 1) {
    const text = `IMMEDIATE survivor ${s.id} (${s.house_label ?? 'location TBD'}) unassigned ${elapsed} s`;
    insertBriefing(ctx, 'all', text, 'critical', 'escalation', s.id);
    const row = { ...s, escalated_at: ctx.timestamp, updated_at: ctx.timestamp }; ctx.db.survivor.id.update(row); logEvent(ctx, 'escalation', 'survivor', s.id, text, diff(s, row));
    const n = siteTimings(ctx).escalate_after_s; armEscalation(ctx, s.id, 2, arg.since, arg.since.microsSinceUnixEpoch + BigInt(2 * n) * 1_000_000n);
  } else {
    const text = `IMMEDIATE survivor ${s.id} (${s.house_label ?? 'location TBD'}) needs commander attention`;
    insertBriefing(ctx, 'commander', text, 'critical', 'escalation', s.id); insertBriefing(ctx, 'all', text, 'critical', 'escalation', s.id);
    logEvent(ctx, 'escalation_commander', 'survivor', s.id, text);
  }
});

export const watchdog_fired = spacetimedb.reducer({ onSchedule: agent_watchdog }, { arg: agent_watchdog.rowType }, ctx => {
  // The firing schedule row is removed after this reducer, so re-arm by inserting a fresh row.
  insertWatchdog(ctx, ctx.timestamp);
  proposeNearestForUrgent(ctx, () => true, 'watchdog fallback nearest rescuer', 'orchestrator watchdog fallback');
});

// Last time this survivor's proposal state changed: the start of its unattended period or its newest assignment row change.
function unproposedSince(ctx: Ctx, s: Infer<typeof survivor.rowType>): bigint {
  let latest = unassignedSince(ctx, s).microsSinceUnixEpoch;
  for (const a of ctx.db.assignment.survivor_id.filter(s.id)) if (a.updated_at.microsSinceUnixEpoch > latest) latest = a.updated_at.microsSinceUnixEpoch;
  return latest;
}

// Proposes the least loaded, then nearest, free rescuer for each unassigned immediate survivor with no open proposal that passes `due`.
// The agent watchdog uses it when the orchestrator is silent; the sweep uses it as a backstop when an agent is alive but stuck.
function proposeNearestForUrgent(ctx: Ctx, due: (s: Infer<typeof survivor.rowType>) => boolean, proposalReason: string, actionReason: string): void {
  const urgent = [...ctx.db.survivor.iter()].filter(s => s.status.tag === 'unassigned' && s.critical_level.tag === 'immediate' && assignmentsOfSurvivor(ctx, s.id, 'proposed').length === 0 && due(s));
  if (!urgent.length) return;
  urgent.sort((a,b) => b.critical_score - a.critical_score || Number(a.created_at.microsSinceUnixEpoch - b.created_at.microsSinceUnixEpoch) || Number(a.id-b.id));
  const candidates = [...ctx.db.participant.iter()].filter(p => p.role.tag === 'rescuer' && p.online && p.lat !== undefined && p.lon !== undefined && p.last_heartbeat.microsSinceUnixEpoch + BigInt(RESCUER_HEARTBEAT_S)*1_000_000n > ctx.timestamp.microsSinceUnixEpoch && ![...ctx.db.assignment.rescuer_identity.filter(p.identity)].some(a => a.status.tag === 'proposed'));
  for (const s of urgent) {
    if (!candidates.length) break;
    candidates.sort((a,b) => activeAssignmentsOf(ctx,a.identity).length-activeAssignmentsOf(ctx,b.identity).length || haversineM(a.lat!,a.lon!,s.lat,s.lon)-haversineM(b.lat!,b.lon!,s.lat,s.lon) || a.identity.toHexString().localeCompare(b.identity.toHexString()));
    const target = candidates.shift()!; const proposal = createProposal(ctx,{survivor:s,target,reason:proposalReason,createdBy:MODULE_ACTOR,reassign:false,review:true});
    logEvent(ctx,'agent_watchdog_fallback','assignment',proposal.id,`watchdog proposed rescuer ${target.name}`);
    ctx.db.agent_action.insert({id:0n,run_id:activeRunId(ctx),chain_id:chainFor(ctx,s.id),agent:MODULE_ACTOR,step:0,model:'rules',tool:'propose_assignment',args_json:JSON.stringify({survivor_id:s.id.toString(),rescuer:target.name}),result:'proposed',reason:actionReason,created_at:ctx.timestamp});
  }
}

export const sweep = spacetimedb.reducer({ onSchedule: sweep_timer }, { arg: sweep_timer.rowType }, ctx => {
  ensureSchedules(ctx); const now = ctx.timestamp.microsSinceUnixEpoch;
  for (const a of [...ctx.db.assignment.iter()]) if (a.status.tag === 'proposed' || a.status.tag === 'active') {
    if (a.lease_expires_at.microsSinceUnixEpoch <= now) releaseAssignment(ctx,a,'expired','assignment_expired',`assignment ${a.id} expired`);
    else {
      const kind = a.status.tag === 'proposed' ? 'proposal' : 'assignment';
      const timers = [...ctx.db.lease_timer.entity_id.filter(a.id)].filter(t => t.kind.tag === kind);
      if (timers.length !== 1) setLease(ctx,kind,a.id,a.lease_expires_at.microsSinceUnixEpoch);
    }
  }
  for (const m of [...ctx.db.mission.iter()]) if (m.status.tag === 'leased' || m.status.tag === 'active') {
    if (m.lease_expires_at && m.lease_expires_at.microsSinceUnixEpoch <= now) requeueExpiredMission(ctx, m);
    else if (m.lease_expires_at) {
      const timers = [...ctx.db.lease_timer.entity_id.filter(m.id)].filter(t => t.kind.tag === 'mission');
      if (timers.length !== 1) setLease(ctx,'mission',m.id,m.lease_expires_at.microsSinceUnixEpoch);
    }
  }
  for (const task of [...ctx.db.agent_task.iter()]) if (task.status.tag === 'claimed' && task.lease_expires_at) {
    if (task.lease_expires_at.microsSinceUnixEpoch <= now) expireTaskLease(ctx, task);
    else {
      const timers = [...ctx.db.lease_timer.entity_id.filter(task.id)].filter(t => t.kind.tag === 'agent_task');
      if (timers.length !== 1) setLease(ctx,'agent_task',task.id,task.lease_expires_at.microsSinceUnixEpoch);
    }
  }
  for (const r of [...ctx.db.robot.iter()]) if (r.online) {
    const deadline = r.last_heartbeat.microsSinceUnixEpoch + BigInt(ROBOT_HEARTBEAT_S) * 1_000_000n;
    if (deadline <= now) { markRobotOffline(ctx, r.robot_id); continue; }
    const robotParticipant = [...ctx.db.participant.name.filter(r.name)].find(p => p.role.tag === 'robot')
      ?? (r.robot_id.startsWith('sim') ? [...ctx.db.participant.iter()].find(p => p.role.tag === 'sim') : undefined);
    if (robotParticipant) {
      const timers = [...ctx.db.heartbeat_timer.identity.filter(robotParticipant.identity)].filter(t => t.kind.tag === 'robot' && t.robot_id === r.robot_id);
      if (timers.length !== 1) setHeartbeat(ctx, 'robot', robotParticipant.identity, r.robot_id, Math.max(0.001, Number(deadline - now) / 1_000_000));
    }
  }
  for (const p of [...ctx.db.participant.iter()]) if (p.role.tag === 'rescuer' || p.role.tag === 'coordinator' || p.role.tag === 'commander') {
    const active = activeAssignmentsOf(ctx, p.identity); if (active.length === 0) continue;
    const deadline = p.last_heartbeat.microsSinceUnixEpoch + BigInt(RESCUER_HEARTBEAT_S) * 1_000_000n;
    if (deadline <= now) {
      ctx.db.participant.identity.update({ ...p, online: false, last_seen: ctx.timestamp });
      for (const a of active) releaseAssignment(ctx, a, 'heartbeat', 'assignment_released', `assignment ${a.id} released after rescuer heartbeat timeout`);
      cancelHeartbeat(ctx, 'rescuer', p.identity, ''); logEvent(ctx, 'rescuer_offline', 'participant', 0n, `${p.name} heartbeat missed`); continue;
    }
    const timers = [...ctx.db.heartbeat_timer.identity.filter(p.identity)].filter(t => t.kind.tag === 'rescuer');
    if (timers.length !== 1) setHeartbeat(ctx, 'rescuer', p.identity, '', Math.max(0.001, Number(deadline - now) / 1_000_000));
  }
  for (const s of [...ctx.db.survivor.iter()]) if (s.status.tag === 'unassigned' && s.critical_level.tag === 'immediate') {
    const timers = [...ctx.db.escalation_timer.survivor_id.filter(s.id)];
    if (timers.length === 1) continue;
    const since = unassignedSince(ctx, s); const n = siteTimings(ctx).escalate_after_s;
    const fired = escalationsFiredSince(ctx, s.id, since);
    if (fired.has('escalation_commander')) { cancelEscalation(ctx, s.id); continue; }
    const level = fired.has('escalation') ? 2 : 1;
    armEscalation(ctx, s.id, level, since, since.microsSinceUnixEpoch + BigInt(level === 1 ? n : 2 * n) * 1_000_000n);
  }
  const backstopUs = BigInt(isDemo(ctx) ? UNPROPOSED_BACKSTOP_DEMO_S : UNPROPOSED_BACKSTOP_S) * 1_000_000n;
  proposeNearestForUrgent(ctx, s => now - unproposedSince(ctx, s) >= backstopUs, 'backstop: no proposal for an immediate survivor', 'unproposed immediate backstop');
});

export const post_briefing = spacetimedb.reducer(
  { name: 'post_briefing' }, { audience: t.string(), text: t.string(), priority: BriefingPriority, survivor_id: t.option(t.u64()), kind: t.option(BriefingKind) }, (ctx, args) => {
    const p = callerParticipant(ctx); if (!p) throw new SenderError('not registered');
    if (!(p.name === 'comms_agent' && p.role.tag === 'agent') && p.role.tag !== 'coordinator' && p.role.tag !== 'commander' && !(p.role.tag === 'sim' && isDemo(ctx))) throw new SenderError('not allowed to post briefing');
    const text = freeText(args.text, 120, 'text', 1);
    if (!['all', 'coordinators', 'commander'].includes(args.audience) && !/^[0-9a-f]{64}$/.test(args.audience)) throw new SenderError('invalid audience');
    if (/^[0-9a-f]{64}$/.test(args.audience) && ![...ctx.db.participant.iter()].some(x => x.identity.toHexString() === args.audience)) throw new SenderError('audience not found');
    const last = [...ctx.db.briefing.iter()].filter(b => b.created_by === p.name && b.audience === args.audience).sort((a,b)=>Number(b.created_at.microsSinceUnixEpoch-a.created_at.microsSinceUnixEpoch))[0];
    if (last && ctx.timestamp.microsSinceUnixEpoch - last.created_at.microsSinceUnixEpoch < 3_000_000n) throw new SenderError('briefing rate limit');
    const row = ctx.db.briefing.insert({ id: 0n, run_id: activeRunId(ctx), chain_id: args.survivor_id === undefined ? 0n : chainFor(ctx,args.survivor_id), audience: args.audience, text, priority: args.priority, kind: args.kind, survivor_id: args.survivor_id, created_by: p.name, created_at: ctx.timestamp });
    void row;
  }
);

export const log_agent_action = spacetimedb.reducer(
  { name: 'log_agent_action' }, { tool: t.string(), args_json: t.string(), result: t.string(), reason: t.string(), step: t.u32(), model: t.string(), chain_id: t.u64() }, (ctx,args) => {
    const p = authorize(ctx,{agents:['orchestrator','comms_agent','auditor']}); checkJson(args.args_json,'args_json');
    const result = freeText(args.result,2000,'result'); const reason = freeText(args.reason,500,'reason',1); checkName(args.model,'model'); checkName(args.tool,'tool');
    ctx.db.agent_action.insert({id:0n,run_id:activeRunId(ctx),chain_id:args.chain_id,agent:p.name,step:args.step,model:args.model,tool:args.tool,args_json:args.args_json,result,reason,created_at:ctx.timestamp});
  }
);

export const file_audit_flag = spacetimedb.reducer(
  { name: 'file_audit_flag' }, { kind: AuditFlagKind, entity: t.string(), entity_id: t.u64(), message: t.string(), suggested_action: t.option(t.string()) }, (ctx,args) => {
    const p = authorize(ctx,{agents:['auditor']}); const message = freeText(args.message,500,'message',1); const suggested_action = args.suggested_action === undefined ? undefined : freeText(args.suggested_action,500,'suggested_action',1);
    for (const f of ctx.db.audit_flag.entity_id.filter(args.entity_id)) if (f.kind.tag === args.kind.tag && f.entity === args.entity && f.status.tag === 'open') return;
    const flag = ctx.db.audit_flag.insert({id:0n,run_id:activeRunId(ctx),kind:args.kind,entity:args.entity,entity_id:args.entity_id,message,suggested_action,status:{tag:'open'},filed_by:p.name,created_at:ctx.timestamp,updated_at:ctx.timestamp});
    logEvent(ctx,'audit_flag','audit_flag',flag.id,message,created(flag));
  }
);

export const set_audit_flag_status = spacetimedb.reducer({name:'set_audit_flag_status'},{flag_id:t.u64(),status:AuditFlagStatus},(ctx,args)=>{
  const p = authorize(ctx,{roles:['coordinator','commander'],agents:['orchestrator']}); if(args.status.tag==='open') throw new SenderError('status must be acted or dismissed');
  const f=ctx.db.audit_flag.id.find(args.flag_id); if(!f) throw new SenderError('flag not found'); const row={...f,status:args.status,updated_at:ctx.timestamp}; ctx.db.audit_flag.id.update(row);
  logEvent(ctx,'audit_flag','audit_flag',f.id,`flag ${f.id} ${args.status.tag}`,diff(f,row)); void p;
});

export const start_run = spacetimedb.reducer({name:'start_run'},{site_id:t.u64(),name:t.string()},(ctx,args)=>{
  authorize(ctx,{roles:['coordinator','commander'],sim:true}); if([...ctx.db.run.iter()].some(r=>r.ended_at===undefined)) throw new SenderError('run already active');
  const s=ctx.db.site.id.find(args.site_id); if(!s) throw new SenderError('site not found'); checkName(args.name);
  const row=ctx.db.run.insert({id:0n,site_id:s.id,name:args.name,started_at:ctx.timestamp,ended_at:undefined,notes:''});
  const snapshot: Record<string, Plain>={};
  for(const [name,table] of Object.entries({survivor:ctx.db.survivor,mission:ctx.db.mission,assignment:ctx.db.assignment,robot:ctx.db.robot,search_cell:ctx.db.search_cell,device_status:ctx.db.device_status,agent_task:ctx.db.agent_task,audit_flag:ctx.db.audit_flag})) snapshot[name]=[...table.iter()].map(rowToPlain);
  logEvent(ctx,'run_started','run',row.id,`run ${row.id} started`,{before:{},after:{run:rowToPlain(row),snapshot}});
});

export const end_run = spacetimedb.reducer({name:'end_run'},{run_id:t.u64(),notes:t.string()},(ctx,args)=>{
  authorize(ctx,{roles:['coordinator','commander'],sim:true}); const r=ctx.db.run.id.find(args.run_id); if(!r||r.ended_at!==undefined) throw new SenderError('active run not found');
  const notes=freeText(args.notes,500,'notes'); const row={...r,ended_at:ctx.timestamp,notes}; ctx.db.run.id.update(row); logEvent(ctx,'run_ended','run',r.id,`run ${r.id} ended`,diff(r,row));
});

export const log_event = spacetimedb.reducer({name:'log_event'},{kind:t.string(),message:t.string(),payload_json:t.string()},(ctx,args)=>{
  const p=callerParticipant(ctx); if(!p) throw new SenderError('not registered'); const kind=checkKind(args.kind); const message=freeText(args.message,500,'message'); checkJson(args.payload_json,'payload_json');
  if(p.role.tag==='sim'){if(!isDemo(ctx)||kind!=='sim_injection') throw new SenderError('sim may only log sim_injection in demo mode');}
  else if((p.role.tag!=='coordinator'&&p.role.tag!=='commander')||kind!=='note') throw new SenderError('coordinator note required');
  ctx.db.event_log.insert({id:0n,run_id:activeRunId(ctx),kind,entity:'any',entity_id:0n,message,payload_json:args.payload_json,created_at:ctx.timestamp});
});

export const report_breathing = spacetimedb.reducer(
  { name: 'report_breathing' },
  { survivor_id: t.u64(), breathing: Breathing, rate_bpm: t.option(t.f64()), confidence: t.f64(), visibility_pct: t.option(t.f64()), display_url: t.option(t.string()) },
  (ctx, args) => {
    authorize(ctx, { roles: ['perception'], sim: true });
    const s = ctx.db.survivor.id.find(args.survivor_id); if (!s) throw new SenderError('survivor not found');
    checkConfidence(args.confidence); if (args.rate_bpm !== undefined) checkNumber(args.rate_bpm, 0, 80, 'rate_bpm');
    if (args.rate_bpm !== undefined && args.breathing.tag !== 'detected') throw new SenderError('rate requires detected breathing');
    if (args.visibility_pct !== undefined) checkNumber(args.visibility_pct, 0, 100, 'visibility_pct');
    const url = checkUrl(args.display_url ?? undefined, 'display_url');
    const row = { ...s, breathing: args.breathing, breathing_rate_bpm: args.rate_bpm, breathing_confidence: args.confidence, visibility_pct: args.visibility_pct, breathing_display_url: url, updated_at: ctx.timestamp };
    ctx.db.survivor.id.update(row);
    logEvent(ctx, 'breathing_reported', 'survivor', s.id, `breathing ${args.breathing.tag}`, diff(s, row));
  }
);

export const set_critical_score = spacetimedb.reducer(
  { name: 'set_critical_score' },
  { survivor_id: t.u64(), level: CriticalLevel, score: t.f64(), confidence: t.f64(), reasons: t.array(t.string()) },
  (ctx, args) => {
    authorize(ctx, { roles: ['perception'], sim: true });
    const s = ctx.db.survivor.id.find(args.survivor_id); if (!s) throw new SenderError('survivor not found');
    checkNumber(args.score, 0, 100, 'score'); checkConfidence(args.confidence);
    if (args.reasons.length > 6) throw new SenderError('at most 6 score reasons');
    for (const reason of args.reasons) freeText(reason, 80, 'score reason', 1);
    if ((s.breathing.tag === 'not_detected' || s.breathing.tag === 'unknown') && args.level.tag === 'minor') {
      throw new SenderError('no signs of life must stay high');
    }
    const row = { ...s, critical_level: args.level, critical_score: args.score, score_confidence: args.confidence, score_reasons: args.reasons, updated_at: ctx.timestamp };
    ctx.db.survivor.id.update(row);
    logEvent(ctx, 'score_changed', 'survivor', s.id, `${s.critical_level.tag} -> ${args.level.tag}`, diff(s, row));
    if (args.level.tag === 'immediate' && s.status.tag === 'unassigned' && s.critical_level.tag !== 'immediate') {
      const n = siteTimings(ctx).escalate_after_s; armEscalation(ctx, s.id, 1, ctx.timestamp, addSeconds(ctx, n));
    } else if (args.level.tag !== 'immediate') cancelEscalation(ctx, s.id);
  }
);

export const robot_heartbeat = spacetimedb.reducer(
  { name: 'robot_heartbeat' },
  { robot_id: t.string(), state: RobotState, battery_pct: t.option(t.f64()), observed_at: t.option(t.timestamp()) },
  (ctx, args) => {
    requireRobot(ctx, args.robot_id);
    checkObservedAt(ctx, args.observed_at ?? undefined);
    if (args.battery_pct !== undefined) checkNumber(args.battery_pct, 0, 100, 'battery_pct');
    const prev = ctx.db.robot.robot_id.find(args.robot_id);
    const row = prev
      ? { ...prev, state: args.state, battery_pct: args.battery_pct, online: true, last_heartbeat: ctx.timestamp }
      : { robot_id: args.robot_id, name: args.robot_id, lat: undefined, lon: undefined, gps_fix: false, indoor_offset_m: undefined, heading_deg: undefined, battery_pct: args.battery_pct, state: args.state, online: true, current_mission_id: undefined, last_heartbeat: ctx.timestamp, terrain_class: { tag: 'unknown' as const }, terrain_confidence: 0, terrain_source: 'lidar_imu_rules', terrain_action: { tag: 'continue' as const } };
    if (prev) ctx.db.robot.robot_id.update(row); else ctx.db.robot.insert(row);
    setHeartbeat(ctx, 'robot', ctx.sender, args.robot_id, ROBOT_HEARTBEAT_S);
    if (row.current_mission_id !== undefined) {
      const current = ctx.db.mission.id.find(row.current_mission_id);
      if (current && (current.status.tag === 'leased' || current.status.tag === 'active')) {
        const due = addSeconds(ctx, siteTimings(ctx).mission_lease_s);
        ctx.db.mission.id.update({ ...current, lease_expires_at: new Timestamp(due), updated_at: ctx.timestamp });
        setLease(ctx, 'mission', current.id, due);
      }
    }
    if (!prev || !prev.online) logEvent(ctx, 'robot_online', 'robot', 0n, `${args.robot_id} online`);
    if (prev && prev.state.tag !== args.state.tag) logEvent(ctx, 'robot_state', 'robot', 0n, `${args.robot_id} state ${args.state.tag}`);
  }
);

export const robot_report_position = spacetimedb.reducer(
  { name: 'robot_report_position' },
  { robot_id: t.string(), lat: t.f64(), lon: t.f64(), gps_fix: t.bool(), indoor_offset_m: t.option(t.f64()), heading_deg: t.option(t.f64()), observed_at: t.option(t.timestamp()) },
  (ctx, args) => {
    requireRobot(ctx, args.robot_id); checkObservedAt(ctx, args.observed_at ?? undefined); checkLatLon(args.lat, args.lon);
    const r = ctx.db.robot.robot_id.find(args.robot_id); if (!r) throw new SenderError('heartbeat first');
    if (args.indoor_offset_m !== undefined) checkNumber(args.indoor_offset_m, 0, 1_000_000, 'indoor_offset_m');
    if (args.heading_deg !== undefined) checkNumber(args.heading_deg, 0, 360, 'heading_deg', true);
    ctx.db.robot.robot_id.update({ ...r, lat: args.lat, lon: args.lon, gps_fix: args.gps_fix, indoor_offset_m: args.indoor_offset_m, heading_deg: args.heading_deg });
  }
);

export const mark_cell = spacetimedb.reducer(
  { name: 'mark_cell' },
  { cell_id: t.u64(), status: CellStatus, observed_at: t.option(t.timestamp()) },
  (ctx, args) => {
    const p = callerParticipant(ctx); if (!p) throw new SenderError('not registered');
    const robotCaller = p.role.tag === 'robot' || p.role.tag === 'sim';
    if (p.role.tag === 'sim' && !isDemo(ctx)) throw new SenderError('sim role only in demo mode');
    if (!robotCaller) authorize(ctx, { roles: ['coordinator', 'commander'] });
    checkObservedAt(ctx, args.observed_at ?? undefined); const cell = ctx.db.search_cell.id.find(args.cell_id); if (!cell) throw new SenderError('cell not found');
    if (robotCaller && (args.status.tag === 'unsearched' || cell.status.tag === 'searched')) throw new SenderError('robot cannot reopen searched cell');
    const row = { ...cell, status: args.status, searched_by: robotCaller ? p.name : p.name, updated_at: ctx.timestamp };
    ctx.db.search_cell.id.update(row); logEvent(ctx, 'cell_status', 'search_cell', cell.id, `cell ${cell.id} ${args.status.tag}`, diff(cell, row), args.observed_at ?? undefined);
  }
);

export const propose_assignment = spacetimedb.reducer(
  { name: 'propose_assignment' },
  { survivor_id: t.u64(), rescuer_identity: t.identity(), reason: t.string() },
  (ctx, args) => {
    const p = callerParticipant(ctx); if (!p) throw new SenderError('not registered');
    const automated = p.role.tag === 'agent' && p.name === 'orchestrator';
    if (!automated && p.role.tag !== 'coordinator' && p.role.tag !== 'commander' && !(p.role.tag === 'sim' && isDemo(ctx))) throw new SenderError('not allowed to propose assignment');
    const reason = freeText(args.reason, 200, 'reason', 1);
    const s = ctx.db.survivor.id.find(args.survivor_id); if (!s) throw new SenderError('survivor not found');
    const target = ctx.db.participant.identity.find(args.rescuer_identity); if (!target) throw new SenderError('rescuer not found');
    createProposal(ctx, { survivor: s, target, reason, createdBy: p.name, reassign: isCoordinator(p), review: automated });
  }
);

export const accept_assignment = spacetimedb.reducer(
  { name: 'accept_assignment' }, { assignment_id: t.u64() }, (ctx, { assignment_id }) => {
    const p = authorize(ctx, { roles: ['rescuer', 'coordinator', 'commander'], human: true });
    const a = ctx.db.assignment.id.find(assignment_id); if (!a) throw new SenderError('assignment not found');
    if (a.rescuer_identity.toHexString() !== ctx.sender.toHexString()) throw new SenderError('not the assignee');
    if (a.status.tag !== 'proposed' || a.lease_expires_at.microsSinceUnixEpoch <= ctx.timestamp.microsSinceUnixEpoch) throw new SenderError('proposal expired');
    const s = ctx.db.survivor.id.find(a.survivor_id); if (!s || s.status.tag !== 'unassigned') throw new SenderError('survivor unavailable');
    acceptProposal(ctx, a, s);
  }
);

export const release_assignment = spacetimedb.reducer(
  { name: 'release_assignment' }, { assignment_id: t.u64() }, (ctx, { assignment_id }) => {
    const p = authorize(ctx, { roles: ['rescuer', 'coordinator', 'commander'], human: true });
    const a = ctx.db.assignment.id.find(assignment_id); if (!a || (a.status.tag !== 'proposed' && a.status.tag !== 'active')) throw new SenderError('assignment not open');
    const own = a.rescuer_identity.toHexString() === ctx.sender.toHexString();
    if (!own && !isCoordinator(p)) throw new SenderError('not the assignee');
    releaseAssignment(ctx, a, own ? 'declined' : 'reassigned', 'assignment_released', `assignment ${a.id} released by ${p.name}`);
  }
);

export const start_en_route = spacetimedb.reducer(
  { name: 'start_en_route' }, { assignment_id: t.u64() }, (ctx, { assignment_id }) => {
    authorize(ctx, { roles: ['rescuer', 'coordinator', 'commander'], human: true });
    const a = ctx.db.assignment.id.find(assignment_id); if (!a || a.status.tag !== 'active' || a.rescuer_identity.toHexString() !== ctx.sender.toHexString()) throw new SenderError('active assignment required');
    const s = ctx.db.survivor.id.find(a.survivor_id); if (!s) throw new SenderError('survivor not found');
    if (s.status.tag === 'en_route') return;
    const moved = setSurvivorStatus(ctx, s, 'en_route'); logEvent(ctx, 'en_route', 'survivor', s.id, `rescuer en route to survivor ${s.id}`, moved.change);
  }
);

export const mark_reached = spacetimedb.reducer(
  { name: 'mark_reached' }, { survivor_id: t.u64() }, (ctx, { survivor_id }) => {
    const p = authorize(ctx, { roles: ['rescuer', 'coordinator', 'commander'], human: true });
    const s = ctx.db.survivor.id.find(survivor_id); if (!s) throw new SenderError('survivor not found');
    const active = assignmentsOfSurvivor(ctx, s.id, 'active');
    if (!isCoordinator(p) && (active.length !== 1 || active[0].rescuer_identity.toHexString() !== ctx.sender.toHexString())) throw new SenderError('active assignment required');
    if (s.status.tag === 'assigned') {
      const enroute = setSurvivorStatus(ctx, s, 'en_route'); logEvent(ctx, 'en_route', 'survivor', s.id, `rescuer en route to survivor ${s.id}`, enroute.change);
      const reached = setSurvivorStatus(ctx, enroute.row, 'reached'); logEvent(ctx, 'survivor_reached', 'survivor', s.id, `survivor ${s.id} reached`, reached.change);
    } else if (s.status.tag === 'en_route') {
      const reached = setSurvivorStatus(ctx, s, 'reached'); logEvent(ctx, 'survivor_reached', 'survivor', s.id, `survivor ${s.id} reached`, reached.change);
    } else throw new SenderError('survivor must be assigned or en_route');
  }
);

export const resolve_survivor = spacetimedb.reducer(
  { name: 'resolve_survivor' }, { survivor_id: t.u64(), resolution: Resolution, note: t.string() }, (ctx, args) => {
    const p = authorize(ctx, { roles: ['rescuer', 'coordinator', 'commander'], human: true });
    const note = freeText(args.note, 500, 'note'); const s = ctx.db.survivor.id.find(args.survivor_id); if (!s) throw new SenderError('survivor not found');
    const coordinator = isCoordinator(p);
    const exceptional = coordinator && (args.resolution.tag === 'false_alarm' || args.resolution.tag === 'duplicate');
    if (!exceptional && s.status.tag !== 'reached') throw new SenderError('survivor must be reached');
    const active = assignmentsOfSurvivor(ctx, s.id, 'active');
    if (!coordinator && (active.length !== 1 || active[0].rescuer_identity.toHexString() !== ctx.sender.toHexString())) throw new SenderError('active assignment required');
    if (args.resolution.tag === 'duplicate' && s.possible_duplicate_of === 0n) throw new SenderError('not a possible duplicate');
    const moved = setSurvivorStatus(ctx, s, 'resolved', { override: exceptional, extra: { resolution: args.resolution, resolved_by: p.name } });
    for (const a of assignmentsOfSurvivor(ctx, s.id, 'active')) completeAssignment(ctx, a, moved.change);
    for (const a of assignmentsOfSurvivor(ctx, s.id, 'proposed')) releaseAssignment(ctx, a, 'reassigned', 'assignment_released', `assignment released: survivor ${s.id} resolved`);
    logEvent(ctx, 'survivor_resolved', 'survivor', s.id, `survivor ${s.id} resolved: ${note}`, moved.change);
    if ((args.resolution.tag === 'false_alarm' || args.resolution.tag === 'duplicate') && s.cell_id !== 0n) recomputeCell(ctx, s.cell_id);
  }
);

export const clear_possible_duplicate = spacetimedb.reducer(
  { name: 'clear_possible_duplicate' }, { survivor_id: t.u64() }, (ctx, { survivor_id }) => {
    authorize(ctx, { roles: ['coordinator', 'commander'] });
    const s = ctx.db.survivor.id.find(survivor_id); if (!s || s.status.tag === 'resolved' || s.possible_duplicate_of === 0n) throw new SenderError('not a possible duplicate');
    const row = { ...s, possible_duplicate_of: 0n, updated_at: ctx.timestamp }; ctx.db.survivor.id.update(row);
    logEvent(ctx, 'possible_duplicate_cleared', 'survivor', s.id, `possible duplicate cleared for survivor ${s.id}`, diff(s, row));
  }
);

export const robot_report_device = spacetimedb.reducer(
  { name: 'robot_report_device' },
  { robot_id: t.string(), device: t.string(), status: DeviceHealth, detail: t.string(), observed_at: t.option(t.timestamp()) },
  (ctx, args) => {
    requireRobot(ctx, args.robot_id); checkObservedAt(ctx, args.observed_at ?? undefined); if (!ctx.db.robot.robot_id.find(args.robot_id)) throw new SenderError('heartbeat first');
    if (!/^[a-z0-9_]{1,24}$/.test(args.device)) throw new SenderError('invalid device');
    const detail = freeText(args.detail, 200, 'detail');
    let row = [...ctx.db.device_status.robot_id.filter(args.robot_id)].find(d => d.device === args.device);
    if (!row) row = ctx.db.device_status.insert({ id: 0n, robot_id: args.robot_id, device: args.device, status: args.status, detail, updated_at: ctx.timestamp });
    else {
      const before = row; row = { ...row, status: args.status, detail, updated_at: ctx.timestamp }; ctx.db.device_status.id.update(row);
      if (before.status.tag !== row.status.tag) logEvent(ctx, 'device_status', 'robot', 0n, `${args.robot_id} ${args.device}: ${args.status.tag}`, diff(before, row), args.observed_at ?? undefined);
    }
    if (args.status.tag === 'FAILED') insertBriefing(ctx, 'coordinators', `${args.robot_id} ${args.device} failed`, 'warning', 'briefing', undefined);
  }
);

export const report_terrain = spacetimedb.reducer(
  { name: 'report_terrain' },
  { robot_id: t.string(), lat: t.f64(), lon: t.f64(), terrain_class: TerrainClass, confidence: t.f64(), source: t.string(), action: TerrainAction, image_url: t.option(t.string()), observed_at: t.option(t.timestamp()) },
  (ctx, args) => {
    const p = callerParticipant(ctx); if (!p) throw new SenderError('not registered');
    checkObservedAt(ctx, args.observed_at ?? undefined);
    if (p.role.tag === 'perception') { if (args.source !== 'camera_model') throw new SenderError('perception terrain source must be camera_model'); }
    else requireRobot(ctx, args.robot_id);
    checkLatLon(args.lat, args.lon); checkConfidence(args.confidence); checkUrl(args.image_url ?? undefined, 'image_url');
    if (!['lidar_imu_rules', 'camera_model'].includes(args.source)) throw new SenderError('invalid terrain source');
    const r = ctx.db.robot.robot_id.find(args.robot_id); if (!r) throw new SenderError('heartbeat first');
    const row = { ...r, terrain_class: args.terrain_class, terrain_confidence: args.confidence, terrain_source: args.source, terrain_action: args.action };
    ctx.db.robot.robot_id.update(row);
    if (r.terrain_class.tag !== row.terrain_class.tag) logEvent(ctx, 'terrain', 'robot', 0n, `${args.robot_id} terrain ${row.terrain_class.tag}`, diff(r, row), args.observed_at ?? undefined);
  }
);

export const post_agent_task = spacetimedb.reducer(
  { name: 'post_agent_task' },
  { to_agent: AgentName, kind: t.string(), payload_json: t.string(), priority: TaskPriority, reason: t.string(), chain_id: t.u64() },
  (ctx, args) => {
    const p = authorize(ctx, { agents: ['orchestrator', 'comms_agent', 'auditor'] });
    if (args.to_agent.tag === p.name) throw new SenderError('cannot address task to yourself'); checkKind(args.kind);
    checkJson(args.payload_json, 'payload_json'); const reason = freeText(args.reason, 500, 'reason', 1);
    const count = [...ctx.db.agent_task.to_agent.filter(args.to_agent)].filter(x => x.status.tag === 'open').length;
    if (count >= MAX_OPEN_TASKS_PER_AGENT) throw new SenderError('too many open tasks');
    const task = ctx.db.agent_task.insert({ id: 0n, run_id: activeRunId(ctx), chain_id: args.chain_id, from_agent: p.name, to_agent: args.to_agent, kind: args.kind, payload_json: args.payload_json, priority: args.priority, status: { tag: 'open' }, claimed_at: undefined, lease_expires_at: undefined, result_json: undefined, reason, created_at: ctx.timestamp, updated_at: ctx.timestamp });
    logEvent(ctx, 'agent_task_posted', 'agent_task', task.id, `task ${task.id} posted`, created(task));
  }
);

export const agent_heartbeat = spacetimedb.reducer(ctx => {
  const p = authorize(ctx, { agents: ['orchestrator', 'comms_agent', 'auditor'] });
  const row = ctx.db.participant.identity.find(p.identity); if (row) ctx.db.participant.identity.update({ ...row, online: true, last_heartbeat: ctx.timestamp, last_seen: ctx.timestamp });
  if (p.name === 'orchestrator') resetWatchdog(ctx);
});

export const claim_agent_task = spacetimedb.reducer({ name: 'claim_agent_task' }, { task_id: t.u64() }, (ctx, { task_id }) => {
  const p = authorize(ctx, { agents: ['orchestrator', 'comms_agent', 'auditor'] }); const task = ctx.db.agent_task.id.find(task_id);
  if (!task || task.to_agent.tag !== p.name || task.status.tag !== 'open') throw new SenderError('taken');
  const due = addSeconds(ctx, AGENT_TASK_LEASE_S); const row = { ...task, status: { tag: 'claimed' as const }, claimed_at: ctx.timestamp, lease_expires_at: new Timestamp(due), updated_at: ctx.timestamp };
  ctx.db.agent_task.id.update(row); setLease(ctx, 'agent_task', task.id, due); logEvent(ctx, 'agent_task_claimed', 'agent_task', task.id, `task ${task.id} claimed`, diff(task, row));
});

export const complete_agent_task = spacetimedb.reducer(
  { name: 'complete_agent_task' }, { task_id: t.u64(), status: TaskStatus, result_json: t.string() }, (ctx, args) => {
    const p = authorize(ctx, { agents: ['orchestrator', 'comms_agent', 'auditor'] }); const task = ctx.db.agent_task.id.find(args.task_id);
    if (!task || task.to_agent.tag !== p.name || task.status.tag !== 'claimed') throw new SenderError('task not claimed by caller');
    if (args.status.tag !== 'done' && args.status.tag !== 'failed') throw new SenderError('status must be done or failed');
    const parsed = checkJson(args.result_json, 'result_json'); if (args.result_json.length > 2000) throw new SenderError('result too long');
    if (task.kind === 'review') {
      if (p.name !== 'auditor' || !parsed || typeof parsed !== 'object') throw new SenderError('review must be completed by auditor with a verdict');
      const review = parsed as { verdict?: unknown; reason?: unknown; flag_kind?: unknown };
      if ((review.verdict !== 'agree' && review.verdict !== 'disagree') || typeof review.reason !== 'string') throw new SenderError('invalid review result');
      const reason = freeText(review.reason, 500, 'review reason', 1);
      const flagKind = review.flag_kind === 'load_imbalance' ? 'load_imbalance' : 'proposal_disagree';
      logEvent(ctx, 'review_verdict', 'agent_task', task.id, `review ${review.verdict}: ${reason}`);
      if (review.verdict === 'disagree') {
        const payload = JSON.parse(task.payload_json) as { assignment_id?: string };
        const flag = ctx.db.audit_flag.insert({ id: 0n, run_id: activeRunId(ctx), kind: { tag: flagKind }, entity: 'assignment', entity_id: BigInt(payload.assignment_id ?? '0'), message: reason, suggested_action: undefined, status: { tag: 'open' }, filed_by: 'auditor', created_at: ctx.timestamp, updated_at: ctx.timestamp });
        logEvent(ctx, 'audit_flag', 'audit_flag', flag.id, reason, created(flag));
      }
    }
    const row = { ...task, status: args.status, result_json: args.result_json, lease_expires_at: undefined, updated_at: ctx.timestamp }; ctx.db.agent_task.id.update(row); cancelLease(ctx, 'agent_task', task.id);
    logEvent(ctx, 'agent_task_done', 'agent_task', task.id, `task ${task.id} ${args.status.tag}`, diff(task, row));
  }
);

export const report_detection = spacetimedb.reducer(
  { name: 'report_detection' },
  { robot_id: t.string(), mission_id: t.u64(), source: DetectionSource, client_ref: t.string(), lat: t.f64(), lon: t.f64(), gps_fix: t.bool(), location_note: t.string(), max_temp_c: t.option(t.f64()), thermal_confidence: t.f64(), thermal_image_url: t.option(t.string()), camera_image_url: t.option(t.string()), breathing_clip_url: t.option(t.string()), observed_at: t.option(t.timestamp()) },
  (ctx, args) => {
    requireRobot(ctx, args.robot_id); checkObservedAt(ctx, args.observed_at ?? undefined); checkLatLon(args.lat, args.lon); checkConfidence(args.thermal_confidence);
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(args.client_ref)) throw new SenderError('invalid client_ref');
    const location_note = freeText(args.location_note, 120, 'location_note');
    if (args.max_temp_c !== undefined) checkNumber(args.max_temp_c, -100, 200, 'max_temp_c');
    const thermal_image_url = checkUrl(args.thermal_image_url ?? undefined, 'thermal_image_url');
    const camera_image_url = checkUrl(args.camera_image_url ?? undefined, 'camera_image_url');
    const breathing_clip_url = checkUrl(args.breathing_clip_url ?? undefined, 'breathing_clip_url');
    const robotRow = ctx.db.robot.robot_id.find(args.robot_id); if (!robotRow) throw new SenderError('heartbeat first');
    if (args.mission_id !== 0n) { const m = ctx.db.mission.id.find(args.mission_id); if (!m || m.robot_id !== args.robot_id) throw new SenderError('mission does not belong to robot'); }
    const siteRow = siteForPoint(ctx, args.lat, args.lon);
    let chosen: Infer<typeof survivor.rowType> | undefined; let duplicateOf = 0n;
    if (args.thermal_confidence >= MIN_THERMAL_CONFIDENCE) {
      let near = Infinity; let duplicateDistance = Infinity;
      for (const s of ctx.db.survivor.site_id.filter(siteRow.id)) {
        if (s.status.tag === 'resolved') continue;
        const distance = haversineM(args.lat, args.lon, s.lat, s.lon);
        if (distance <= MERGE_RADIUS_M && distance < near) { chosen = s; near = distance; }
        else if (distance <= DUPLICATE_RADIUS_M && distance < duplicateDistance) { duplicateOf = s.id; duplicateDistance = distance; }
      }
    }
    let newSurvivor: Infer<typeof survivor.rowType> | undefined;
    if (args.thermal_confidence >= MIN_THERMAL_CONFIDENCE && !chosen) {
      const cell = cellForPoint(ctx, siteRow.id, args.lat, args.lon);
      newSurvivor = ctx.db.survivor.insert({ id: 0n, site_id: siteRow.id, cell_id: cell?.id ?? 0n, first_detection_id: 0n, lat: args.lat, lon: args.lon, location_note, house_label: cell?.label, breathing: { tag: 'unknown' }, breathing_rate_bpm: undefined, breathing_confidence: 0, visibility_pct: undefined, critical_level: { tag: 'unknown' }, critical_score: 0, score_confidence: 0, score_reasons: [], status: { tag: 'unassigned' }, resolution: undefined, resolved_by: undefined, possible_duplicate_of: duplicateOf, breathing_display_url: undefined, escalated_at: undefined, created_at: ctx.timestamp, updated_at: ctx.timestamp });
    }
    const linked = chosen?.id ?? newSurvivor?.id ?? 0n;
    let chain_id = linked === 0n ? 0n : chainFor(ctx, linked);
    if (newSurvivor) { let lastEventId = 0n; for (const e of ctx.db.event_log.iter()) if (e.id > lastEventId) lastEventId = e.id; chain_id = lastEventId + 1n; }
    const d = ctx.db.detection.insert({ id: 0n, run_id: activeRunId(ctx), chain_id, robot_id: args.robot_id, mission_id: args.mission_id, source: args.source, survivor_id: linked, client_ref: args.client_ref, lat: args.lat, lon: args.lon, gps_fix: args.gps_fix, location_note, max_temp_c: args.max_temp_c, thermal_confidence: args.thermal_confidence, thermal_image_url, camera_image_url, breathing_clip_url, created_at: args.observed_at ?? ctx.timestamp });
    if (newSurvivor) {
      const withDetection = { ...newSurvivor, first_detection_id: d.id }; ctx.db.survivor.id.update(withDetection);
      const event = logEvent(ctx, 'survivor_created', 'survivor', newSurvivor.id, `survivor ${newSurvivor.id} found`, created(withDetection), args.observed_at ?? undefined);
      if (event.id !== chain_id) throw new SenderError('event sequence changed during detection');
      ctx.db.survivor_chain.insert({ survivor_id: newSurvivor.id, chain_id: event.id });
      if (duplicateOf !== 0n) logEvent(ctx, 'possible_duplicate', 'survivor', newSurvivor.id, `possible duplicate of survivor ${duplicateOf}`, { before: {}, after: { possible_duplicate_of: duplicateOf.toString() } }, args.observed_at ?? undefined);
      if (newSurvivor.cell_id !== 0n) recomputeCell(ctx, newSurvivor.cell_id);
    } else if (chosen) {
      let row = chosen;
      const first = ctx.db.detection.id.find(chosen.first_detection_id);
      if (!first?.gps_fix && args.gps_fix) row = { ...row, lat: args.lat, lon: args.lon };
      if (location_note) row = { ...row, location_note };
      row = { ...row, updated_at: ctx.timestamp }; ctx.db.survivor.id.update(row);
      logEvent(ctx, 'survivor_merged', 'survivor', row.id, `detection merged into survivor ${row.id}`, diff(chosen, row), args.observed_at ?? undefined);
    }
  }
);

export const create_mission = spacetimedb.reducer(
  { name: 'create_mission' },
  { robot_id: t.string(), kind: MissionKind, target_cell_ids: t.array(t.u64()), target_lat: t.option(t.f64()), target_lon: t.option(t.f64()), reason: t.string(), chain_id: t.u64() },
  (ctx, args) => {
    const p = callerParticipant(ctx); if (!p) throw new SenderError('not registered');
    const agent = p.role.tag === 'agent' && p.name === 'orchestrator';
    if (!agent && p.role.tag !== 'coordinator' && p.role.tag !== 'commander' && !(p.role.tag === 'sim' && isDemo(ctx))) throw new SenderError('not allowed to create mission');
    const reason = freeText(args.reason, 200, 'reason', 1); let kind = args.kind;
    if (kind.tag === 'teleop') throw new SenderError('use take_over to drive a robot');
    if (kind.tag === 'search_cells') {
      if (args.target_cell_ids.length < 1 || args.target_cell_ids.length > 50) throw new SenderError('search_cells needs 1 to 50 cells');
      let hasSearchableCell = false;
      for (const id of args.target_cell_ids) { const cell = ctx.db.search_cell.id.find(id); if (!cell) throw new SenderError('cell not found'); if (cell.status.tag !== 'searched') hasSearchableCell = true; }
      if (!hasSearchableCell) throw new SenderError('search_cells needs an unsearched or partially searched cell');
    }
    let lat = args.target_lat; let lon = args.target_lon;
    if (kind.tag === 'inspect' && (lat === undefined || lon === undefined)) throw new SenderError('inspect needs a target point');
    if (kind.tag === 'return_home' && (lat === undefined || lon === undefined)) { const s = activeSite(ctx); if (!s) throw new SenderError('no site'); lat = s.center_lat; lon = s.center_lon; }
    if (kind.tag === 'hold' && (args.target_cell_ids.length > 0 || lat !== undefined || lon !== undefined)) throw new SenderError('hold has no target');
    if (lat !== undefined && lon !== undefined) checkLatLon(lat, lon);
    const siteRow = activeSite(ctx); if (!siteRow) throw new SenderError('no site');
    if (agent && kind.tag !== 'hold' && [...ctx.db.mission.iter()].filter(m => m.created_by === p.name && m.status.tag === 'proposed').length >= MAX_OPEN_AGENT_PROPOSALS) throw new SenderError('too many open proposals');
    const approval = agent && siteRow.require_mission_approval;
    const row = ctx.db.mission.insert({ id: 0n, chain_id: args.chain_id, robot_id: args.robot_id, kind, target_cell_ids: args.target_cell_ids, target_lat: lat, target_lon: lon, status: { tag: approval ? 'proposed' : 'queued' }, lease_expires_at: undefined, created_by: p.name, reason, created_at: ctx.timestamp, updated_at: ctx.timestamp });
    logEvent(ctx, 'mission_created', 'mission', row.id, `mission ${row.id} created`, created(row));
  }
);

export const approve_mission = spacetimedb.reducer({ name: 'approve_mission' }, { mission_id: t.u64() }, (ctx, { mission_id }) => {
  authorize(ctx, { roles: ['coordinator', 'commander'], human: true }); const m = ctx.db.mission.id.find(mission_id);
  if (!m || m.status.tag !== 'proposed') throw new SenderError('mission not proposed');
  const row = { ...m, status: { tag: 'queued' as const }, updated_at: ctx.timestamp }; ctx.db.mission.id.update(row); logEvent(ctx, 'mission_approved', 'mission', m.id, `mission ${m.id} approved`, diff(m, row));
});

export const cancel_mission = spacetimedb.reducer({ name: 'cancel_mission' }, { mission_id: t.u64() }, (ctx, { mission_id }) => {
  authorize(ctx, { roles: ['coordinator', 'commander'], human: true }); const m = ctx.db.mission.id.find(mission_id);
  if (!m || ['done', 'failed', 'cancelled'].includes(m.status.tag)) throw new SenderError('mission is final');
  cancelLease(ctx, 'mission', m.id); const row = { ...m, status: { tag: 'cancelled' as const }, lease_expires_at: undefined, updated_at: ctx.timestamp }; ctx.db.mission.id.update(row);
  const r = ctx.db.robot.robot_id.find(m.robot_id); if (r?.current_mission_id === m.id) ctx.db.robot.robot_id.update({ ...r, current_mission_id: undefined });
  reopenMissionCells(ctx, m); deleteTeleopRow(ctx, m);
  logEvent(ctx, 'mission_cancelled', 'mission', m.id, m.kind.tag === 'teleop' ? `remote control of ${m.robot_id} handed back` : `mission ${m.id} cancelled`, diff(m, row));
});

export const cancel_own_mission = spacetimedb.reducer({ name: 'cancel_own_mission' }, { mission_id: t.u64() }, (ctx, { mission_id }) => {
  const p = authorize(ctx, { agents: ['orchestrator'] }); const m = ctx.db.mission.id.find(mission_id);
  if (!m || m.created_by !== p.name || (m.status.tag !== 'proposed' && m.status.tag !== 'queued')) throw new SenderError('cannot cancel mission');
  const row = { ...m, status: { tag: 'cancelled' as const }, updated_at: ctx.timestamp }; ctx.db.mission.id.update(row);
  logEvent(ctx, 'mission_cancelled', 'mission', m.id, `mission ${m.id} cancelled by ${p.name}`, diff(m, row));
});

function reopenMissionCells(ctx: Ctx, m: Infer<typeof mission.rowType>): void {
  for (const id of m.target_cell_ids) {
    const c = ctx.db.search_cell.id.find(id); if (!c || c.status.tag !== 'searching') continue;
    const row = { ...c, status: { tag: 'unsearched' as const }, searched_by: undefined, updated_at: ctx.timestamp }; ctx.db.search_cell.id.update(row);
    logEvent(ctx, 'cell_status', 'search_cell', c.id, `cell ${c.id} reopened`, diff(c, row));
  }
}

export const claim_next_mission = spacetimedb.reducer({ name: 'claim_next_mission' }, { robot_id: t.string() }, (ctx, { robot_id }) => {
  requireRobot(ctx, robot_id); const r = ctx.db.robot.robot_id.find(robot_id); if (!r) throw new SenderError('heartbeat first');
  if (r.current_mission_id !== undefined) {
    const active = ctx.db.mission.id.find(r.current_mission_id);
    if (active && (active.status.tag === 'leased' || active.status.tag === 'active')) {
      const due = addSeconds(ctx, siteTimings(ctx).mission_lease_s); ctx.db.mission.id.update({ ...active, lease_expires_at: new Timestamp(due), updated_at: ctx.timestamp }); setLease(ctx, 'mission', active.id, due); return;
    }
  }
  const queued = [...ctx.db.mission.iter()].filter(m => m.status.tag === 'queued' && (m.robot_id === '' || m.robot_id === robot_id));
  // A person taking a robot over comes before any search; then unaccounted cells first, then oldest.
  queued.sort((a, b) => Number(b.kind.tag === 'teleop') - Number(a.kind.tag === 'teleop') || Number(b.target_cell_ids.some(id => (ctx.db.search_cell.id.find(id)?.unaccounted ?? 0) > 0)) - Number(a.target_cell_ids.some(id => (ctx.db.search_cell.id.find(id)?.unaccounted ?? 0) > 0)) || Number(a.id - b.id));
  const m = queued[0]; if (!m) return;
  const due = addSeconds(ctx, siteTimings(ctx).mission_lease_s); const row = { ...m, robot_id, status: { tag: 'leased' as const }, lease_expires_at: new Timestamp(due), updated_at: ctx.timestamp }; ctx.db.mission.id.update(row);
  ctx.db.robot.robot_id.update({ ...r, current_mission_id: m.id }); setLease(ctx, 'mission', m.id, due);
  for (const id of m.target_cell_ids) { const c = ctx.db.search_cell.id.find(id); if (c && (c.status.tag === 'unsearched' || c.status.tag === 'partially_searched')) ctx.db.search_cell.id.update({ ...c, status: { tag: 'searching' }, searched_by: robot_id, updated_at: ctx.timestamp }); }
  logEvent(ctx, 'mission_leased', 'mission', m.id, `mission ${m.id} leased to ${robot_id}`, diff(m, row));
});

export const mission_progress = spacetimedb.reducer({ name: 'mission_progress' }, { mission_id: t.u64(), status: MissionStatus, note: t.string(), observed_at: t.option(t.timestamp()) }, (ctx, args) => {
  checkObservedAt(ctx, args.observed_at ?? undefined); const m = ctx.db.mission.id.find(args.mission_id); if (!m) throw new SenderError('mission not found'); requireRobot(ctx, m.robot_id);
  if (!['active', 'done', 'failed'].includes(args.status.tag) || !['leased', 'active'].includes(m.status.tag)) throw new SenderError('invalid mission progress');
  freeText(args.note, 500, 'note');
  if (args.status.tag === 'active') { const due = addSeconds(ctx, siteTimings(ctx).mission_lease_s); const row = { ...m, status: args.status, lease_expires_at: new Timestamp(due), updated_at: ctx.timestamp }; ctx.db.mission.id.update(row); setLease(ctx, 'mission', m.id, due); return; }
  cancelLease(ctx, 'mission', m.id); const row = { ...m, status: args.status, lease_expires_at: undefined, updated_at: ctx.timestamp }; ctx.db.mission.id.update(row);
  const r = ctx.db.robot.robot_id.find(m.robot_id); if (r?.current_mission_id === m.id) ctx.db.robot.robot_id.update({ ...r, current_mission_id: undefined }); reopenMissionCells(ctx, m); deleteTeleopRow(ctx, m);
  logEvent(ctx, args.status.tag === 'done' ? 'mission_done' : 'mission_failed', 'mission', m.id, args.note, diff(m, row), args.observed_at ?? undefined);
});

// Remote driving (docs/specs/robot.md section 18.1). A person at the dashboard takes a robot over, drives it, and
// hands it back with cancel_mission. take_over puts the robot's running mission back in its queue (the bridge then
// cancels it on the robot, and it resumes after the hand back) and queues a teleop mission that claim_next_mission
// hands out first. The robot stops by itself 300 ms after the last teleop row update. Agents can never drive.
function openTeleop(ctx: Ctx, robot_id: string): Infer<typeof mission.rowType> | undefined {
  for (const m of ctx.db.mission.robot_id.filter(robot_id)) if (m.kind.tag === 'teleop' && ['queued', 'leased', 'active'].includes(m.status.tag)) return m;
  return undefined;
}

function deleteTeleopRow(ctx: Ctx, m: Infer<typeof mission.rowType>): void {
  if (m.kind.tag === 'teleop' && ctx.db.teleop.robot_id.find(m.robot_id)) ctx.db.teleop.robot_id.delete(m.robot_id);
}

// A teleop mission is never requeued: driving belongs to the person who took the robot over, so it just ends.
function endTeleop(ctx: Ctx, m: Infer<typeof mission.rowType>, why: string): void {
  cancelLease(ctx, 'mission', m.id); const row = { ...m, status: { tag: 'cancelled' as const }, lease_expires_at: undefined, updated_at: ctx.timestamp }; ctx.db.mission.id.update(row);
  const r = ctx.db.robot.robot_id.find(m.robot_id); if (r?.current_mission_id === m.id) ctx.db.robot.robot_id.update({ ...r, current_mission_id: undefined });
  deleteTeleopRow(ctx, m); logEvent(ctx, 'mission_cancelled', 'mission', m.id, `remote control of ${m.robot_id} ended: ${why}`, diff(m, row));
}

export const take_over = spacetimedb.reducer({ name: 'take_over' }, { robot_id: t.string(), reason: t.string() }, (ctx, args) => {
  const p = authorize(ctx, { roles: ['coordinator', 'commander'], human: true }); const reason = freeText(args.reason, 200, 'reason', 1);
  const r = ctx.db.robot.robot_id.find(args.robot_id); if (!r) throw new SenderError('robot not found'); if (!r.online) throw new SenderError(`${r.robot_id} is offline`);
  const open = openTeleop(ctx, r.robot_id); if (open) throw new SenderError(`${open.created_by} is already driving ${r.robot_id}`);
  for (const m of [...ctx.db.mission.robot_id.filter(r.robot_id)]) {
    if (m.status.tag !== 'leased' && m.status.tag !== 'active') continue;
    cancelLease(ctx, 'mission', m.id); const paused = { ...m, status: { tag: 'queued' as const }, lease_expires_at: undefined, updated_at: ctx.timestamp }; ctx.db.mission.id.update(paused);
    reopenMissionCells(ctx, m); logEvent(ctx, 'mission_requeued', 'mission', m.id, `mission ${m.id} paused: ${p.name} took over ${r.robot_id}`, diff(m, paused));
  }
  ctx.db.robot.robot_id.update({ ...r, current_mission_id: undefined });
  const row = ctx.db.mission.insert({ id: 0n, chain_id: 0n, robot_id: r.robot_id, kind: { tag: 'teleop' }, target_cell_ids: [], target_lat: undefined, target_lon: undefined, status: { tag: 'queued' }, lease_expires_at: undefined, created_by: p.name, reason, created_at: ctx.timestamp, updated_at: ctx.timestamp });
  const still = { robot_id: r.robot_id, vx_mps: 0, vy_mps: 0, wz_dps: 0, seq: 0n, sent_by: ctx.sender, sent_at: ctx.timestamp };
  if (ctx.db.teleop.robot_id.find(r.robot_id)) ctx.db.teleop.robot_id.update(still); else ctx.db.teleop.insert(still);
  logEvent(ctx, 'mission_created', 'mission', row.id, `${p.name} took over ${r.robot_id}`, created(row));
});

// One driving command, about 10 a second while a key is held. Not logged: the mission start and end are.
export const teleop_drive = spacetimedb.reducer({ name: 'teleop_drive' }, { robot_id: t.string(), vx_mps: t.f64(), vy_mps: t.f64(), wz_dps: t.f64(), seq: t.u64() }, (ctx, args) => {
  authorize(ctx, { roles: ['coordinator', 'commander'], human: true });
  const m = openTeleop(ctx, args.robot_id); if (!m) throw new SenderError(`${args.robot_id} is not under remote control`);
  if (m.status.tag === 'queued') throw new SenderError(`${args.robot_id} has not taken the remote control mission yet`);
  const prior = ctx.db.teleop.robot_id.find(args.robot_id); if (!prior || !prior.sent_by.isEqual(ctx.sender)) throw new SenderError(`${m.created_by} is driving ${args.robot_id}`);
  checkNumber(args.vx_mps, -TELEOP_MAX_LIN_MPS, TELEOP_MAX_LIN_MPS, 'vx_mps'); checkNumber(args.vy_mps, -TELEOP_MAX_LIN_MPS, TELEOP_MAX_LIN_MPS, 'vy_mps'); checkNumber(args.wz_dps, -TELEOP_MAX_TURN_DPS, TELEOP_MAX_TURN_DPS, 'wz_dps');
  ctx.db.teleop.robot_id.update({ ...prior, vx_mps: args.vx_mps, vy_mps: args.vy_mps, wz_dps: args.wz_dps, seq: args.seq, sent_at: ctx.timestamp });
});

export const rescuer_ask = spacetimedb.reducer({name:'rescuer_ask'},{text:t.string(),audio_url:t.option(t.string()),survivor_id:t.option(t.u64())},(ctx,args)=>{
  const p=authorize(ctx,{roles:['rescuer','coordinator','commander'],human:true}); const text=checkLen(args.text,1,300,'text'); const audio_url=checkUrl(args.audio_url??undefined,'audio_url');
  let s: Infer<typeof survivor.rowType> | null = null; if(args.survivor_id!==undefined){s=ctx.db.survivor.id.find(args.survivor_id);if(!s)throw new SenderError('survivor not found');}
  const question=logEvent(ctx,'rescuer_question','participant',0n,`${p.name} asked a question`);
  const payload={rescuer_identity:p.identity.toHexString(),rescuer_name:p.name,text,audio_url,survivor_id:s?.id.toString(),lat:p.lat,lon:p.lon,asked_at:ctx.timestamp.toISOString()};
  const task=ctx.db.agent_task.insert({id:0n,run_id:activeRunId(ctx),chain_id:s?chainFor(ctx,s.id):question.id,from_agent:p.name,to_agent:{tag:'comms_agent'},kind:'answer_rescuer',payload_json:JSON.stringify(payload),priority:{tag:s?.critical_level.tag==='immediate'?'critical':'high'},status:{tag:'open'},claimed_at:undefined,lease_expires_at:undefined,result_json:undefined,reason:'rescuer voice question',created_at:ctx.timestamp,updated_at:ctx.timestamp});
  logEvent(ctx,'agent_task_posted','agent_task',task.id,`answer task ${task.id} posted`,created(task));
});
