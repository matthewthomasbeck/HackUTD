// Auditor (agent.md 7.4): reviews every orchestrator and watchdog proposal through a review task.
// It judges proposal quality only. The rule checks from rules.ts go into the wake packet, and the
// same checks are the fallback verdict (ENABLE_AUDITOR_MODEL=0, model down, or a missed deadline).

import type { AgentConfig, CycleCtx, CycleInput, WakeRule } from "../agent-types.ts";
import type { Config } from "../config.ts";
import { levelWord } from "../priority.ts";
import { reviewChecks, ruleChecksLine, rulesVerdict, type ReviewPayload } from "../rules.ts";
import { logAction } from "../tools/dispatch.ts";
import type { ToolName } from "../tools/schemas.ts";
import type { AgentTask } from "../types.ts";
import { parseJson, type World } from "../world.ts";
import { AUDITOR_PROMPT } from "./prompts.ts";

export const AUDITOR_TOOLS: ToolName[] = ["get_board", "get_survivor", "list_rescuers", "submit_review"];

const reviewTasks: WakeRule = (c, w, self) => {
  if (c.table !== "agent_task" || c.op === "delete") return [];
  const t = c.row as AgentTask;
  const o = c.old as AgentTask | undefined;
  if (t.to_agent !== self || t.status !== "open" || (o && o.status === t.status)) return [];
  return [{ wake: { key: `task:agent_task:${t.id}`, kind: "task", priority: t.priority, at: w.now(), note: `${t.kind} #${t.id}`, task: t, chainId: t.chain_id } }];
};

function payloadOf(t: AgentTask | null): ReviewPayload | null {
  if (!t) return null;
  const p = parseJson<ReviewPayload>(t.payload_json);
  return p && p.assignment_id && p.survivor_id && p.rescuer_identity ? p : null;
}

/** The orchestrator's reason: the payload's, or the logged propose_assignment action's. */
function proposalReason(w: World, p: ReviewPayload): string {
  if (p.reason) return p.reason;
  const act = [...w.actions()]
    .reverse()
    .find((a) => a.tool === "propose_assignment" && a.args_json.includes(`"survivor_id":${p.survivor_id}`) && a.result.startsWith("ok"));
  return act?.reason ?? "none given";
}

export function auditorPacket(w: World, input: CycleInput): string {
  const t = input.task;
  const p = payloadOf(t);
  if (!t || !p) return `TASK: ${t?.kind ?? "review"} #${t?.id ?? 0}, CHAIN ${input.chainId}\nPAYLOAD: ${t?.payload_json ?? "none"}\nReview the proposal.`;
  const c = reviewChecks(w, p);
  const s = c.survivor;
  const by = t.from_agent === "module" ? " (database watchdog proposal)" : "";
  const lines = [
    `TASK: review #${t.id}, CHAIN ${input.chainId}`,
    `PROPOSAL: assignment #${p.assignment_id}, survivor #${p.survivor_id} (${s ? `${levelWord(s)}, score ${Math.round(s.critical_score)}` : "not found"}) to ${c.callsign}${by}`,
    `ORCHESTRATOR REASON: "${proposalReason(w, p)}"`,
    `RULE CHECKS (code): ${ruleChecksLine(c)}`,
    `OTHER UNASSIGNED: ${
      c.otherUnassigned.length
        ? c.otherUnassigned
            .map((o) => `#${o.survivor.id} ${levelWord(o.survivor)} ${w.placeOf(o.survivor)}${o.distance_m != null ? `, ${o.distance_m} m from ${c.callsign}` : ""}`)
            .join("; ")
        : "none"
    }`,
    "Review the proposal.",
  ];
  return lines.join("\n");
}

async function rulesReview(ctx: CycleCtx, why: string): Promise<void> {
  const t = ctx.input.task;
  if (!t || ctx.state.taskCompleted) return;
  const p = payloadOf(t);
  if (!p) {
    await ctx.board.complete(t.id, "failed", { verdict: "agree", reason: "rules check only: review payload unreadable", fallback: true });
    ctx.state.taskCompleted = true;
    return;
  }
  const v = rulesVerdict(reviewChecks(ctx.world, p));
  const reason = `[fallback] ${v.reason}`.slice(0, 200);
  const result: Record<string, unknown> = { verdict: v.verdict, reason, suggested_action: v.suggested_action, fallback: true };
  if (v.flag_kind) result.flag_kind = v.flag_kind;
  if (ctx.input.stale) result.stale = true;
  let outcome = "ok";
  try {
    await ctx.board.complete(t.id, "done", result);
    ctx.state.taskCompleted = true;
  } catch (err) {
    outcome = `error: ${(err as Error).message}`;
  }
  await logAction(ctx, "submit_review", { verdict: v.verdict, flag_kind: v.flag_kind, why }, `${outcome}: ${v.verdict}`, reason, "rules");
  ctx.state.summary = `[fallback] rules verdict ${v.verdict} (${why})`;
}

export function auditorConfig(cfg: Config): AgentConfig {
  return {
    name: "auditor",
    role: "auditor",
    model: cfg.MODEL_NANO,
    systemPrompt: AUDITOR_PROMPT,
    tools: AUDITOR_TOOLS,
    wakeRules: [reviewTasks],
    timeoutMs: 10_000,
    maxSteps: 2,
    maxToolCalls: 3,
    maxTokens: 512,
    mergeRowWakes: false,
    heartbeatMs: 10_000,
    buildWakePacket: (w, input) => auditorPacket(w, input),
    useModel: (ctx) => cfg.ENABLE_AUDITOR_MODEL && ctx.input.task?.kind === "review",
    satisfied: (ctx) => ctx.state.taskCompleted,
    finished(ctx) {
      if (!ctx.state.taskCompleted) return false;
      ctx.state.summary = "review submitted";
      return true;
    },
    fallback: (ctx, why) => rulesReview(ctx, why),
  };
}
