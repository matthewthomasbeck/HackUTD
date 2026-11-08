// FakeModule: an in-process stand-in for the SpacetimeDB module, emulating only the behavior the
// agents and the scenarios rely on (spacetimedb.md sections 7 and 8): role checks for agents,
// propose_assignment creating the review task, the agent watchdog fallback, proposal and task
// leases, rescuer heartbeat loss, escalation briefings, the review verdict filing the audit flag,
// the briefing rate limit, and the per-cell counts. It is not the module; the live scenarios
// (scripts/scenario.ts --live) check the real one.

import { createHash } from "node:crypto";
import type { Actions } from "../actions.ts";
import type { Clock, TimerHandle } from "../clock.ts";
import { haversineM } from "../geo.ts";
import type {
  AgentName,
  AgentTask,
  Assignment,
  AuditFlagStatus,
  BriefingKind,
  BriefingPriority,
  CriticalLevel,
  Breathing,
  MissionKind,
  Participant,
  Role,
  SearchCell,
  Site,
  TaskPriority,
} from "../types.ts";
import type { MutableSource } from "./store.ts";

export function hexId(seed: string): string {
  return createHash("sha256").update(seed).digest("hex");
}

/** spacetimedb.md FORBIDDEN_PATTERN. */
const FORBIDDEN = /\b(dead|deceased|deceas\w*|expectant|corpse)\b|body recovery/i;
const AGENT_NAMES = ["orchestrator", "comms_agent", "auditor"];
export const MODULE = "module";

export interface FakeModuleOptions {
  /** Run the timers (leases, watchdog, heartbeats, escalation). Off for the DRY_RUN shadow. */
  timers?: boolean;
  tickMs?: number;
  /** Post the review task inside propose_assignment (spacetimedb.md 8.6). Off tests the runner's 2 s fallback. */
  reviewInPropose?: boolean;
}

export interface CallRecord {
  at: number;
  caller: string;
  reducer: string;
  args: unknown[];
  error?: string;
}

export class FakeModule {
  readonly calls: CallRecord[] = [];
  private tickHandle: TimerHandle | null = null;
  private watchdogDue = 0;
  private alive = new Set<string>();
  private lastSimBeat = 0;
  private taskAttempts = new Map<number, number>();
  private unattendedSince = new Map<number, number>();
  private escalated = new Map<number, number>();
  private opts: Required<FakeModuleOptions>;
  /** Set true by the scenario to simulate the orchestrator process being killed, for logging only. */
  watchdogFires = 0;

  constructor(
    readonly db: MutableSource,
    readonly clock: Clock,
    opts: FakeModuleOptions = {},
  ) {
    this.opts = { timers: true, tickMs: 500, reviewInPropose: true, ...opts };
  }

  start(): void {
    if (!this.opts.timers || this.tickHandle != null) return;
    const loop = () => {
      this.tickHandle = this.clock.setTimeout(() => {
        try {
          this.tick();
        } catch (err) {
          console.error("[fake module] tick failed:", (err as Error).message);
        }
        loop();
      }, this.opts.tickMs);
    };
    loop();
  }

  stop(): void {
    if (this.tickHandle != null) this.clock.clearTimeout(this.tickHandle);
    this.tickHandle = null;
  }

  // ---------- helpers ----------

  private now(): number {
    return this.clock.now();
  }
  site(): Site | null {
    const run = this.activeRun();
    const sites = this.db.rows("site");
    return (run ? sites.find((s) => s.id === run.site_id) : sites[0]) ?? null;
  }
  activeRun() {
    return this.db.rows("run").find((r) => r.ended_at == null) ?? null;
  }
  private runId(): number {
    return this.activeRun()?.id ?? 0;
  }
  private participant(identity: string): Participant | null {
    return this.db.get("participant", identity.toLowerCase());
  }
  private nameOf(identity: string): string {
    if (identity === MODULE) return MODULE;
    return this.participant(identity)?.name ?? "unknown";
  }
  private roleOf(identity: string): Role | null {
    return this.participant(identity)?.role ?? null;
  }
  private watchdogS(): number {
    return this.site()?.demo_mode ? 15 : 30;
  }
  event(kind: string, entity: string, entityId: number, message: string, payload: Record<string, unknown> = {}) {
    return this.db.insert("event_log", {
      run_id: this.runId(),
      kind,
      entity,
      entity_id: entityId,
      message,
      payload_json: JSON.stringify(payload),
      created_at: this.now(),
    });
  }
  survivorChain(sid: number): number {
    return this.db.rows("event_log").find((e) => e.kind === "survivor_created" && e.entity_id === sid)?.id ?? 0;
  }
  private checkText(...texts: string[]): void {
    for (const t of texts) if (FORBIDDEN.test(t)) throw new Error("text contains a forbidden word");
  }
  private record<T>(caller: string, reducer: string, args: unknown[], fn: () => T): T {
    const rec: CallRecord = { at: this.now(), caller: this.nameOf(caller), reducer, args };
    this.calls.push(rec);
    try {
      return fn();
    } catch (err) {
      rec.error = (err as Error).message;
      throw err;
    }
  }

  actionsFor(identity: string): Actions {
    return new FakeActions(this, identity);
  }

  // ---------- reducers the agents call ----------

  registerParticipant(caller: string, name: string, role: Role): void {
    this.record(caller, "register_participant", [name, role], () => {
      if (role === "agent" && !["orchestrator", "comms_agent"].includes(name)) throw new Error("unknown agent name");
      if (role === "auditor" && name !== "auditor") throw new Error("auditor name must be auditor");
      const holder = this.db.rows("participant").find((p) => p.name === name && p.online && p.identity !== caller);
      if (holder && (role === "agent" || role === "auditor")) throw new Error("name held by another online identity");
      const old = this.participant(caller);
      this.db.insert("participant", {
        identity: caller,
        name,
        role,
        lat: old?.lat ?? null,
        lon: old?.lon ?? null,
        online: true,
        last_heartbeat: this.now(),
        last_seen: this.now(),
      });
    });
  }

  agentHeartbeat(caller: string): void {
    this.record(caller, "agent_heartbeat", [], () => {
      const p = this.participant(caller);
      if (!p || (p.role !== "agent" && p.role !== "auditor")) throw new Error("not an agent");
      this.db.update("participant", { ...p, online: true, last_heartbeat: this.now(), last_seen: this.now() });
      if (p.name === "orchestrator") this.watchdogDue = this.now() + this.watchdogS() * 1000;
    });
  }

  postAgentTask(caller: string, to: AgentName, kind: string, payload: string, priority: TaskPriority, reason: string, chain: number): void {
    this.record(caller, "post_agent_task", [to, kind, payload, priority, reason, chain], () => {
      const from = this.nameOf(caller);
      if (caller !== MODULE && !AGENT_NAMES.includes(from)) throw new Error("caller is not an agent");
      if (to === from) throw new Error("cannot post to yourself");
      this.checkText(payload, reason);
      const t = this.db.insert("agent_task", {
        run_id: this.runId(),
        chain_id: chain,
        from_agent: from,
        to_agent: to,
        kind,
        payload_json: payload,
        priority,
        status: "open",
        claimed_at: null,
        lease_expires_at: null,
        result_json: null,
        reason,
        created_at: this.now(),
        updated_at: this.now(),
      });
      this.event("agent_task_posted", "agent_task", t.id, `${from} -> ${to}: ${kind}`);
    });
  }

  claimAgentTask(caller: string, id: number): void {
    this.record(caller, "claim_agent_task", [id], () => {
      const t = this.db.get("agent_task", id);
      if (!t) throw new Error("no such task");
      if (t.to_agent !== this.nameOf(caller)) throw new Error("not addressed to you");
      if (t.status !== "open") throw new Error("taken");
      this.db.update("agent_task", { ...t, status: "claimed", claimed_at: this.now(), lease_expires_at: this.now() + 30_000, updated_at: this.now() });
      this.event("agent_task_claimed", "agent_task", id, `${t.to_agent} claimed ${t.kind}`);
    });
  }

  completeAgentTask(caller: string, id: number, status: "done" | "failed", result: string): void {
    this.record(caller, "complete_agent_task", [id, status, result], () => {
      const t = this.db.get("agent_task", id);
      if (!t) throw new Error("no such task");
      if (t.to_agent !== this.nameOf(caller)) throw new Error("not addressed to you");
      if (t.status !== "claimed") throw new Error(`task is ${t.status}`);
      if (result.length > 2000) throw new Error("result_json too long");
      this.checkText(result);
      let verdict: Record<string, unknown> | null = null;
      // HEAD checks the verdict of a review task whatever the status.
      if (t.kind === "review") {
        verdict = JSON.parse(result);
        if (verdict!.verdict !== "agree" && verdict!.verdict !== "disagree") throw new Error("review result needs verdict agree or disagree");
        if (typeof verdict!.reason !== "string") throw new Error("review result needs a reason");
      }
      this.db.update("agent_task", { ...t, status, result_json: result, lease_expires_at: null, updated_at: this.now() });
      this.event("agent_task_done", "agent_task", id, `${t.kind} ${status}`);
      if (verdict) {
        this.event("review_verdict", "agent_task", id, String(verdict.verdict));
        if (verdict.verdict === "disagree") {
          const payload = JSON.parse(t.payload_json);
          const f = this.db.insert("audit_flag", {
            run_id: this.runId(),
            // HEAD keeps only load_imbalance from the verdict and drops suggested_action.
            kind: verdict.flag_kind === "load_imbalance" ? "load_imbalance" : "proposal_disagree",
            entity: "assignment",
            entity_id: Number(payload.assignment_id ?? 0),
            message: String(verdict.reason),
            suggested_action: null,
            status: "open",
            filed_by: "auditor",
            created_at: this.now(),
            updated_at: this.now(),
          });
          this.event("audit_flag", "audit_flag", f.id, `${f.kind}: ${f.message}`);
        }
      }
    });
  }

  logAgentAction(caller: string, tool: string, args: string, result: string, reason: string, step: number, model: string, chain: number): void {
    this.record(caller, "log_agent_action", [tool, args, result, reason, step, model, chain], () => {
      this.db.insert("agent_action", {
        run_id: this.runId(),
        chain_id: chain,
        agent: this.nameOf(caller),
        step,
        model,
        tool,
        args_json: args,
        result,
        reason,
        created_at: this.now(),
      });
    });
  }

  proposeAssignment(caller: string, sid: number, rescuer: string, reason: string): void {
    this.record(caller, "propose_assignment", [sid, rescuer, reason], () => this.propose(caller, sid, rescuer, reason));
  }

  private propose(caller: string, sid: number, rescuer: string, reason: string): Assignment {
    const name = this.nameOf(caller);
    const role = caller === MODULE ? null : this.roleOf(caller);
    if (!(caller === MODULE || name === "orchestrator" || role === "coordinator" || role === "commander" || role === "sim"))
      throw new Error("only the orchestrator may propose");
    this.checkText(reason);
    const s = this.db.get("survivor", sid);
    if (!s || s.status === "resolved") throw new Error("no such survivor");
    const hex = rescuer.toLowerCase();
    const r = this.participant(hex);
    if (!r || !["rescuer", "coordinator", "commander"].includes(r.role) || !r.online) throw new Error("rescuer not online");
    const open = this.db.rows("assignment").filter((a) => a.status === "proposed" || a.status === "active");
    if (open.some((a) => a.rescuer_identity === hex && a.status === "proposed")) throw new Error("rescuer has a pending proposal");
    if (open.some((a) => a.survivor_id === sid && a.status === "active")) throw new Error("already assigned");
    if (open.some((a) => a.survivor_id === sid && a.status === "proposed")) throw new Error("proposal pending");
    const site = this.site();
    const chain = this.survivorChain(sid);
    const a = this.db.insert("assignment", {
      chain_id: chain,
      survivor_id: sid,
      rescuer_identity: hex,
      status: "proposed",
      lease_expires_at: this.now() + (site?.proposal_lease_s ?? 60) * 1000,
      accepted_at: null,
      release_cause: null,
      created_by: name,
      created_at: this.now(),
      updated_at: this.now(),
    });
    this.event("assignment_proposed", "assignment", a.id, `${name} proposed ${r.name} for #${sid}: ${reason}`);
    if (this.opts.reviewInPropose && (name === "orchestrator" || caller === MODULE)) {
      // Same shape as HEAD's lib/state.ts createProposal: ids as decimal strings, distance to 0.1 m or null.
      const distance = r.lat != null && r.lon != null ? Math.round(haversineM(r.lat, r.lon, s.lat, s.lon) * 10) / 10 : null;
      const payload = JSON.stringify({ assignment_id: String(a.id), survivor_id: String(sid), rescuer_identity: hex, distance_m: distance, critical_level: s.critical_level, reason });
      const t = this.db.insert("agent_task", {
        run_id: this.runId(),
        chain_id: chain,
        from_agent: name,
        to_agent: "auditor",
        kind: "review",
        payload_json: payload,
        priority: s.critical_level === "immediate" ? "critical" : "high",
        status: "open",
        claimed_at: null,
        lease_expires_at: null,
        result_json: null,
        reason: `review proposal ${a.id}`,
        created_at: this.now(),
        updated_at: this.now(),
      });
      this.event("agent_task_posted", "agent_task", t.id, `${name} -> auditor: review`);
    }
    return a;
  }

  createMission(caller: string, robot: string, kind: MissionKind, cells: number[], lat: number | null, lon: number | null, reason: string, chain: number): void {
    this.record(caller, "create_mission", [robot, kind, cells, lat, lon, reason, chain], () => {
      const name = this.nameOf(caller);
      const role = this.roleOf(caller);
      if (name !== "orchestrator" && role !== "coordinator" && role !== "commander" && role !== "sim") throw new Error("not allowed");
      this.checkText(reason);
      if (kind === "search_cells") {
        if (cells.length < 1 || cells.length > 50) throw new Error("search_cells needs 1 to 50 cells");
        const rows = cells.map((id) => this.db.get("search_cell", id));
        if (rows.some((c) => !c)) throw new Error("unknown cell");
        if (rows.every((c) => c!.status === "searched")) throw new Error("all cells searched");
      }
      if (kind === "inspect" && (lat == null || lon == null)) throw new Error("inspect needs a target");
      const site = this.site();
      const isAgent = AGENT_NAMES.includes(name);
      if (isAgent && this.db.rows("mission").filter((m) => m.created_by === name && m.status === "proposed").length >= 5)
        throw new Error("too many proposed missions");
      const m = this.db.insert("mission", {
        chain_id: chain,
        robot_id: robot,
        kind,
        target_cell_ids: cells,
        target_lat: lat,
        target_lon: lon,
        status: isAgent && site?.require_mission_approval ? "proposed" : "queued",
        lease_expires_at: null,
        created_by: name,
        reason,
        created_at: this.now(),
        updated_at: this.now(),
      });
      this.event("mission_created", "mission", m.id, `${name}: ${kind} (${reason})`);
    });
  }

  cancelOwnMission(caller: string, id: number): void {
    this.record(caller, "cancel_own_mission", [id], () => {
      const m = this.db.get("mission", id);
      if (!m || m.created_by !== this.nameOf(caller)) throw new Error("not your mission");
      if (m.status !== "proposed" && m.status !== "queued") throw new Error(`mission is ${m.status}`);
      this.db.update("mission", { ...m, status: "cancelled", updated_at: this.now() });
      this.event("mission_cancelled", "mission", id, "cancelled by creator");
    });
  }

  setAuditFlagStatus(caller: string, id: number, status: AuditFlagStatus): void {
    this.record(caller, "set_audit_flag_status", [id, status], () => {
      const name = this.nameOf(caller);
      const role = this.roleOf(caller);
      if (name !== "orchestrator" && role !== "coordinator" && role !== "commander") throw new Error("not allowed");
      const f = this.db.get("audit_flag", id);
      if (!f) throw new Error("no such flag");
      if (status !== "acted" && status !== "dismissed") throw new Error("bad status");
      this.db.update("audit_flag", { ...f, status, updated_at: this.now() });
      this.event("audit_flag", "audit_flag", id, `${status} by ${name}`);
    });
  }

  postBriefing(caller: string, audience: string, text: string, priority: BriefingPriority, sid: number | null, kind: BriefingKind | null): void {
    this.record(caller, "post_briefing", [audience, text, priority, sid, kind], () => this.brief(caller, audience, text, priority, sid, kind));
  }

  private brief(caller: string, audience: string, text: string, priority: BriefingPriority, sid: number | null, kind: BriefingKind | null): void {
    const name = this.nameOf(caller);
    const role = caller === MODULE ? null : this.roleOf(caller);
    if (!(caller === MODULE || name === "comms_agent" || role === "coordinator" || role === "commander" || role === "sim")) throw new Error("not allowed");
    const aud = audience.toLowerCase();
    if (!["all", "coordinators", "commander"].includes(aud) && !(/^[0-9a-f]{64}$/.test(aud) && this.participant(aud)))
      throw new Error("bad audience");
    if (text.length > 120) throw new Error("briefing over 120 characters");
    this.checkText(text);
    const last = this.db
      .rows("briefing")
      .filter((b) => b.created_by === name && b.audience === aud)
      .reduce((m, b) => Math.max(m, b.created_at), 0);
    if (last && this.now() - last < 3000) throw new Error("briefing rate limit (3 s per audience)");
    this.db.insert("briefing", {
      run_id: this.runId(),
      chain_id: sid ? this.survivorChain(sid) : 0,
      audience: aud,
      text,
      priority,
      kind,
      survivor_id: sid || null,
      created_by: name,
      created_at: this.now(),
    });
  }

  // ---------- simulator and human helpers (not agent reducers) ----------

  createSite(opts: Partial<Site> & { center_lat: number; center_lon: number }): Site {
    const demo = opts.demo_mode ?? true;
    return this.db.insert("site", {
      name: opts.name ?? "demo site",
      center_lat: opts.center_lat,
      center_lon: opts.center_lon,
      radius_m: opts.radius_m ?? 483,
      demo_mode: demo,
      require_mission_approval: opts.require_mission_approval ?? true,
      mission_lease_s: opts.mission_lease_s ?? (demo ? 15 : 30),
      assignment_lease_s: opts.assignment_lease_s ?? (demo ? 30 : 120),
      proposal_lease_s: opts.proposal_lease_s ?? (demo ? 30 : 60),
      escalate_after_s: opts.escalate_after_s ?? (demo ? 45 : 180),
      created_at: this.now(),
    });
  }

  startRun(name: string): number {
    const site = this.site();
    if (!site) throw new Error("no site");
    const r = this.db.insert("run", { site_id: site.id, name, started_at: this.now(), ended_at: null, notes: "" });
    this.event("run_started", "run", r.id, name);
    this.watchdogDue = this.now() + this.watchdogS() * 1000;
    return r.id;
  }

  addCell(label: string, lat: number, lon: number, size = 15): SearchCell {
    const site = this.site()!;
    return this.db.insert("search_cell", {
      site_id: site.id,
      lat,
      lon,
      size_m: size,
      label,
      status: "unsearched",
      searched_by: null,
      found: 0,
      reported_missing: 0,
      reported_safe: 0,
      unaccounted: 0,
      updated_at: this.now(),
    });
  }

  addRescuer(name: string, lat: number, lon: number, identity?: string): string {
    const id = (identity ?? hexId("rescuer:" + name)).toLowerCase();
    this.db.insert("participant", { identity: id, name, role: "rescuer", lat, lon, online: true, last_heartbeat: this.now(), last_seen: this.now() });
    this.alive.add(id);
    return id;
  }

  /** The rescuer's glasses stop sending heartbeats (the heartbeat timer releases after 15 s). */
  dropRescuer(identity: string): void {
    this.alive.delete(identity);
  }

  addRobot(robotId: string, lat: number, lon: number, battery = 71): void {
    this.db.insert("robot", {
      robot_id: robotId,
      name: robotId,
      lat,
      lon,
      gps_fix: false,
      indoor_offset_m: null,
      heading_deg: null,
      battery_pct: battery,
      state: "READY",
      online: true,
      current_mission_id: null,
      last_heartbeat: this.now(),
      terrain_class: "debris",
      terrain_confidence: 0.8,
      terrain_source: "lidar_imu_rules",
      terrain_action: "slow",
    });
  }

  setRobot(robotId: string, patch: Partial<import("../types.ts").Robot>): void {
    const r = this.db.get("robot", robotId);
    if (r) this.db.update("robot", { ...r, ...patch });
  }

  /** report_detection, then report_breathing and set_critical_score, as robot plus perception would. */
  addSurvivor(o: {
    lat: number;
    lon: number;
    cell_id?: number;
    house_label?: string;
    location_note?: string;
    thermal_confidence?: number;
    level: CriticalLevel;
    score: number;
    breathing: Breathing;
    rate?: number;
    conf?: number;
    visibility?: number;
  }): number {
    const run = this.activeRun()!;
    const site = this.site()!;
    const det = this.db.insert("detection", {
      run_id: run.id,
      chain_id: 0,
      robot_id: "dog1",
      mission_id: 0,
      source: "thermal",
      survivor_id: 0,
      client_ref: `ref-${this.now()}`,
      lat: o.lat,
      lon: o.lon,
      gps_fix: false,
      location_note: o.location_note ?? "",
      max_temp_c: 34,
      thermal_confidence: o.thermal_confidence ?? 0.82,
      thermal_image_url: null,
      camera_image_url: null,
      breathing_clip_url: null,
      created_at: this.now(),
    });
    const s = this.db.insert("survivor", {
      site_id: site.id,
      cell_id: o.cell_id ?? 0,
      first_detection_id: det.id,
      lat: o.lat,
      lon: o.lon,
      location_note: o.location_note ?? "",
      house_label: o.house_label ?? null,
      breathing: "unknown",
      breathing_rate_bpm: null,
      breathing_confidence: 0,
      visibility_pct: null,
      critical_level: "unknown",
      critical_score: 0,
      score_confidence: 0,
      score_reasons: [],
      status: "unassigned",
      resolution: null,
      resolved_by: null,
      possible_duplicate_of: 0,
      breathing_display_url: null,
      escalated_at: null,
      created_at: this.now(),
      updated_at: this.now(),
    });
    const ev = this.event("survivor_created", "survivor", s.id, `survivor #${s.id} at ${o.house_label ?? "?"}`);
    this.db.update("detection", { ...det, survivor_id: s.id, chain_id: ev.id });
    this.recountCells();
    const cur = this.db.get("survivor", s.id)!;
    this.db.update("survivor", {
      ...cur,
      breathing: o.breathing,
      breathing_rate_bpm: o.breathing === "detected" ? (o.rate ?? null) : null,
      breathing_confidence: o.conf ?? 0.5,
      visibility_pct: o.visibility ?? null,
      critical_level: o.level,
      critical_score: o.score,
      score_confidence: 0.7,
      updated_at: this.now(),
    });
    this.event("score_changed", "survivor", s.id, `unknown -> ${o.level}`);
    if (o.level === "immediate") this.unattendedSince.set(s.id, this.now());
    return s.id;
  }

  reportPerson(cellId: number, kind: "missing" | "safe", count: number): void {
    this.db.insert("person_report", {
      run_id: this.runId(),
      cell_id: cellId,
      kind,
      count,
      name_or_unit: null,
      note: "",
      source: "family",
      reported_by: "coordinator",
      created_at: this.now(),
    });
    this.recountCells();
  }

  private recountCells(): void {
    const survivors = this.db.rows("survivor");
    const reports = this.db.rows("person_report");
    for (const c of this.db.rows("search_cell")) {
      const found = survivors.filter((s) => s.cell_id === c.id && s.resolution !== "false_alarm" && s.resolution !== "duplicate").length;
      const missing = reports.filter((r) => r.cell_id === c.id && r.kind === "missing").reduce((n, r) => n + r.count, 0);
      const safe = reports.filter((r) => r.cell_id === c.id && r.kind === "safe").reduce((n, r) => n + r.count, 0);
      const unaccounted = Math.max(0, missing - found - safe);
      if (c.found !== found || c.reported_missing !== missing || c.reported_safe !== safe || c.unaccounted !== unaccounted)
        this.db.update("search_cell", { ...c, found, reported_missing: missing, reported_safe: safe, unaccounted, updated_at: this.now() });
    }
  }

  /** accept_assignment from the rescuer's glasses. */
  acceptAssignment(identity: string, aid: number): void {
    this.record(identity, "accept_assignment", [aid], () => {
      const a = this.db.get("assignment", aid);
      if (!a || a.rescuer_identity !== identity) throw new Error("not your assignment");
      if (a.status !== "proposed") throw new Error(`assignment is ${a.status}`);
      const s = this.db.get("survivor", a.survivor_id)!;
      if (s.status !== "unassigned") throw new Error("survivor not unassigned");
      const site = this.site();
      this.db.update("assignment", { ...a, status: "active", accepted_at: this.now(), lease_expires_at: this.now() + (site?.assignment_lease_s ?? 120) * 1000, updated_at: this.now() });
      this.db.update("survivor", { ...s, status: "assigned", updated_at: this.now() });
      this.unattendedSince.delete(s.id);
      this.escalated.delete(s.id);
      this.event("assignment_accepted", "assignment", aid, "accepted");
    });
  }

  private release(a: Assignment, cause: string): void {
    this.db.update("assignment", { ...a, status: "released", release_cause: cause, updated_at: this.now() });
    if (a.status === "active") {
      const s = this.db.get("survivor", a.survivor_id);
      if (s && s.status !== "resolved") {
        this.db.update("survivor", { ...s, status: "unassigned", updated_at: this.now() });
        if (s.critical_level === "immediate") this.unattendedSince.set(s.id, this.now());
      }
    }
    this.event(cause === "expired" ? "assignment_expired" : "assignment_released", "assignment", a.id, cause);
  }

  /** "Critical survivors unattended over 60 s" (CONTRACTS.md Timers). */
  headline(): number {
    const now = this.now();
    let n = 0;
    for (const s of this.db.rows("survivor")) {
      if (s.critical_level !== "immediate" || s.status !== "unassigned") continue;
      const since = this.unattendedSince.get(s.id) ?? s.created_at;
      if (now - since > 60_000) n++;
    }
    return n;
  }

  // ---------- timers ----------

  tick(): void {
    const now = this.now();
    const run = this.activeRun();
    // Simulated glasses heartbeats every 5 s for rescuers still "wearing" their glasses.
    if (now - this.lastSimBeat >= 5000) {
      this.lastSimBeat = now;
      for (const id of this.alive) {
        const p = this.participant(id);
        if (p) this.db.update("participant", { ...p, online: true, last_heartbeat: now, last_seen: now });
      }
    }
    // heartbeat_timer: a rescuer with no heartbeat for 15 s goes offline and loses active assignments.
    for (const p of this.db.rows("participant")) {
      if (p.role !== "rescuer" || !p.online || now - p.last_heartbeat <= 15_000) continue;
      this.db.update("participant", { ...p, online: false });
      for (const a of this.db.rows("assignment")) if (a.rescuer_identity === p.identity && (a.status === "active" || a.status === "proposed")) this.release(a, "heartbeat");
      this.event("rescuer_offline", "participant", 0, `${p.name} offline`);
    }
    // lease_timer: proposals and claimed tasks.
    for (const a of this.db.rows("assignment")) {
      if (a.status === "proposed" && a.lease_expires_at != null && a.lease_expires_at <= now) this.release(a, "expired");
    }
    for (const t of this.db.rows("agent_task")) {
      if (t.status !== "claimed" || t.lease_expires_at == null || t.lease_expires_at > now) continue;
      const n = (this.taskAttempts.get(t.id) ?? 0) + 1;
      this.taskAttempts.set(t.id, n);
      const status = n >= 3 ? "expired" : "open";
      this.db.update("agent_task", { ...t, status, lease_expires_at: null, updated_at: now } as AgentTask);
      this.event(status === "expired" ? "agent_task_expired" : "agent_task_claimed", "agent_task", t.id, `lease expired (${n})`);
    }
    if (!run) return;
    // escalation_timer: everyone at N s, the commander at 2N s.
    const N = (this.site()?.escalate_after_s ?? 180) * 1000;
    for (const s of this.db.rows("survivor")) {
      if (s.critical_level !== "immediate" || s.status !== "unassigned") continue;
      const since = this.unattendedSince.get(s.id) ?? s.created_at;
      const level = this.escalated.get(s.id) ?? 0;
      const place = s.house_label ?? `survivor #${s.id}`;
      if (level < 1 && now - since >= N) {
        this.escalated.set(s.id, 1);
        this.safeBrief("all", `ESCALATION: IMMEDIATE ${place} unassigned ${Math.round(N / 1000)} s.`, s.id);
        this.event("escalation", "survivor", s.id, "level 1");
      } else if (level < 2 && now - since >= 2 * N) {
        this.escalated.set(s.id, 2);
        this.safeBrief("commander", `ESCALATION: IMMEDIATE ${place} unassigned ${Math.round((2 * N) / 1000)} s.`, s.id);
        this.event("escalation_commander", "survivor", s.id, "level 2");
      }
    }
    // agent_watchdog: no orchestrator heartbeat for N s.
    if (now >= this.watchdogDue) {
      this.watchdogDue = now + this.watchdogS() * 1000;
      this.watchdogFired();
    }
  }

  private safeBrief(audience: string, text: string, sid: number): void {
    try {
      this.brief(MODULE, audience, text.slice(0, 120), "critical", sid, "escalation");
    } catch {
      /* rate limited: the next tick retries through the level check */
    }
  }

  /** spacetimedb.md 7.4. */
  private watchdogFired(): void {
    const now = this.now();
    const open = this.db.rows("assignment").filter((a) => a.status === "proposed" || a.status === "active");
    const urgent = this.db
      .rows("survivor")
      .filter((s) => s.critical_level === "immediate" && s.status === "unassigned" && !open.some((a) => a.survivor_id === s.id && a.status === "proposed"))
      .sort((a, b) => b.critical_score - a.critical_score || a.created_at - b.created_at || a.id - b.id);
    if (urgent.length === 0) return;
    this.watchdogFires++;
    let candidates = this.db
      .rows("participant")
      .filter((p) => p.role === "rescuer" && p.online && p.lat != null && p.lon != null && now - p.last_heartbeat <= 15_000)
      .filter((p) => !open.some((a) => a.rescuer_identity === p.identity && a.status === "proposed"));
    const active = (id: string) => open.filter((a) => a.rescuer_identity === id && a.status === "active").length;
    for (const s of urgent) {
      if (candidates.length === 0) break;
      const ranked = candidates
        .map((p) => ({ p, n: active(p.identity), d: haversineM(p.lat!, p.lon!, s.lat, s.lon) }))
        .sort((a, b) => a.n - b.n || a.d - b.d || (a.p.identity < b.p.identity ? -1 : 1));
      const pick = ranked[0];
      candidates = candidates.filter((p) => p.identity !== pick.p.identity);
      const reason = `watchdog: orchestrator silent ${this.watchdogS()} s, nearest free rescuer ${Math.round(pick.d)} m`;
      try {
        const a = this.propose(MODULE, s.id, pick.p.identity, reason);
        this.event("agent_watchdog_fallback", "assignment", a.id, reason);
        this.db.insert("agent_action", {
          run_id: this.runId(),
          chain_id: a.chain_id,
          agent: MODULE,
          step: 0,
          model: "rules",
          tool: "propose_assignment",
          args_json: JSON.stringify({ survivor_id: s.id, rescuer_identity: pick.p.identity }),
          result: `ok: assignment_id=${a.id}`,
          reason,
          created_at: now,
        });
      } catch (err) {
        console.error("[fake module] watchdog proposal failed:", (err as Error).message);
      }
    }
  }
}

/** Actions bound to one identity on the fake module; also what tests use as FakeActions. */
export class FakeActions implements Actions {
  constructor(
    readonly module: FakeModule,
    readonly identity: string,
  ) {}
  async registerParticipant(name: string, role: Role) {
    this.module.registerParticipant(this.identity, name, role);
  }
  async agentHeartbeat() {
    this.module.agentHeartbeat(this.identity);
  }
  async postAgentTask(to: AgentName, kind: string, payload: string, prio: TaskPriority, reason: string, chain: number) {
    this.module.postAgentTask(this.identity, to, kind, payload, prio, reason, chain);
  }
  async claimAgentTask(id: number) {
    this.module.claimAgentTask(this.identity, id);
  }
  async completeAgentTask(id: number, status: "done" | "failed", result: string) {
    this.module.completeAgentTask(this.identity, id, status, result);
  }
  async logAgentAction(tool: string, args: string, result: string, reason: string, step: number, model: string, chain: number) {
    this.module.logAgentAction(this.identity, tool, args, result, reason, step, model, chain);
  }
  async proposeAssignment(sid: number, rid: string, reason: string) {
    this.module.proposeAssignment(this.identity, sid, rid, reason);
  }
  async createMission(r: string, k: MissionKind, cells: number[], lat: number | null, lon: number | null, reason: string, chain: number) {
    this.module.createMission(this.identity, r, k, cells, lat, lon, reason, chain);
  }
  async cancelOwnMission(id: number) {
    this.module.cancelOwnMission(this.identity, id);
  }
  async setAuditFlagStatus(id: number, s: AuditFlagStatus) {
    this.module.setAuditFlagStatus(this.identity, id, s);
  }
  async postBriefing(a: string, t: string, p: BriefingPriority, sid: number | null, k: BriefingKind | null) {
    this.module.postBriefing(this.identity, a, t, p, sid, k);
  }
}
