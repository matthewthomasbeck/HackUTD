// Plain snake_case rows, as the contract names them (docs/specs/CONTRACTS.md).
// stdb/convert.ts turns live binding rows into these shapes; the fake store holds them directly.
// Ids are numbers (they stay below 2^53), identities are 64-char lowercase hex, times are epoch ms.

export type AgentName = "orchestrator" | "comms_agent" | "auditor";
export const AGENT_ORDER: AgentName[] = ["orchestrator", "comms_agent", "auditor"];

export type Role =
  | "commander"
  | "coordinator"
  | "rescuer"
  | "robot"
  | "agent"
  | "auditor"
  | "perception"
  | "sim";
export type TaskPriority = "critical" | "high" | "normal";
export type TaskStatus = "open" | "claimed" | "done" | "failed" | "expired";
export type CriticalLevel = "immediate" | "delayed" | "minor" | "unknown";
export type Breathing = "detected" | "not_detected" | "unknown";
export type SurvivorStatus = "unassigned" | "assigned" | "en_route" | "reached" | "resolved";
export type AssignmentStatus = "proposed" | "active" | "released" | "completed";
export type CellStatus = "unsearched" | "searching" | "partially_searched" | "searched";
export type MissionKind = "search_cells" | "inspect" | "return_home" | "hold";
export type MissionStatus = "proposed" | "queued" | "leased" | "active" | "done" | "failed" | "cancelled";
export type BriefingPriority = "info" | "warning" | "critical";
export type BriefingKind = "briefing" | "nav" | "nudge" | "answer" | "escalation";
export type AuditFlagKind = "proposal_disagree" | "load_imbalance";
export type AuditFlagStatus = "open" | "acted" | "dismissed";

export interface Participant {
  identity: string;
  name: string;
  role: Role;
  lat: number | null;
  lon: number | null;
  online: boolean;
  last_heartbeat: number;
  last_seen: number;
}

export interface Site {
  id: number;
  name: string;
  center_lat: number;
  center_lon: number;
  radius_m: number;
  demo_mode: boolean;
  require_mission_approval: boolean;
  mission_lease_s: number;
  assignment_lease_s: number;
  proposal_lease_s: number;
  escalate_after_s: number;
  created_at: number;
}

export interface Run {
  id: number;
  site_id: number;
  name: string;
  started_at: number;
  ended_at: number | null;
  notes: string;
}

export interface SearchCell {
  id: number;
  site_id: number;
  lat: number;
  lon: number;
  size_m: number;
  label: string;
  status: CellStatus;
  searched_by: string | null;
  found: number;
  reported_missing: number;
  reported_safe: number;
  unaccounted: number;
  updated_at: number;
}

export interface Robot {
  robot_id: string;
  name: string;
  lat: number | null;
  lon: number | null;
  gps_fix: boolean;
  indoor_offset_m: number | null;
  heading_deg: number | null;
  battery_pct: number | null;
  state: string;
  online: boolean;
  current_mission_id: number | null;
  last_heartbeat: number;
  terrain_class: string;
  terrain_confidence: number;
  terrain_source: string;
  terrain_action: string;
}

export interface DeviceStatus {
  id: number;
  robot_id: string;
  device: string;
  status: "OK" | "DEGRADED" | "FAILED";
  detail: string;
  updated_at: number;
}

export interface Mission {
  id: number;
  chain_id: number;
  robot_id: string;
  kind: MissionKind;
  target_cell_ids: number[];
  target_lat: number | null;
  target_lon: number | null;
  status: MissionStatus;
  lease_expires_at: number | null;
  created_by: string;
  reason: string;
  created_at: number;
  updated_at: number;
}

export interface Detection {
  id: number;
  run_id: number;
  chain_id: number;
  robot_id: string;
  mission_id: number;
  source: "thermal" | "camera";
  survivor_id: number;
  client_ref: string;
  lat: number;
  lon: number;
  gps_fix: boolean;
  location_note: string;
  max_temp_c: number | null;
  thermal_confidence: number;
  thermal_image_url: string | null;
  camera_image_url: string | null;
  breathing_clip_url: string | null;
  created_at: number;
}

export interface Survivor {
  id: number;
  site_id: number;
  cell_id: number;
  first_detection_id: number;
  lat: number;
  lon: number;
  location_note: string;
  house_label: string | null;
  breathing: Breathing;
  breathing_rate_bpm: number | null;
  breathing_confidence: number;
  visibility_pct: number | null;
  critical_level: CriticalLevel;
  critical_score: number;
  score_confidence: number;
  score_reasons: string[];
  status: SurvivorStatus;
  resolution: string | null;
  resolved_by: string | null;
  possible_duplicate_of: number;
  breathing_display_url: string | null;
  escalated_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface Assignment {
  id: number;
  chain_id: number;
  survivor_id: number;
  rescuer_identity: string;
  status: AssignmentStatus;
  lease_expires_at: number | null;
  accepted_at: number | null;
  release_cause: string | null;
  created_by: string;
  created_at: number;
  updated_at: number;
}

export interface Briefing {
  id: number;
  run_id: number;
  chain_id: number;
  audience: string;
  text: string;
  priority: BriefingPriority;
  kind: BriefingKind | null;
  survivor_id: number | null;
  created_by: string;
  created_at: number;
}

export interface AgentAction {
  id: number;
  run_id: number;
  chain_id: number;
  agent: string;
  step: number;
  model: string;
  tool: string;
  args_json: string;
  result: string;
  reason: string;
  created_at: number;
}

export interface EventLog {
  id: number;
  run_id: number;
  kind: string;
  entity: string;
  entity_id: number;
  message: string;
  payload_json: string;
  created_at: number;
}

export interface AuditFlag {
  id: number;
  run_id: number;
  kind: AuditFlagKind;
  entity: string;
  entity_id: number;
  message: string;
  suggested_action: string | null;
  status: AuditFlagStatus;
  filed_by: string;
  created_at: number;
  updated_at: number;
}

export interface PersonReport {
  id: number;
  run_id: number;
  cell_id: number;
  kind: "missing" | "safe";
  count: number;
  name_or_unit: string | null;
  note: string;
  source: string;
  reported_by: string;
  created_at: number;
}

export interface AgentTask {
  id: number;
  run_id: number;
  chain_id: number;
  from_agent: string;
  to_agent: AgentName;
  kind: string;
  payload_json: string;
  priority: TaskPriority;
  status: TaskStatus;
  claimed_at: number | null;
  lease_expires_at: number | null;
  result_json: string | null;
  reason: string;
  created_at: number;
  updated_at: number;
}

/** Every table the agents read, by contract name. */
export interface TableRows {
  participant: Participant;
  site: Site;
  run: Run;
  search_cell: SearchCell;
  robot: Robot;
  device_status: DeviceStatus;
  mission: Mission;
  detection: Detection;
  survivor: Survivor;
  assignment: Assignment;
  briefing: Briefing;
  agent_action: AgentAction;
  event_log: EventLog;
  audit_flag: AuditFlag;
  person_report: PersonReport;
  agent_task: AgentTask;
}
export type TableName = keyof TableRows;
export const TABLE_NAMES: TableName[] = [
  "participant",
  "site",
  "run",
  "search_cell",
  "robot",
  "device_status",
  "mission",
  "detection",
  "survivor",
  "assignment",
  "briefing",
  "agent_action",
  "event_log",
  "audit_flag",
  "person_report",
  "agent_task",
];

/** Primary key column per table (contract: `id`, except robot and participant). */
export function primaryKey(table: TableName): string {
  if (table === "participant") return "identity";
  if (table === "robot") return "robot_id";
  return "id";
}

export interface Change<T extends TableName = TableName> {
  table: T;
  op: "insert" | "update" | "delete";
  row: TableRows[T];
  old?: TableRows[T];
}

/** Read access to current rows. Implemented by the live cache and by the fake store. */
export interface TableSource {
  rows<T extends TableName>(table: T): TableRows[T][];
  /** Subscribe to row changes after the initial load; returns an unsubscribe function. */
  onChange(cb: (c: Change) => void): () => void;
}
