// Orchestrator (agent.md 7.2): triage, rescuer proposals, the search plan and robot missions,
// delegation. Model: Super with reasoning_effort "low". Its only deterministic proposer is the
// database watchdog (8.1); its own fallback is the search continue rule for an idle robot.

import type { AgentConfig, CycleCtx, CycleInput, Wake, WakeOutput, WakeRule } from "../agent-types.ts";
import type { Config } from "../config.ts";
import { breathingDisplay, levelWord, tierOf } from "../priority.ts";
import { continueMission } from "../rules.ts";
import { dispatch } from "../tools/dispatch.ts";
import { orderCells, targetedBy } from "../tools/reads.ts";
import type { ToolName } from "../tools/schemas.ts";
import type { AgentTask, Assignment, AuditFlag, Detection, EventLog, Mission, PersonReport, Robot, SearchCell, Survivor } from "../types.ts";
import { iso, parsePayload, type World } from "../world.ts";
import { ORCHESTRATOR_PROMPT } from "./prompts.ts";

export const ORCHESTRATOR_TOOLS: ToolName[] = [
  "get_board",
  "get_survivor",
  "list_rescuers",
  "list_cells",
  "get_robot",
  "propose_assignment",
  "delegate",
  "set_flag_status",
  "create_mission",
  "cancel_own_mission",
  // "sitrep" joins here with E10 (ENABLE_SITREP).
];

export const WATCHDOG_S = 30;
export const WATCHDOG_DEMO_S = 15;

function wake(w: World, key: string, kind: string, priority: Wake["priority"], note: string, extra: Partial<Wake> = {}): WakeOutput {
  return { wake: { key, kind, priority, at: w.now(), note, ...extra } };
}

const survivorChanged: WakeRule = (c, w) => {
  if (c.table !== "survivor") return [];
  const s = c.row as Survivor;
  const o = c.old as Survivor | undefined;
  if (!w.survivor(s.id)) return [];
  let what: string | null = null;
  if (c.op === "insert") what = "created";
  else if (o) {
    if (o.critical_level !== s.critical_level || o.critical_score !== s.critical_score) what = "score_changed";
    else if (o.breathing !== s.breathing) what = "breathing_reported";
    else if (o.status !== "unassigned" && s.status === "unassigned") what = "back_to_unassigned";
  }
  if (!what || s.status !== "unassigned") return [];
  const t = tierOf(s);
  return [wake(w, `survivor:survivor:${s.id}`, "survivor", t === 0 ? "critical" : "high", `survivor #${s.id} ${what} (tier ${t})`, { survivorId: s.id })];
};

const flagFiled: WakeRule = (c, w) => {
  if (c.table !== "audit_flag" || c.op !== "insert") return [];
  const f = c.row as AuditFlag;
  if (f.kind !== "proposal_disagree" && f.kind !== "load_imbalance") return [];
  const a = f.entity === "assignment" ? w.raw("assignment").find((x) => x.id === f.entity_id) : null;
  return [wake(w, `flag:audit_flag:${f.id}`, "flag", "high", `audit flag #${f.id} ${f.kind}`, { survivorId: a?.survivor_id, chainId: a?.chain_id })];
};

const rescuerFreed: WakeRule = (c, w) => {
  if (c.table !== "assignment" || c.op !== "update") return [];
  const a = c.row as Assignment;
  const o = c.old as Assignment | undefined;
  if (!o || o.status === a.status || !w.survivor(a.survivor_id)) return [];
  // Our addition: an accepted proposal makes its rescuer available again; wake only if someone waits.
  if (o.status === "proposed" && a.status === "active") {
    if (w.waitingRanked().length === 0) return [];
    return [wake(w, `available:participant:${a.rescuer_identity.slice(0, 12)}`, "assignment", "high", `${w.callsign(a.rescuer_identity)} accepted #${a.survivor_id}; available again`)];
  }
  if (a.status !== "released" && a.status !== "completed") return [];
  return [wake(w, `freed:assignment:${a.id}`, "assignment", "high", `assignment #${a.id} ${a.status}${a.release_cause ? " (" + a.release_cause + ")" : ""}; a rescuer is free`, { survivorId: a.survivor_id })];
};

const searchInputs: WakeRule = (c, w) => {
  if (c.table === "person_report" && c.op === "insert") {
    const p = c.row as PersonReport;
    return [wake(w, `report:person_report:${p.id}`, "person_report", "normal", `person report #${p.id}: ${p.count} ${p.kind} at cell #${p.cell_id}`)];
  }
  if (c.table === "search_cell" && c.op === "update") {
    const s = c.row as SearchCell;
    const o = c.old as SearchCell | undefined;
    if (s.status === "partially_searched" && o?.status !== "partially_searched")
      return [wake(w, `cell:search_cell:${s.id}`, "cell", "normal", `${s.label} partially searched`)];
  }
  if (c.table === "event_log" && c.op === "insert") {
    const e = c.row as EventLog;
    if (e.kind === "cell_reopened") return [wake(w, `cell:search_cell:${e.entity_id}`, "cell", "normal", `cell #${e.entity_id} reopened`, { chainId: e.id })];
  }
  return [];
};

const ownTaskFailed: WakeRule = (c, w, self) => {
  if (c.table !== "agent_task" || c.op !== "update") return [];
  const t = c.row as AgentTask;
  const o = c.old as AgentTask | undefined;
  if (t.from_agent !== self || o?.status === t.status || (t.status !== "failed" && t.status !== "expired")) return [];
  return [wake(w, `task:agent_task:${t.id}`, "own_task", "high", `${t.kind} task #${t.id} ${t.status}`, { chainId: t.chain_id })];
};

const robotEvents: WakeRule = (c, w, self) => {
  const out: WakeOutput[] = [];
  const idleWake = (id: string) => wake(w, `robot:robot:${id}`, "robot_idle", "normal", `robot ${id} idle`);
  if (c.table === "mission" && c.op === "update") {
    const m = c.row as Mission;
    const o = c.old as Mission | undefined;
    if (o?.status === m.status) return [];
    if (m.created_by === self && (m.status === "done" || m.status === "failed"))
      out.push(wake(w, `mission:mission:${m.id}`, "mission", "normal", `mission #${m.id} ${m.status}`, { chainId: m.chain_id }));
    if (["done", "failed", "cancelled"].includes(m.status)) {
      const r = w.robot(m.robot_id);
      if (r && w.robotIdle(r)) out.push(idleWake(r.robot_id));
    }
  }
  if (c.table === "robot") {
    const r = c.row as Robot;
    const o = c.old as Robot | undefined;
    const wasReady = !!o && o.online && o.state === "READY" && !o.current_mission_id;
    if (!wasReady && w.robotIdle(r)) out.push(idleWake(r.robot_id));
  }
  return out;
};

const weakDetection: WakeRule = (c, w) => {
  if (c.table !== "detection" || c.op !== "insert") return [];
  const d = c.row as Detection;
  if (d.thermal_confidence < 0.3 || d.thermal_confidence > 0.6) return [];
  return [wake(w, `detection:detection:${d.id}`, "weak_detection", "normal", `weak detection #${d.id} (thermal ${d.thermal_confidence.toFixed(2)})`, { chainId: d.chain_id })];
};

function watchdogLine(w: World, ctx: CycleCtx): string {
  const site = w.site();
  const n = site?.demo_mode ? WATCHDOG_DEMO_S : WATCHDOG_S;
  const urgent = w.waitingRanked().find((s) => s.critical_level === "immediate");
  if (!urgent) return "WATCHDOG: no unassigned IMMEDIATE survivor waiting";
  const last = ctx.memory.lastHeartbeatAt || ctx.input.startedAt;
  const left = Math.max(0, Math.round(n - (w.now() - last) / 1000));
  return `WATCHDOG: fires in ${left} s if no proposal for #${urgent.id}`;
}

/** Candidates per survivor: the rescuers the propose_assignment guard accepts, best first (World.candidatesFor). */
export const CANDIDATES_LABEL = "candidates (fewest active, then nearest)";
export const NEXT_CELLS_LABEL = "next to search";

function survivorLine(w: World, s: Survivor): string {
  const { candidates, lapsed } = w.candidatesFor(s);
  const near = candidates
    .slice(0, 5)
    .map((r) => `${r.callsign} ${r.distance_m ?? "?"} m ${r.compass ?? ""}, ${r.active_assignments} active`.replace(" ,", ","))
    .join("; ");
  const gone = lapsed.length ? ` | lapsed, do not propose: ${lapsed.map((r) => r.callsign).join(", ")}` : "";
  const note = s.location_note ? `, ${s.location_note}` : "";
  return `#${s.id} ${w.placeOf(s)} ${levelWord(s)} score ${Math.round(s.critical_score)}, ${breathingDisplay(s)}${note} | ${CANDIDATES_LABEL}: ${near || "none"}${gone}`;
}

/** Cells a search_cells mission may target now, in search order (agent.md 7.2 step 4). */
function cellsLine(w: World): string {
  const cells = w.cells();
  const unacc = cells.filter((c) => c.unaccounted > 0);
  const uns = cells.filter((c) => c.status === "unsearched" || c.status === "partially_searched");
  const parts = unacc.map(
    (c) => `${c.label} (cell #${c.id} at ${c.lat.toFixed(6)},${c.lon.toFixed(6)}) reported missing ${c.reported_missing}, found ${c.found}, unaccounted ${c.unaccounted}`,
  );
  const site = w.site();
  const robot = w.robots().find((r) => r.online && r.lat != null && r.lon != null);
  const from = robot ? { lat: robot.lat!, lon: robot.lon! } : site ? { lat: site.center_lat, lon: site.center_lon } : null;
  const open = cells.filter(
    (c) => c.status !== "searched" && c.status !== "searching" && (c.unaccounted > 0 || uns.includes(c)) && targetedBy(w, c.id) == null,
  );
  const next = orderCells(w, open, from).slice(0, 6).map(({ c }) => `#${c.id} ${c.label}`);
  const inMissions = uns.filter((c) => targetedBy(w, c.id) != null).length;
  parts.push(
    `${uns.length} unsearched or partly searched` +
      (inMissions ? `, ${inMissions} in open missions` : "") +
      `; ${NEXT_CELLS_LABEL}: ${next.length ? next.join(", ") : "none"}`,
  );
  return `CELLS: ${parts.join("; ")}`;
}

export function orchestratorPacket(w: World, input: CycleInput, ctx: CycleCtx): string {
  const run = w.activeRun();
  const lines: string[] = [];
  lines.push(`WAKE: ${input.wakes.map((x) => x.note).join("; ") || "board check"}`);
  lines.push(`CHAIN: ${input.chainId}`);
  lines.push(`TIME: ${iso(w.now())?.replace(/\.\d+Z$/, "Z")}  RUN: #${run?.id ?? 0} "${run?.name ?? ""}"`);
  const waiting = w.waitingRanked();
  lines.push(`SURVIVORS (unassigned, priority order):${waiting.length ? "" : " none"}`);
  for (const s of waiting.slice(0, 8)) lines.push(`  ${survivorLine(w, s)}`);
  if (waiting.length > 8) lines.push(`  ...and ${waiting.length - 8} more`);
  const pending = w.assignments().filter((a) => a.status === "proposed");
  if (pending.length) {
    const tasks = w.tasks();
    lines.push(
      "PENDING PROPOSALS: " +
        pending
          .map((a) => {
            const brief = tasks.some((t) => t.kind === "brief_rescuer" && parsePayload<{ assignment_id?: number }>(t.payload_json)?.assignment_id === a.id);
            return `#${a.survivor_id} to ${w.callsign(a.rescuer_identity)} (assignment #${a.id}, by ${a.created_by}, brief ${brief ? "posted" : "none"})`;
          })
          .join("; "),
    );
  }
  const top = waiting[0];
  const resc = w.rescuers().map((r) => {
    if (!r.fresh) return `${r.callsign} offline`;
    const where = top && r.lat != null ? (() => {
      const n = w.rescuersNear(top.lat, top.lon, false).find((x) => x.identity === r.identity);
      return n?.distance_m != null ? ` ${n.distance_m} m ${n.compass} of #${top.id}` : "";
    })() : "";
    const state = r.available ? "available" : `busy (proposal #${r.proposed_assignment_id})`;
    return `${r.callsign} ${state}${where}, active ${r.active_assignments}`;
  });
  lines.push(`RESCUERS: ${resc.length ? resc.join("; ") : "none"}`);
  lines.push(cellsLine(w));
  const robots = w.robots().map((r) => {
    const open = w.openMissionsFor(r.robot_id).map((m) => `mission #${m.id} ${m.kind} ${m.status}`);
    const bat = r.battery_pct != null ? ` battery ${Math.round(r.battery_pct)}%` : "";
    return `${r.robot_id} ${r.online ? "online" : "offline"} ${r.state}${w.robotIdle(r) ? " idle" : ""}${bat}, terrain ${r.terrain_class}${open.length ? ", " + open.join(", ") : ""}`;
  });
  lines.push(`ROBOT: ${robots.length ? robots.join("; ") : "none"}`);
  for (const wk of input.wakes) {
    if (wk.kind !== "weak_detection") continue;
    const id = Number(wk.key.split(":").pop());
    const d = w.detections().find((x) => x.id === id);
    if (d) lines.push(`WEAK DETECTION: #${d.id} at ${d.lat.toFixed(6)},${d.lon.toFixed(6)} thermal ${d.thermal_confidence.toFixed(2)}, ${d.location_note}`);
  }
  const flags = w.auditFlags().filter((f) => f.status === "open");
  lines.push(
    `OPEN FLAGS: ${
      flags.length
        ? flags.map((f) => `#${f.id} ${f.kind} on ${f.entity} #${f.entity_id}: "${f.message}"${f.suggested_action ? ` (suggests: ${f.suggested_action})` : ""}`).join("; ")
        : "none"
    }`,
  );
  lines.push(watchdogLine(w, ctx));
  return lines.join("\n");
}

export function orchestratorConfig(cfg: Config): AgentConfig {
  return {
    name: "orchestrator",
    role: "agent",
    model: cfg.MODEL_SUPER,
    systemPrompt: ORCHESTRATOR_PROMPT,
    tools: ORCHESTRATOR_TOOLS,
    wakeRules: [survivorChanged, flagFiled, rescuerFreed, searchInputs, ownTaskFailed, robotEvents, weakDetection],
    timeoutMs: 15_000,
    maxSteps: 4,
    maxToolCalls: 8,
    // On real Nemotron Super sometimes spent its last requests on reads and hit the step limit
    // before create_mission (the inspect mission for a house with someone unaccounted for).
    finalTools: ["propose_assignment", "delegate", "set_flag_status", "create_mission", "cancel_own_mission"],
    maxTokens: 1536,
    mergeRowWakes: true,
    heartbeatMs: 5000,
    buildWakePacket: orchestratorPacket,
    useModel: () => true,
    satisfied: () => true,
    // dispatch.ts rule (agent.md 7.2): post brief_rescuer for a proposal the model did not delegate.
    async afterModel(ctx) {
      for (const p of ctx.state.proposals) {
        if (ctx.state.delegatedSurvivors.has(p.survivor_id)) continue;
        const s = ctx.world.survivor(p.survivor_id);
        await dispatch(
          ctx,
          "delegate",
          {
            reason: `[fallback] brief ${ctx.world.callsign(p.rescuer_identity)} on #${p.survivor_id}; model did not delegate`,
            to_agent: "comms_agent",
            kind: "brief_rescuer",
            priority: s && tierOf(s) === 0 ? "critical" : "high",
            survivor_id: p.survivor_id,
            ...(p.assignment_id ? { assignment_id: p.assignment_id } : {}),
          },
          "rules",
        );
      }
    },
    // No proposal fallback: the database watchdog proposes. Only the continue rule for idle robots.
    async fallback(ctx, why) {
      await this.afterModel!(ctx);
      for (const r of ctx.world.robots()) {
        const plan = continueMission(ctx.world, r);
        if (!plan) continue;
        await dispatch(
          ctx,
          "create_mission",
          { reason: plan.reason, robot_id: r.robot_id, kind: "search_cells", target_cell_ids: plan.target_cell_ids },
          "rules",
        );
      }
      ctx.state.summary = `[fallback] ${why}`;
    },
  };
}
