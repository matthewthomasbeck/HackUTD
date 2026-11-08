// Rules G1 to G8 (agent.md section 2) and the per-tool guards of the tool tables (7.2 to 7.4).
// Every guard runs on fresh WorldView data just before the call and returns an error string the
// model can act on, or null. The module enforces the same rules again in its reducers.

import type { CycleCtx } from "./agent-types.ts";
import { sortTier } from "./priority.ts";
import { haversineM } from "./geo.ts";
import { parsePayload, type World } from "./world.ts";

// ---------- text rules (G2, G5) ----------

export const DEATH_WORDS = /\b(dead|deceased|died|death|expectant|fatal|corpse|body recovery|no pulse|lifeless)\b/i;
const BRIEFING_ONLY = [/\brescued\b/i, /\bsafe now\b/i];
export const BRIEFING_MAX = 120;

/** G2 for any stored free text. */
export function textProblem(text: string): string | null {
  const m = DEATH_WORDS.exec(text);
  if (m) return `text uses a forbidden word ("${m[0]}"); never imply anyone is dead, say "no signs of life detected, low confidence"`;
  return null;
}

/** G2 and G5 for a briefing: no death words, not "rescued"/"safe now", ASCII, one line, at most 120 characters. */
export function briefingProblem(text: string): string | null {
  const t = textProblem(text);
  if (t) return t;
  for (const re of BRIEFING_ONLY) {
    const m = re.exec(text);
    if (m) return `briefing says "${m[0]}"; only a person can confirm that`;
  }
  if (/[\r\n]/.test(text)) return "briefing must be one line";
  if (!/^[\x20-\x7E]*$/.test(text)) return "briefing must be plain ASCII";
  if (text.length > BRIEFING_MAX) return `briefing is ${text.length} characters; the limit is ${BRIEFING_MAX}, shorten it`;
  if (text.trim().length < 3) return "briefing is empty";
  return null;
}

/** Make text safe for a template briefing: ASCII only, one line. */
export function asciiLine(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** G8: no rescuer or participant names in text sent to a model; callsigns only. */
export function redactNames(text: string, w: World): string {
  let out = text;
  for (const p of w.participants()) {
    if (p.role !== "rescuer" && p.role !== "coordinator" && p.role !== "commander") continue;
    const name = p.name?.trim();
    if (!name || name.length < 2) continue;
    const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g");
    out = out.replace(re, p.role === "rescuer" ? w.callsign(p.identity) : p.role);
  }
  return out;
}

/** A reason "says why" when it gives a cause (heuristic; agent.md leaves the wording open). */
const EXPLAINS =
  /\b(because|since|due to|load|fewer|auditor|about to be free|free soon|terrain|blocked|access|entry|route|already (there|nearby|inside)|knows)\b/i;
export function reasonExplains(reason: string): boolean {
  return EXPLAINS.test(reason);
}

/** A review reason "cites a fact": a number, a level, a tier, or a load. */
const FACT = /\d|\b(immediate|delayed|minor|tier|load|assignments?|closer|nearer|free|unassigned|unaccounted)\b/i;
export function citesFact(reason: string): boolean {
  return FACT.test(reason);
}

export const ALREADY_BY_WATCHDOG = "already proposed by watchdog";
export const LAPSE_WINDOW_MS = 5 * 60_000;
/** "About as close": within 25% or 10 m (agent.md does not define it). */
export function aboutAsClose(other: number, mine: number): boolean {
  return other <= mine * 1.25 + 10;
}

type Args = Record<string, any>;

// ---------- orchestrator ----------

export function guardProposeAssignment(ctx: CycleCtx, a: Args): string | null {
  const w = ctx.world;
  const s = w.survivor(a.survivor_id);
  if (!s) return `survivor #${a.survivor_id} is not in the active run`;
  // 8.2: re-read just before the call.
  const open = w.openAssignmentFor(s.id);
  if (open) {
    if (open.created_by !== "orchestrator") return ALREADY_BY_WATCHDOG;
    return `survivor #${s.id} already has ${open.status} assignment #${open.id}; do not repeat it`;
  }
  if (s.status !== "unassigned") return `survivor #${s.id} is ${s.status}, not unassigned`;
  const hex = String(a.rescuer_identity).toLowerCase();
  const r = w.rescuer(hex);
  if (!r) return "rescuer_identity is not a known rescuer";
  if (!r.fresh) return `${r.callsign} is not fresh (offline, no position, or no heartbeat in 15 s)`;
  if (!r.available) return `${r.callsign} already has pending proposal #${r.proposed_assignment_id}`;

  const tier = sortTier(s);
  const higher = w.waitingRanked().find((x) => sortTier(x) < tier);
  if (higher) return `survivor #${higher.id} (tier ${sortTier(higher)}) is unassigned with no proposal; propose it first`;

  const now = w.now();
  const others = w.rescuersNear(s.lat, s.lon, true).filter((o) => o.identity !== hex);
  const lapsed = w
    .assignmentsFor(s.id)
    .some(
      (x) => x.rescuer_identity === hex && x.status === "released" && x.release_cause === "expired" && now - x.updated_at < LAPSE_WINDOW_MS,
    );
  if (lapsed && others.length > 0)
    return `${r.callsign}'s proposal for #${s.id} lapsed in the last 5 min; choose another available rescuer`;

  if (r.lat != null && r.lon != null) {
    const mine = haversineM(r.lat, r.lon, s.lat, s.lon);
    const closer = others.find((o) => o.distance_m != null && o.distance_m < 0.5 * mine);
    if (closer && !reasonExplains(a.reason))
      return `${closer.callsign} is available ${closer.distance_m} m away, over 50% closer than ${r.callsign} at ${Math.round(mine)} m; say why in the reason`;
    const lighter = others.find(
      (o) => o.distance_m != null && o.active_assignments < r.active_assignments && aboutAsClose(o.distance_m, mine),
    );
    if (lighter && !reasonExplains(a.reason))
      return `${lighter.callsign} has fewer active assignments (${lighter.active_assignments} vs ${r.active_assignments}) and is about as close; say why in the reason`;
  }
  return null;
}

/** Resolve the assignment a delegate call is about. */
export function delegateAssignment(ctx: CycleCtx, a: Args): { assignment_id: number; survivor_id: number; rescuer_identity: string } | string {
  const w = ctx.world;
  if (a.assignment_id) {
    const x = w.assignment(a.assignment_id);
    if (!x) return `assignment #${a.assignment_id} not found`;
    if (x.status !== "proposed" && x.status !== "active") return `assignment #${x.id} is ${x.status}`;
    return { assignment_id: x.id, survivor_id: x.survivor_id, rescuer_identity: x.rescuer_identity };
  }
  if (!a.survivor_id) return "delegate needs assignment_id or survivor_id";
  const x = w.openAssignmentFor(a.survivor_id);
  if (x) return { assignment_id: x.id, survivor_id: x.survivor_id, rescuer_identity: x.rescuer_identity };
  // DRY_RUN=1 without a shadow: the proposal made in this cycle never reached the module.
  const p = ctx.state.proposals.find((q) => q.survivor_id === a.survivor_id);
  if (p && ctx.deps.dryRun !== "0") return { assignment_id: p.assignment_id ?? 0, survivor_id: p.survivor_id, rescuer_identity: p.rescuer_identity };
  return `survivor #${a.survivor_id} has no proposed or active assignment to brief`;
}

export function guardDelegate(ctx: CycleCtx, a: Args): string | null {
  const d = delegateAssignment(ctx, a);
  if (typeof d === "string") return d;
  if (!d.assignment_id) return null;
  const dup = ctx.world
    .tasks()
    .find(
      (t) =>
        t.kind === "brief_rescuer" &&
        (t.status === "open" || t.status === "claimed") &&
        parsePayload<{ assignment_id?: number }>(t.payload_json)?.assignment_id === d.assignment_id,
    );
  if (dup) return `brief_rescuer task #${dup.id} for assignment #${d.assignment_id} is already open`;
  return null;
}

export function guardSetFlagStatus(ctx: CycleCtx, a: Args): string | null {
  const f = ctx.world.auditFlags().find((x) => x.id === a.flag_id);
  if (!f) return `audit flag #${a.flag_id} not found`;
  if (f.status !== "open") return `audit flag #${f.id} is already ${f.status}`;
  return null;
}

export function guardCreateMission(ctx: CycleCtx, a: Args): string | null {
  const w = ctx.world;
  const r = w.robot(a.robot_id);
  if (!r) return `robot ${a.robot_id} not found`;
  if (!r.online) return `robot ${r.robot_id} is offline; no missions for an offline robot`;
  const site = w.site();
  const kind = a.kind as string;
  if (kind === "search_cells") {
    const ids: number[] = a.target_cell_ids ?? [];
    if (ids.length === 0) return "search_cells needs target_cell_ids (1 to 3)";
    const open = w.missions().filter((m) => m.status === "proposed" || m.status === "queued" || m.status === "leased" || m.status === "active");
    for (const id of ids) {
      const c = w.cell(id);
      if (!c) return `cell #${id} is not in this run's site`;
      if (c.status === "searched") return `cell #${id} (${c.label}) is already searched`;
      const other = open.find((m) => m.target_cell_ids.includes(id));
      if (other) return `cell #${id} is already targeted by open mission #${other.id}`;
    }
  }
  if (kind === "inspect" && (a.target_lat == null || a.target_lon == null)) return "inspect needs target_lat and target_lon";
  if (kind === "hold" && (a.target_lat != null || a.target_cell_ids)) return "hold takes no target";
  const pending = w.missions().find((m) => m.robot_id === r.robot_id && (m.status === "proposed" || m.status === "queued"));
  if (pending) return `robot ${r.robot_id} already has ${pending.status} mission #${pending.id}; cancel it first or wait`;
  if (site && a.target_lat != null && a.target_lon != null) {
    const d = haversineM(site.center_lat, site.center_lon, a.target_lat, a.target_lon);
    if (d > site.radius_m + 50) return `target is ${Math.round(d)} m from the site center; the limit is ${Math.round(site.radius_m + 50)} m`;
  }
  if (kind === "hold" || kind === "return_home") {
    const low = r.battery_pct != null && r.battery_pct < 20;
    const failed = w.devices(r.robot_id).filter((d) => d.status === "FAILED");
    if (!low && failed.length === 0) return `${kind} only for battery under 20% or a FAILED device`;
    const named =
      (low && /battery/i.test(a.reason)) || failed.some((d) => a.reason.toLowerCase().includes(d.device.toLowerCase()));
    if (!named) return `the reason must name the low battery or the failed device (${failed.map((d) => d.device).join(", ") || "battery"})`;
  }
  return null;
}

export function guardCancelOwnMission(ctx: CycleCtx, a: Args): string | null {
  const m = ctx.world.mission(a.mission_id);
  if (!m) return `mission #${a.mission_id} not found`;
  if (m.created_by !== "orchestrator") return `mission #${m.id} was created by ${m.created_by}, not by you`;
  if (m.status !== "proposed" && m.status !== "queued") return `mission #${m.id} is ${m.status}; only proposed or queued missions can be cancelled`;
  return null;
}

// ---------- comms agent ----------

export const SAME_TEXT_WINDOW_MS = 60_000;
export const MAX_BRIEFINGS_PER_CYCLE = 2;

export function guardSendBriefing(ctx: CycleCtx, a: Args): string | null {
  const w = ctx.world;
  const p = briefingProblem(String(a.text ?? ""));
  if (p) return p;
  if (ctx.state.briefingsSent >= MAX_BRIEFINGS_PER_CYCLE) return "at most 2 briefings per cycle";
  const audience = String(a.audience).toLowerCase();
  const task = ctx.input.task;
  const payload = task ? parsePayload<Record<string, any>>(task.payload_json) ?? {} : {};
  const isAnswer = task?.kind === "answer_rescuer";
  if (!["all", "coordinators", "commander"].includes(audience)) {
    if (!/^[0-9a-f]{64}$/.test(audience)) return "audience must be all, coordinators, commander, or a rescuer identity hex";
    const r = w.rescuer(audience);
    if (!r || !r.fresh) return "audience is not a fresh rescuer";
    if (task && (task.kind === "brief_rescuer" || isAnswer) && payload.rescuer_identity && payload.rescuer_identity !== audience)
      return "write only to the rescuer named in the task";
    const sid = a.survivor_id ?? payload.survivor_id;
    if (sid && !isAnswer) {
      const holds = w
        .assignmentsFor(sid)
        .some((x) => x.rescuer_identity === audience && (x.status === "proposed" || x.status === "active"));
      const dryOk = ctx.deps.dryRun !== "0" && payload.rescuer_identity === audience;
      if (!holds && !dryOk) return `${r.callsign} holds no proposed or active assignment for survivor #${sid}`;
    }
  }
  const key = `${audience}|${a.text}`;
  const now = w.now();
  const last = ctx.memory.briefings.get(key);
  const recent = w.briefings().some((b) => b.audience === audience && b.text === a.text && now - b.created_at < SAME_TEXT_WINDOW_MS);
  if ((last != null && now - last < SAME_TEXT_WINDOW_MS) || recent) return "the same text went to the same audience in the last 60 s";
  return null;
}

// ---------- auditor ----------

export function guardSubmitReview(ctx: CycleCtx, a: Args): string | null {
  const t = ctx.input.task;
  if (!t || t.kind !== "review") return "submit_review needs a claimed review task";
  if (ctx.state.taskCompleted) return "this review is already submitted";
  if (!citesFact(String(a.reason))) return "the reason must cite at least one fact, such as a distance, a level, or a load";
  if (a.verdict === "disagree" && !a.suggested_action) return "disagree only when you can name a better action; put it in suggested_action";
  return null;
}
