// Comms agent (agent.md 7.3): the rescuers' glasses text. Templates first (ENABLE_COMMS_MODEL=0),
// the Nano model once the core demo runs. Nudges are always templates; a watchdog proposal with no
// brief_rescuer task after 5 s gets a template briefing.

import type { AgentConfig, CycleCtx, CycleInput, Wake, WakeRule } from "../agent-types.ts";
import type { Config } from "../config.ts";
import { tierOf } from "../priority.ts";
import { answerTemplate, briefingTemplate, navTemplate, nudgeTemplate } from "../templates.ts";
import { dispatch } from "../tools/dispatch.ts";
import type { ToolName } from "../tools/schemas.ts";
import type { AgentTask, Assignment, BriefingPriority, Survivor } from "../types.ts";
import { parsePayload, type World } from "../world.ts";
import { COMMS_PROMPT } from "./prompts.ts";
import { survivorDisplay } from "../tools/reads.ts";

export const COMMS_TOOLS: ToolName[] = ["get_survivor", "send_briefing"]; // "describe_still" joins with E10.
export const WATCHDOG_BRIEF_AFTER_MS = 5000;
const TEMPLATE_ONLY = new Set(["nudge", "watchdog_brief"]);

function taskWake(w: World, t: AgentTask, self: string): Wake | null {
  if (t.to_agent !== self || t.status !== "open") return null;
  const p = parsePayload<{ survivor_id?: number; assignment_id?: number }>(t.payload_json) ?? {};
  return { key: `task:agent_task:${t.id}`, kind: "task", priority: t.priority, at: w.now(), note: `${t.kind} #${t.id}`, task: t, survivorId: p.survivor_id, assignmentId: p.assignment_id, chainId: t.chain_id };
}

const tasksForMe: WakeRule = (c, w, self) => {
  if (c.table !== "agent_task" || c.op === "delete") return [];
  const t = c.row as AgentTask;
  const o = c.old as AgentTask | undefined;
  if (o && o.status === t.status) return [];
  const wk = taskWake(w, t, self);
  return wk ? [{ wake: wk }] : [];
};

function hasBriefTask(w: World, a: Assignment): boolean {
  return w.raw("agent_task").some((t) => {
    if (t.kind !== "brief_rescuer") return false;
    const p = parsePayload<{ assignment_id?: number; survivor_id?: number }>(t.payload_json);
    return p?.assignment_id === a.id || (p?.survivor_id === a.survivor_id && t.created_at >= a.created_at);
  });
}

const assignmentRules: WakeRule = (c, w) => {
  if (c.table !== "assignment") return [];
  const a = c.row as Assignment;
  const o = c.old as Assignment | undefined;
  if (!w.survivor(a.survivor_id)) return [];
  if (c.op === "update" && o?.status === "proposed" && a.status === "active") {
    return [{ wake: { key: `nav:assignment:${a.id}`, kind: "nav", priority: "high", at: w.now(), note: `assignment #${a.id} accepted`, survivorId: a.survivor_id, assignmentId: a.id, chainId: a.chain_id } }];
  }
  if (c.op !== "insert" || a.status !== "proposed") return [];
  const leaseS = w.site()?.proposal_lease_s ?? 60;
  return [
    {
      afterMs: (leaseS * 1000) / 2,
      check: () => {
        const now = w.assignment(a.id);
        if (!now || now.status !== "proposed") return null;
        return { key: `nudge:assignment:${a.id}`, kind: "nudge", priority: "high", at: w.now(), note: `assignment #${a.id} still proposed at half the lease`, survivorId: a.survivor_id, assignmentId: a.id, chainId: a.chain_id };
      },
    },
    {
      afterMs: WATCHDOG_BRIEF_AFTER_MS,
      check: () => {
        const now = w.assignment(a.id);
        if (!now || now.status === "released" || now.status === "completed" || hasBriefTask(w, now)) return null;
        return { key: `watchdog_brief:assignment:${a.id}`, kind: "watchdog_brief", priority: "critical", at: w.now(), note: `assignment #${a.id} by ${a.created_by} has no brief_rescuer task`, survivorId: a.survivor_id, assignmentId: a.id, chainId: a.chain_id };
      },
    },
  ];
};

interface Target {
  survivor: Survivor;
  assignment: Assignment | null;
  rescuer: string;
}

function targetOf(w: World, input: CycleInput): Target | null {
  const t = input.task;
  const p = t ? parsePayload<Record<string, any>>(t.payload_json) ?? {} : {};
  const wk = input.wakes[0];
  const aid: number | undefined = p.assignment_id || wk?.assignmentId;
  const a = aid ? w.assignment(aid) ?? w.raw("assignment").find((x) => x.id === aid) ?? null : null;
  const sid: number | undefined = p.survivor_id ?? a?.survivor_id ?? wk?.survivorId;
  const s = sid ? w.survivor(sid) : null;
  if (!s) return null;
  const rescuer: string | undefined = p.rescuer_identity ?? a?.rescuer_identity;
  if (!rescuer) return null;
  return { survivor: s, assignment: a, rescuer: rescuer.toLowerCase() };
}

function terrainOf(w: World): { cls: string; conf: number; robot: string } | null {
  const r = w.robots().find((x) => x.online) ?? w.robots()[0];
  return r ? { cls: r.terrain_class, conf: r.terrain_confidence, robot: r.robot_id } : null;
}

export function commsPacket(w: World, input: CycleInput): string {
  const t = input.task;
  const tg = targetOf(w, input);
  const lines: string[] = [];
  const kind = t ? t.kind : input.wakes[0]?.kind ?? "wake";
  if (!tg) {
    lines.push(`TASK: ${kind}${t ? " #" + t.id : ""}, CHAIN ${input.chainId}`);
    lines.push(`FACTS: ${t?.payload_json ?? "none"}`);
    lines.push("Write one line for the audience the task names.");
    return lines.join("\n");
  }
  const cs = w.callsign(tg.rescuer);
  const s = tg.survivor;
  const head = kind === "nav" ? "NAVIGATION" : `TASK: ${kind}${t ? " #" + t.id : ""}`;
  lines.push(`${head} for ${cs}, assignment #${tg.assignment?.id ?? 0}, CHAIN ${input.chainId}`);
  const note = s.location_note ? `, ${s.location_note}` : "";
  lines.push(`SURVIVOR #${s.id}: ${survivorDisplay(w, s)}, ${w.placeOf(s)}${note}`);
  const near = w.rescuersNear(s.lat, s.lon, false).find((r) => r.identity === tg.rescuer);
  if (near?.distance_m != null) lines.push(`DISTANCE: ${near.distance_m} m ${near.compass} of ${cs}`);
  const tr = terrainOf(w);
  if (tr) lines.push(`TERRAIN (${tr.robot} latest): ${tr.cls} (${tr.conf.toFixed(1)})`);
  lines.push(kind === "nav" ? `${cs} accepted. Write one navigation line for ${cs}.` : `Write one briefing for ${cs}.`);
  return lines.join("\n");
}

async function sendTemplate(ctx: CycleCtx, audience: string, text: string, priority: BriefingPriority, survivorId: number, why: string): Promise<void> {
  await dispatch(ctx, "send_briefing", { reason: `[fallback] template ${why}`.slice(0, 140), audience, text, priority, survivor_id: survivorId }, "rules");
}

async function completeTask(ctx: CycleCtx, fallback: boolean): Promise<void> {
  const t = ctx.input.task;
  if (!t || ctx.state.taskCompleted) return;
  const b = ctx.state.lastBriefing;
  await ctx.board.complete(t.id, b ? "done" : "failed", {
    briefing_id: b?.briefing_id ?? null,
    text: b?.text ?? "",
    fallback,
    ...(ctx.input.stale ? { stale: true } : {}),
  });
  ctx.state.taskCompleted = true;
}

export function commsConfig(cfg: Config): AgentConfig {
  return {
    name: "comms_agent",
    role: "agent",
    model: cfg.MODEL_NANO,
    systemPrompt: COMMS_PROMPT,
    tools: COMMS_TOOLS,
    wakeRules: [tasksForMe, assignmentRules],
    timeoutMs: 6000,
    maxSteps: 2,
    maxToolCalls: 3,
    finalTools: ["send_briefing"],
    maxTokens: 512,
    mergeRowWakes: false,
    heartbeatMs: 10_000,
    buildWakePacket: (w, input) => commsPacket(w, input),
    useModel(ctx) {
      if (!cfg.ENABLE_COMMS_MODEL) return false;
      const t = ctx.input.task;
      // answer_rescuer by model is E8 and sitrep is E10; both use their templates until built.
      if (t && t.kind !== "brief_rescuer") return false;
      return !ctx.input.wakes.some((w) => TEMPLATE_ONLY.has(w.kind));
    },
    satisfied: (ctx) => ctx.state.lastBriefing != null || ctx.state.taskCompleted,
    finished(ctx) {
      if (!ctx.state.lastBriefing) return false;
      ctx.state.summary = `briefing sent to ${ctx.world.callsign(ctx.state.lastBriefing.audience)}`;
      return true;
    },
    async afterModel(ctx) {
      if (ctx.state.lastBriefing) await completeTask(ctx, false);
    },
    async fallback(ctx, why) {
      const w = ctx.world;
      const t = ctx.input.task;
      const kind = t ? t.kind : ctx.input.wakes[0]?.kind;
      if (kind === "sitrep") {
        ctx.state.summary = "[fallback] sitrep is not enabled in this build";
        return;
      }
      if (kind === "answer_rescuer") {
        if (!cfg.ENABLE_QUESTIONS) {
          ctx.state.summary = "[fallback] rescuer questions are switched off (ENABLE_QUESTIONS=0); coordinators answer by radio";
          return;
        }
        // E8 extension point: the model answer for answer_rescuer goes here; until then, the template.
        const p = parsePayload<Record<string, any>>(t!.payload_json) ?? {};
        const s = p.survivor_id ? w.survivor(p.survivor_id) : null;
        const cell = s?.cell_id ? w.cell(s.cell_id) : null;
        const place = s ? w.placeOf(s) : cell?.label ?? "site";
        const text = answerTemplate(place, cell?.found ?? 0, cell?.unaccounted ?? 0);
        if (p.rescuer_identity) await sendTemplate(ctx, String(p.rescuer_identity), text, "info", p.survivor_id ?? 0, `answer (${why})`);
        await completeTask(ctx, true);
        return;
      }
      const tg = targetOf(w, ctx.input);
      if (!tg) {
        ctx.state.summary = "[fallback] nothing to brief: survivor or rescuer not found";
        await completeTask(ctx, true);
        return;
      }
      const s = tg.survivor;
      const place = w.placeOf(s);
      if (kind === "nudge") {
        if (tg.assignment?.status !== "proposed" || ctx.memory.nudged.has(tg.assignment.id)) return;
        ctx.memory.nudged.add(tg.assignment.id);
        await sendTemplate(ctx, tg.rescuer, nudgeTemplate(s, place), "warning", s.id, "nudge");
        ctx.state.summary = `[fallback] nudge for assignment #${tg.assignment.id}`;
        return;
      }
      if (kind === "nav") {
        if (tg.assignment && ctx.memory.navSent.has(tg.assignment.id)) return;
        if (tg.assignment) ctx.memory.navSent.add(tg.assignment.id);
        await sendTemplate(ctx, tg.rescuer, navTemplate(s, place, terrainOf(w)?.cls ?? null), "info", s.id, `navigation hint (${why})`);
        ctx.state.summary = "[fallback] navigation hint";
        return;
      }
      if (kind === "watchdog_brief" && tg.assignment) {
        if (ctx.memory.watchdogBriefed.has(tg.assignment.id)) return;
        ctx.memory.watchdogBriefed.add(tg.assignment.id);
        // A brief_rescuer task may have arrived (and been worked) since the 5 s timer fired.
        const briefed = w.briefings().some((b) => b.audience === tg.rescuer && b.survivor_id === s.id && b.kind === "briefing" && b.created_at >= tg.assignment!.created_at);
        if (briefed || hasBriefTask(w, tg.assignment)) {
          ctx.state.summary = `assignment #${tg.assignment.id} already briefed`;
          return;
        }
      }
      const near = w.rescuersNear(s.lat, s.lon, false).find((r) => r.identity === tg.rescuer);
      const text = briefingTemplate(s, place, near?.distance_m ?? null, near?.compass ?? null);
      const prio: BriefingPriority = tierOf(s) === 0 ? "critical" : "warning";
      await sendTemplate(ctx, tg.rescuer, text, prio, s.id, `briefing (${why})`);
      ctx.state.summary = `[fallback] template briefing for #${s.id}`;
      await completeTask(ctx, true);
    },
  };
}
