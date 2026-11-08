// Every tool call, in order (agent.md 5.7): validate with ajv, check the allow list, run the
// guard on fresh data, execute, log_agent_action, and a full trace line. Rejected calls are logged too.

import { Ajv, type ValidateFunction } from "ajv";
import type { CycleCtx } from "../agent-types.ts";
import { stringsIn } from "../board.ts";
import {
  ALREADY_BY_WATCHDOG,
  guardCancelOwnMission,
  guardCreateMission,
  guardDelegate,
  guardProposeAssignment,
  guardSendBriefing,
  guardSetFlagStatus,
  guardSubmitReview,
  textProblem,
} from "../guards.ts";
import { safeJson } from "../log.ts";
import { survivorChain } from "../chain.ts";
import * as reads from "./reads.ts";
import { SCHEMAS, type ToolName } from "./schemas.ts";
import * as writes from "./writes.ts";

type Args = Record<string, any>;

export interface ToolResult {
  ok: boolean;
  result?: unknown;
  error?: string;
}

interface ToolImpl {
  guard?: (ctx: CycleCtx, a: Args) => string | null;
  run: (ctx: CycleCtx, a: Args) => Promise<unknown> | unknown;
}

const IMPL: Record<ToolName, ToolImpl> = {
  get_board: { run: (c) => reads.getBoard(c.world) },
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
  submit_review: { guard: guardSubmitReview, run: writes.submitReview },
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

/**
 * log_agent_action from the agent's own connection, plus the trace line. Never throws, never loops.
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
  const argsJson = clip(safeJson(args), 1000);
  const why = clip(reason || "", 140);
  try {
    await ctx.actions.logAgentAction(tool, argsJson, clip(result, 300), why, ctx.state.step, model, ctx.state.callChain ?? ctx.input.chainId);
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
  }
  const summary = resultSummary(res);
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
