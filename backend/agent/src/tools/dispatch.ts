// Every tool call, in order (agent.md 5.7): validate with ajv, check the allow list, run the
// guard on fresh data, execute, log_agent_action, and a full trace line. Rejected calls are logged too.

import { Ajv, type ValidateFunction } from "ajv";
import type { CycleCtx } from "../agent-types.ts";
import { stringsIn } from "../board.ts";
import {
  ALREADY_BY_WATCHDOG,
  DEATH_WORDS,
  guardCancelOwnMission,
  guardCreateMission,
  guardDelegate,
  guardProposeAssignment,
  guardSendBriefing,
  guardSetFlagStatus,
  guardSubmitReview,
  marksProposalStuck,
  textProblem,
} from "../guards.ts";
import { boundedJson, safeJson } from "../log.ts";
import { survivorChain } from "../chain.ts";
import { reviewConsistency, type ReviewPayload } from "../rules.ts";
import { parsePayload } from "../world.ts";
import * as reads from "./reads.ts";
import { SCHEMAS, type ToolName } from "./schemas.ts";
import * as writes from "./writes.ts";

type Args = Record<string, any>;

export interface ToolResult {
  ok: boolean;
  result?: unknown;
  error?: string;
}

/** Free-text fields clipped (at a word boundary) instead of rejected: every tool's short "reason"
 * (140) and the auditor's review text. On real Nemotron the models wrote sound reasons of 150 to
 * 300 characters, and with 2 to 4 requests per cycle a rejection usually meant the fallback.
 * Briefing text (send_briefing.text) stays strict: G2 rejects it so the model shortens it. */
const REASON_MAX = 140;
const CLIP_FIELDS: Partial<Record<ToolName, Record<string, number>>> = {
  submit_review: { reason: 200, suggested_action: 140 },
};

export function clipText(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 3);
  const space = cut.lastIndexOf(" ");
  return (space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:.]+$/, "") + "...";
}

/** The assignment a review task is about (its payload's assignment_id), else null. */
function reviewedAssignment(c: CycleCtx): number | null {
  const t = c.input.task;
  if (!t || t.kind !== "review") return null;
  try {
    const id = Number(JSON.parse(t.payload_json)?.assignment_id);
    return Number.isFinite(id) && id > 0 ? id : null;
  } catch {
    return null;
  }
}

const READ_TOOLS = new Set<string>(["get_board", "get_survivor", "list_rescuers", "list_cells", "get_robot"]);

interface ToolImpl {
  guard?: (ctx: CycleCtx, a: Args) => string | null;
  run: (ctx: CycleCtx, a: Args) => Promise<unknown> | unknown;
}

const IMPL: Record<ToolName, ToolImpl> = {
  get_board: { run: (c) => reads.getBoard(c.world, c.agent.name === "auditor" ? reviewedAssignment(c) : null) },
  get_survivor: { run: (c, a) => reads.getSurvivor(c.world, a) },
  list_rescuers: { run: (c, a) => reads.listRescuers(c.world, a) },
  list_cells: { run: (c, a) => reads.listCells(c.world, a) },
  get_robot: { run: (c, a) => reads.getRobot(c.world, a) },
  propose_assignment: { guard: guardProposeAssignment, run: writes.proposeAssignment },
  delegate: { guard: guardDelegate, run: writes.delegate },
  set_flag_status: { guard: guardSetFlagStatus, run: writes.setFlagStatus },
  create_mission: { guard: guardCreateMission, run: writes.createMission },
  cancel_own_mission: { guard: guardCancelOwnMission, run: writes.cancelOwnMission },
  send_briefing: { guard: guardSendBriefing, run: writes.sendBriefing },
  submit_review: {
    guard: (c, a) => {
      const g = guardSubmitReview(c, a);
      if (g) return g;
      const payload = parsePayload<ReviewPayload>(c.input.task?.payload_json ?? "");
      return payload && payload.assignment_id && payload.rescuer_identity ? reviewConsistency(c.world, payload, a) : null;
    },
    run: writes.submitReview,
  },
};

const ajv = new Ajv({ allErrors: true, useDefaults: true });
const validators = new Map<string, ValidateFunction>(
  (Object.keys(SCHEMAS) as ToolName[]).map((n) => [n, ajv.compile(SCHEMAS[n].parameters)]),
);

/**
 * chain_id for one call: the survivor's chain when the call names a survivor or an assignment,
 * else the cycle's chain (a task's chain always wins, agent.md 5.5).
 */
export function chainFor(ctx: CycleCtx, a: Args): number {
  if (ctx.input.task) return ctx.input.chainId;
  const w = ctx.world;
  if (a.survivor_id) return survivorChain(w, a.survivor_id) || ctx.input.chainId;
  if (a.assignment_id) {
    const x = w.raw("assignment").find((r) => r.id === a.assignment_id);
    if (x?.chain_id) return x.chain_id;
  }
  if (a.flag_id) {
    const f = w.raw("audit_flag").find((r) => r.id === a.flag_id);
    const x = f?.entity === "assignment" ? w.raw("assignment").find((r) => r.id === f.entity_id) : null;
    if (x?.chain_id) return x.chain_id;
  }
  return ctx.input.chainId;
}

export function clip(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 3) + "...";
}

/** Summary for agent_action.result (at most 300 characters): "ok: ..." or "error: ...". */
export function resultSummary(r: ToolResult): string {
  if (!r.ok) return clip(`error: ${r.error ?? "failed"}`, 300);
  const v = r.result as Record<string, unknown> | undefined;
  let s = "ok";
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const keys = Object.keys(v).filter((k) => k !== "ok" && ["string", "number", "boolean"].includes(typeof v[k]));
    if (keys.length) s += ": " + keys.slice(0, 6).map((k) => `${k}=${v[k]}`).join(" ");
  } else if (Array.isArray(v)) s += `: ${v.length} rows`;
  return clip(s, 300);
}

/** The module's forbidden labels (config.ts FORBIDDEN_PATTERN) plus our wider G2 list. */
const LOG_FORBIDDEN = new RegExp(`${DEATH_WORDS.source}|\\bdeceas\\w*|\\bbody\\s+recovery\\b`, "gi");

/**
 * Text as log_agent_action accepts it: a rejected call can quote a forbidden word (that is why it
 * was rejected), and the module refuses to store any, so the word is replaced in the logged copy.
 * The replacement has no quote or backslash, so JSON text stays valid.
 */
export function logSafeText(s: string): string {
  return s.replace(LOG_FORBIDDEN, "[word removed]");
}

/** args_json for log_agent_action: valid JSON, at most 1000 characters (the module allows 4000), no forbidden word. */
export function logArgsJson(args: unknown): string {
  let value: unknown;
  try {
    value = JSON.parse(logSafeText(safeJson(args)));
  } catch {
    value = "<unserializable>";
  }
  return boundedJson(value, 1000);
}

/**
 * log_agent_action from the agent's own connection, plus the trace line. Never throws, never loops.
 * Every field is made acceptable to the reducer (valid bounded JSON, a non-empty reason, names of
 * at most 40 characters), so every action reaches the Agents panel.
 */
export async function logAction(
  ctx: CycleCtx,
  tool: string,
  args: unknown,
  result: string,
  reason: string,
  model: string,
  extraTrace: Record<string, unknown> = {},
): Promise<void> {
  const argsJson = logArgsJson(args);
  const why = clip(logSafeText(reason || "").trim() || "(no reason given)", 140);
  const toolName = clip(tool || "unknown", 40);
  const modelName = clip(model || "unknown", 40);
  try {
    await ctx.actions.logAgentAction(toolName, argsJson, clip(logSafeText(result), 300), why, ctx.state.step, modelName, ctx.state.callChain ?? ctx.input.chainId);
  } catch (err) {
    ctx.deps.log.error(ctx.agent.name, `log_agent_action failed: ${(err as Error).message}`);
    ctx.deps.log.traceLine({ agent: ctx.agent.name, event: "log_failed", tool, error: (err as Error).message });
  }
  ctx.deps.log.traceLine({
    agent: ctx.agent.name,
    model,
    step: ctx.state.step,
    chain_id: ctx.state.callChain ?? ctx.input.chainId,
    tool,
    args,
    result,
    reason,
    dry_run: ctx.deps.dryRun,
    ...extraTrace,
  });
}

function safeChain(ctx: CycleCtx, a: Args): number {
  try {
    return chainFor(ctx, a);
  } catch {
    return ctx.input.chainId;
  }
}

export async function dispatch(ctx: CycleCtx, name: string, rawArgs: unknown, model: string): Promise<ToolResult> {
  const t0 = ctx.deps.clock.now();
  let args: Args = {};
  let res: ToolResult;
  ctx.state.callChain = null;
  try {
    if (typeof rawArgs === "string") {
      try {
        args = rawArgs.trim() ? JSON.parse(rawArgs) : {};
      } catch {
        throw new Error("invalid arguments: not JSON");
      }
    } else if (rawArgs && typeof rawArgs === "object") args = { ...(rawArgs as Args) };
    for (const [field, max] of Object.entries({ reason: REASON_MAX, ...(CLIP_FIELDS[name as ToolName] ?? {}) })) {
      if (typeof args[field] === "string") args[field] = clipText(args[field] as string, max);
    }
    const v = validators.get(name);
    if (!v || !(name in IMPL)) throw new Error("unknown tool");
    if (!v(args)) throw new Error("invalid arguments: " + ajv.errorsText(v.errors));
    if (!ctx.agent.tools.includes(name as ToolName)) throw new Error("unknown tool");
    if (ctx.state.toolCalls >= ctx.agent.maxToolCalls) throw new Error("tool call limit for this cycle reached");
    // G2 on every piece of free text in the call.
    for (const s of stringsIn(args)) {
      const p = textProblem(s);
      if (p) throw new Error(p);
    }
    const impl = IMPL[name as ToolName];
    const g = impl.guard?.(ctx, args) ?? null;
    if (g) throw new Error(g);
    ctx.state.toolCalls++;
    ctx.state.callChain = chainFor(ctx, args);
    const result = await impl.run(ctx, args);
    res = { ok: true, result };
  } catch (err) {
    res = { ok: false, error: (err as Error).message };
    if (!READ_TOOLS.has(name)) ctx.state.lastRejection = `${name}: ${res.error}`;
  }
  const summary = resultSummary(res);
  if (name === "propose_assignment" && typeof args.survivor_id === "number") {
    if (res.ok) ctx.memory.proposalRejected.delete(args.survivor_id);
    else if (marksProposalStuck(res.error ?? "")) ctx.memory.proposalRejected.set(args.survivor_id, { at: ctx.world.now(), error: clip(res.error ?? "failed", 80) });
  }
  if (!res.ok && res.error === ALREADY_BY_WATCHDOG) ctx.deps.log.info(ctx.agent.name, `survivor #${args.survivor_id}: ${ALREADY_BY_WATCHDOG}`);
  ctx.deps.log.info(ctx.agent.name, `${name} -> ${summary}`);
  if (ctx.state.callChain == null) ctx.state.callChain = safeChain(ctx, args);
  await logAction(ctx, name, args, summary, String(args.reason ?? ""), model, {
    full_result: res,
    latency_ms: ctx.deps.clock.now() - t0,
  });
  ctx.state.callChain = null;
  return res;
}
