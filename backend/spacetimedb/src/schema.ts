// Tables, enums, and schedule tables for the rubble search module.
// Names and columns follow docs/specs/spacetimedb.md section 3 and 4 and docs/specs/CONTRACTS.md.
// CaseConversionPolicy.None keeps the contract spellings (SAFE_STOP, en_route) on the wire and in SQL.

import { schema, table, t, CaseConversionPolicy, type InferSchema, type ReducerCtx, type Infer } from 'spacetimedb/server';

// ---------------------------------------------------------------------------
// Enums (section 3). Variant names are the contract values, spelled exactly.
// ---------------------------------------------------------------------------

export const Role = t.enum('Role', {
  commander: t.unit(),
  coordinator: t.unit(),
  rescuer: t.unit(),
  robot: t.unit(),
  agent: t.unit(),
  auditor: t.unit(),
  perception: t.unit(),
  sim: t.unit(),
});
export const CellStatus = t.enum('CellStatus', {
  unsearched: t.unit(),
  searching: t.unit(),
  partially_searched: t.unit(),
  searched: t.unit(),
});
export const RobotState = t.enum('RobotState', {
  BOOT: t.unit(),
  INIT: t.unit(),
  READY: t.unit(),
  ACTIVE: t.unit(),
  SAFE_STOP: t.unit(),
  FAULT: t.unit(),
  SHUTDOWN: t.unit(),
});
export const DeviceHealth = t.enum('DeviceHealth', { OK: t.unit(), DEGRADED: t.unit(), FAILED: t.unit() });
export const MissionKind = t.enum('MissionKind', {
  search_cells: t.unit(),
  inspect: t.unit(),
  return_home: t.unit(),
  hold: t.unit(),
});
export const MissionStatus = t.enum('MissionStatus', {
  proposed: t.unit(),
  queued: t.unit(),
  leased: t.unit(),
  active: t.unit(),
  done: t.unit(),
  failed: t.unit(),
  cancelled: t.unit(),
});
export const DetectionSource = t.enum('DetectionSource', { thermal: t.unit(), camera: t.unit() });
export const Breathing = t.enum('Breathing', { detected: t.unit(), not_detected: t.unit(), unknown: t.unit() });
export const CriticalLevel = t.enum('CriticalLevel', {
  immediate: t.unit(),
  delayed: t.unit(),
  minor: t.unit(),
  unknown: t.unit(),
});
export const SurvivorStatus = t.enum('SurvivorStatus', {
  unassigned: t.unit(),
  assigned: t.unit(),
  en_route: t.unit(),
  reached: t.unit(),
  resolved: t.unit(),
});
export const Resolution = t.enum('Resolution', {
  rescued: t.unit(),
  handed_off: t.unit(),
  false_alarm: t.unit(),
  duplicate: t.unit(),
});
export const AssignmentStatus = t.enum('AssignmentStatus', {
  proposed: t.unit(),
  active: t.unit(),
  released: t.unit(),
  completed: t.unit(),
});
export const ReleaseCause = t.enum('ReleaseCause', {
  declined: t.unit(),
  expired: t.unit(),
  heartbeat: t.unit(),
  disconnected: t.unit(),
  reassigned: t.unit(),
});
export const BriefingPriority = t.enum('BriefingPriority', { info: t.unit(), warning: t.unit(), critical: t.unit() });
export const BriefingKind = t.enum('BriefingKind', {
  briefing: t.unit(),
  nav: t.unit(),
  nudge: t.unit(),
  answer: t.unit(),
  escalation: t.unit(),
});
export const AuditFlagKind = t.enum('AuditFlagKind', { proposal_disagree: t.unit(), load_imbalance: t.unit() });
export const AuditFlagStatus = t.enum('AuditFlagStatus', { open: t.unit(), acted: t.unit(), dismissed: t.unit() });
export const PersonReportKind = t.enum('PersonReportKind', { missing: t.unit(), safe: t.unit() });
export const PersonReportSource = t.enum('PersonReportSource', {
  family: t.unit(),
  neighbor: t.unit(),
  hotline: t.unit(),
  coordinator: t.unit(),
});
export const AgentName = t.enum('AgentName', { orchestrator: t.unit(), comms_agent: t.unit(), auditor: t.unit() });
export const TaskPriority = t.enum('TaskPriority', { critical: t.unit(), high: t.unit(), normal: t.unit() });
export const TaskStatus = t.enum('TaskStatus', {
  open: t.unit(),
  claimed: t.unit(),
  done: t.unit(),
  failed: t.unit(),
  expired: t.unit(),
});
export const TerrainClass = t.enum('TerrainClass', {
  flat: t.unit(),
  debris: t.unit(),
  step: t.unit(),
  gap: t.unit(),
  blocked: t.unit(),
  unknown: t.unit(),
});
export const TerrainAction = t.enum('TerrainAction', {
  continue: t.unit(),
  slow: t.unit(),
  steer: t.unit(),
  stop: t.unit(),
});
// Module-only enums for the schedule tables.
export const LeaseKind = t.enum('LeaseKind', {
  proposal: t.unit(),
  assignment: t.unit(),
  mission: t.unit(),
  agent_task: t.unit(),
});
export const HeartbeatKind = t.enum('HeartbeatKind', {
  rescuer: t.unit(),
  robot: t.unit(),
  disconnect_grace: t.unit(),
});

// ---------------------------------------------------------------------------
// Current-state tables (section 4.1)
// ---------------------------------------------------------------------------

export const participant = table(
  { name: 'participant', public: true },
  {
    identity: t.identity().primaryKey(),
    name: t.string().index('btree'),
    role: Role,
    lat: t.option(t.f64()),
    lon: t.option(t.f64()),
    online: t.bool(),
    last_heartbeat: t.timestamp(),
    last_seen: t.timestamp(),
  }
);

export const site = table(
  { name: 'site', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    name: t.string(),
    center_lat: t.f64(),
    center_lon: t.f64(),
    radius_m: t.f64(),
    demo_mode: t.bool(),
    require_mission_approval: t.bool(),
    mission_lease_s: t.u32(),
    assignment_lease_s: t.u32(),
    proposal_lease_s: t.u32(),
    escalate_after_s: t.u32(),
    created_at: t.timestamp(),
  }
);

export const search_cell = table(
  { name: 'search_cell', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    site_id: t.u64().index('btree'),
    lat: t.f64(),
    lon: t.f64(),
    size_m: t.f64(),
    label: t.string(),
    status: CellStatus,
    searched_by: t.option(t.string()),
    found: t.u32(),
    reported_missing: t.u32(),
    reported_safe: t.u32(),
    unaccounted: t.u32(),
    updated_at: t.timestamp(),
  }
);

export const robot = table(
  { name: 'robot', public: true },
  {
    robot_id: t.string().primaryKey(),
    name: t.string(),
    lat: t.option(t.f64()),
    lon: t.option(t.f64()),
    gps_fix: t.bool(),
    indoor_offset_m: t.option(t.f64()),
    heading_deg: t.option(t.f64()),
    battery_pct: t.option(t.f64()),
    state: RobotState,
    online: t.bool(),
    current_mission_id: t.option(t.u64()),
    last_heartbeat: t.timestamp(),
    terrain_class: TerrainClass,
    terrain_confidence: t.f64(),
    terrain_source: t.string(),
    terrain_action: TerrainAction,
  }
);

export const device_status = table(
  { name: 'device_status', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    robot_id: t.string().index('btree'),
    device: t.string(),
    status: DeviceHealth,
    detail: t.string(),
    updated_at: t.timestamp(),
  }
);

export const mission = table(
  { name: 'mission', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    chain_id: t.u64(),
    robot_id: t.string().index('btree'),
    kind: MissionKind,
    target_cell_ids: t.array(t.u64()),
    target_lat: t.option(t.f64()),
    target_lon: t.option(t.f64()),
    status: MissionStatus,
    lease_expires_at: t.option(t.timestamp()),
    created_by: t.string(),
    reason: t.string(),
    created_at: t.timestamp(),
    updated_at: t.timestamp(),
  }
);

export const survivor = table(
  { name: 'survivor', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    site_id: t.u64().index('btree'),
    cell_id: t.u64().index('btree'),
    first_detection_id: t.u64(),
    lat: t.f64(),
    lon: t.f64(),
    location_note: t.string(),
    house_label: t.option(t.string()),
    breathing: Breathing,
    breathing_rate_bpm: t.option(t.f64()),
    breathing_confidence: t.f64(),
    visibility_pct: t.option(t.f64()),
    critical_level: CriticalLevel.index('btree'),
    critical_score: t.f64(),
    score_confidence: t.f64(),
    score_reasons: t.array(t.string()),
    status: SurvivorStatus,
    resolution: t.option(Resolution),
    resolved_by: t.option(t.string()),
    possible_duplicate_of: t.u64(),
    breathing_display_url: t.option(t.string()),
    escalated_at: t.option(t.timestamp()),
    created_at: t.timestamp(),
    updated_at: t.timestamp(),
  }
);

export const assignment = table(
  { name: 'assignment', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    chain_id: t.u64(),
    survivor_id: t.u64().index('btree'),
    rescuer_identity: t.identity().index('btree'),
    status: AssignmentStatus,
    lease_expires_at: t.timestamp(),
    accepted_at: t.option(t.timestamp()),
    release_cause: t.option(ReleaseCause),
    created_by: t.string(),
    created_at: t.timestamp(),
    updated_at: t.timestamp(),
  }
);

export const audit_flag = table(
  { name: 'audit_flag', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    run_id: t.u64().index('btree'),
    kind: AuditFlagKind,
    entity: t.string(),
    entity_id: t.u64().index('btree'),
    message: t.string(),
    suggested_action: t.option(t.string()),
    status: AuditFlagStatus,
    filed_by: t.string(),
    created_at: t.timestamp(),
    updated_at: t.timestamp(),
  }
);

export const agent_task = table(
  { name: 'agent_task', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    run_id: t.u64().index('btree'),
    chain_id: t.u64().index('btree'),
    from_agent: t.string(),
    to_agent: AgentName.index('btree'),
    kind: t.string(),
    payload_json: t.string(),
    priority: TaskPriority,
    status: TaskStatus,
    claimed_at: t.option(t.timestamp()),
    lease_expires_at: t.option(t.timestamp()),
    result_json: t.option(t.string()),
    reason: t.string(),
    created_at: t.timestamp(),
    updated_at: t.timestamp(),
  }
);

export const run = table(
  { name: 'run', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    site_id: t.u64(),
    name: t.string(),
    started_at: t.timestamp(),
    ended_at: t.option(t.timestamp()),
    notes: t.string(),
  }
);

// ---------------------------------------------------------------------------
// History tables, append-only (section 4.2)
// ---------------------------------------------------------------------------

export const event_log = table(
  { name: 'event_log', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    run_id: t.u64().index('btree'),
    kind: t.string(),
    entity: t.string(),
    entity_id: t.u64().index('btree'),
    message: t.string(),
    payload_json: t.string(),
    created_at: t.timestamp(),
  }
);

export const detection = table(
  { name: 'detection', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    run_id: t.u64().index('btree'),
    chain_id: t.u64(),
    robot_id: t.string(),
    mission_id: t.u64(),
    source: DetectionSource,
    survivor_id: t.u64().index('btree'),
    client_ref: t.string().index('btree'),
    lat: t.f64(),
    lon: t.f64(),
    gps_fix: t.bool(),
    location_note: t.string(),
    max_temp_c: t.option(t.f64()),
    thermal_confidence: t.f64(),
    thermal_image_url: t.option(t.string()),
    camera_image_url: t.option(t.string()),
    breathing_clip_url: t.option(t.string()),
    created_at: t.timestamp(),
  }
);

export const briefing = table(
  { name: 'briefing', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    run_id: t.u64().index('btree'),
    chain_id: t.u64(),
    audience: t.string().index('btree'),
    text: t.string(),
    priority: BriefingPriority,
    kind: t.option(BriefingKind),
    survivor_id: t.option(t.u64()),
    created_by: t.string(),
    created_at: t.timestamp(),
  }
);

export const agent_action = table(
  { name: 'agent_action', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    run_id: t.u64().index('btree'),
    chain_id: t.u64().index('btree'),
    agent: t.string(),
    step: t.u32(),
    model: t.string(),
    tool: t.string(),
    args_json: t.string(),
    result: t.string(),
    reason: t.string(),
    created_at: t.timestamp(),
  }
);

export const person_report = table(
  { name: 'person_report', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    run_id: t.u64().index('btree'),
    cell_id: t.u64().index('btree'),
    kind: PersonReportKind,
    count: t.u32(),
    name_or_unit: t.option(t.string()),
    note: t.string(),
    source: PersonReportSource,
    reported_by: t.string(),
    created_at: t.timestamp(),
  }
);

// ---------------------------------------------------------------------------
// Schedule tables (section 4.3). Public so the dashboard can show countdowns.
// Each one-shot row has due_at equal to its scheduled_at time.
// The reducers that fire them are bound in index.ts with { onSchedule: table }.
// ---------------------------------------------------------------------------

export const lease_timer = table(
  { name: 'lease_timer', public: true },
  {
    scheduled_id: t.u64().primaryKey().autoInc(),
    scheduled_at: t.scheduleAt(),
    kind: LeaseKind,
    entity_id: t.u64().index('btree'),
    due_at: t.timestamp(),
  }
);

export const heartbeat_timer = table(
  { name: 'heartbeat_timer', public: true },
  {
    scheduled_id: t.u64().primaryKey().autoInc(),
    scheduled_at: t.scheduleAt(),
    kind: HeartbeatKind,
    identity: t.identity().index('btree'),
    robot_id: t.string(),
    due_at: t.timestamp(),
  }
);

export const escalation_timer = table(
  { name: 'escalation_timer', public: true },
  {
    scheduled_id: t.u64().primaryKey().autoInc(),
    scheduled_at: t.scheduleAt(),
    survivor_id: t.u64().index('btree'),
    level: t.u32(),
    since: t.timestamp(),
    due_at: t.timestamp(),
  }
);

export const agent_watchdog = table(
  { name: 'agent_watchdog', public: true },
  {
    scheduled_id: t.u64().primaryKey().autoInc(),
    scheduled_at: t.scheduleAt(),
    agent_name: t.string().index('btree'),
    last_seen: t.timestamp(),
    due_at: t.timestamp(),
  }
);

// Private interval timer for the 10 s safety sweep (section 7.5).
export const sweep_timer = table(
  { name: 'sweep_timer' },
  {
    scheduled_id: t.u64().primaryKey().autoInc(),
    scheduled_at: t.scheduleAt(),
  }
);

// ---------------------------------------------------------------------------
// Private module tables (section 4.4)
// ---------------------------------------------------------------------------

export const role_grant = table(
  { name: 'role_grant' },
  {
    identity: t.identity().primaryKey(),
    role: Role,
    granted_by: t.string(),
  }
);

// One row per open client connection (WebSocket or a single HTTP request).
// The spec describes a per-identity counter; per-connection rows also record when each
// connection opened, which lets the module tell a short HTTP request from a real session
// (see lib/presence.ts and the README).
export const presence = table(
  { name: 'presence' },
  {
    connection_id: t.string().primaryKey(),
    identity: t.identity().index('btree'),
    connected_at: t.timestamp(),
  }
);

export const task_attempts = table(
  { name: 'task_attempts' },
  {
    task_id: t.u64().primaryKey(),
    attempts: t.u32(),
  }
);

export const survivor_chain = table(
  { name: 'survivor_chain' },
  {
    survivor_id: t.u64().primaryKey(),
    chain_id: t.u64(),
  }
);

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const spacetimedb = schema(
  {
    participant,
    site,
    search_cell,
    robot,
    device_status,
    mission,
    survivor,
    assignment,
    audit_flag,
    agent_task,
    run,
    event_log,
    detection,
    briefing,
    agent_action,
    person_report,
    lease_timer,
    heartbeat_timer,
    escalation_timer,
    agent_watchdog,
    sweep_timer,
    role_grant,
    presence,
    task_attempts,
    survivor_chain,
  },
  // Keep contract spellings on the wire (tested on 2.14.1).
  { CASE_CONVERSION_POLICY: CaseConversionPolicy.None }
);
export default spacetimedb;

// Types shared by the helpers in lib/.
export type Ctx = ReducerCtx<InferSchema<typeof spacetimedb>>;
export type ParticipantRow = Infer<typeof participant.rowType>;
export type SiteRow = Infer<typeof site.rowType>;
export type CellRow = Infer<typeof search_cell.rowType>;
export type RobotRow = Infer<typeof robot.rowType>;
export type MissionRow = Infer<typeof mission.rowType>;
export type SurvivorRow = Infer<typeof survivor.rowType>;
export type AssignmentRow = Infer<typeof assignment.rowType>;
export type AgentTaskRow = Infer<typeof agent_task.rowType>;
export type RoleTag = Infer<typeof Role>['tag'];
export type SurvivorStatusTag = Infer<typeof SurvivorStatus>['tag'];
export type ReleaseCauseTag = Infer<typeof ReleaseCause>['tag'];
export type LeaseKindTag = Infer<typeof LeaseKind>['tag'];
export type HeartbeatKindTag = Infer<typeof HeartbeatKind>['tag'];
export type BriefingPriorityTag = Infer<typeof BriefingPriority>['tag'];
export type BriefingKindTag = Infer<typeof BriefingKind>['tag'];
