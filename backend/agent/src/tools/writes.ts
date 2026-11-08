// Write tools: each maps to one reducer through Actions (agent.md 7.2 to 7.4).
// If the module's argument lists differ from the contract, only stdb/connect.ts changes.

import type { CycleCtx } from "../agent-types.ts";
import type { Clock } from "../clock.ts";
import { delegateAssignment } from "../guards.ts";
import type { Assignment, BriefingKind, Change, TableName, TableRows } from "../types.ts";
import { parsePayload, type World } from "../world.ts";

type Args = Record<string, any>;

export const ROW_WAIT_MS = 2000;
export const BRIEFING_GAP_MS = 3000;

/** Wait for a row to appear in the cache (a reducer may resolve before its row arrives), at most ms. */
export function waitForRow<T extends TableName>(
  w: World,
  clock: Clock,
  table: T,
  pred: (r: TableRows[T]) => boolean,
  ms = ROW_WAIT_MS,
): Promise<TableRows[T] | null> {
  const hit = w.raw(table).find(pred);
  if (hit) return Promise.resolve(hit);
  if (ms <= 0) return Promise.resolve(null);
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: TableRows[T] | null) => {
      if (done) return;
      done = true;
      off();
      clock.clearTimeout(h);
      resolve(v);
    };
    const off = w.onChange((c: Change) => {
      if (c.table === table && c.op !== "delete" && pred(c.row as TableRows[T])) finish(c.row as TableRows[T]);
    });
    const h = clock.setTimeout(() => finish(w.raw(table).find(pred) ?? null), ms);
  });
}

/** The chain of the call being dispatched. */
export function callChain(ctx: CycleCtx): number {
  return ctx.state.callChain ?? ctx.input.chainId;
}

function dry(ctx: CycleCtx, extra: Record<string, unknown> = {}) {
  return { ok: true, dry_run: true, ...extra };
}

export async function proposeAssignment(ctx: CycleCtx, a: Args) {
  const w = ctx.world;
  const hex = String(a.rescuer_identity).toLowerCase();
  await ctx.actions.proposeAssignment(a.survivor_id, hex, a.reason);
  ctx.memory.proposals.set(a.survivor_id, w.now());
  const row = await waitForRow(
    w,
    ctx.deps.clock,
    "assignment",
    (x: Assignment) => x.survivor_id === a.survivor_id && x.rescuer_identity === hex && x.status === "proposed" && x.created_by === "orchestrator",
    ctx.deps.dryRun === "0" ? ROW_WAIT_MS : 0,
  );
  ctx.state.proposals.push({ survivor_id: a.survivor_id, rescuer_identity: hex, assignment_id: row?.id ?? null });
  if (row && ctx.deps.dryRun === "0") scheduleReviewCheck(ctx, row);
  if (ctx.deps.dryRun !== "0") return dry(ctx, { assignment_id: row?.id ?? null });
  return { ok: true, assignment_id: row?.id ?? null, rescuer: w.callsign(hex) };
}

/**
 * The module posts the review task inside propose_assignment. If none appears within 2 s, post one
 * ourselves (our fallback, not in agent.md), so there is never a second review.
 */
function scheduleReviewCheck(ctx: CycleCtx, x: Assignment): void {
  const { clock, log } = ctx.deps;
  const w = ctx.world;
  const hasReview = () =>
    w.raw("agent_task").some((t) => t.kind === "review" && parsePayload<{ assignment_id?: number }>(t.payload_json)?.assignment_id === x.id);
  waitForRow(w, clock, "agent_task", (t) => t.kind === "review" && parsePayload<{ assignment_id?: number }>(t.payload_json)?.assignment_id === x.id).then(
    async (found) => {
      if (found || hasReview()) return;
      const s = w.survivor(x.survivor_id);
      const payload = {
        assignment_id: x.id,
        survivor_id: x.survivor_id,
        rescuer_identity: x.rescuer_identity,
        // Same shape as the module's review payload: metres to one decimal, null when unknown.
        distance_m: ((d) => (d == null ? null : Math.round(d * 10) / 10))(w.distanceM(x.rescuer_identity, x.survivor_id)),
        critical_level: s?.critical_level ?? "unknown",
        reason: "[fallback] module posted no review within 2 s",
      };
      try {
        await ctx.board.post("auditor", "review", payload, s && w.tier(s) === 0 ? "critical" : "high", payload.reason, x.chain_id || callChain(ctx));
        log.warn(ctx.agent.name, `no review task for assignment #${x.id} after 2 s; posted one`);
      } catch (err) {
        log.error(ctx.agent.name, `fallback review post failed: ${(err as Error).message}`);
      }
    },
  );
}

export async function delegate(ctx: CycleCtx, a: Args) {
  const d = delegateAssignment(ctx, a);
  if (typeof d === "string") throw new Error(d);
  const payload = {
    chain_id: callChain(ctx),
    assignment_id: d.assignment_id,
    survivor_id: d.survivor_id,
    rescuer_identity: d.rescuer_identity,
    why: String(a.reason).slice(0, 140),
  };
  await ctx.board.post("comms_agent", "brief_rescuer", payload, a.priority, a.reason, callChain(ctx));
  ctx.state.delegatedSurvivors.add(d.survivor_id);
  if (ctx.deps.dryRun !== "0") return dry(ctx);
  return { ok: true, assignment_id: d.assignment_id };
}

export async function setFlagStatus(ctx: CycleCtx, a: Args) {
  await ctx.actions.setAuditFlagStatus(a.flag_id, a.status);
  return ctx.deps.dryRun !== "0" ? dry(ctx) : { ok: true };
}

export async function createMission(ctx: CycleCtx, a: Args) {
  await ctx.actions.createMission(
    a.robot_id,
    a.kind,
    a.target_cell_ids ?? [],
    a.target_lat ?? null,
    a.target_lon ?? null,
    a.reason,
    callChain(ctx),
  );
  if (ctx.deps.dryRun !== "0") return dry(ctx);
  const m = await waitForRow(
    ctx.world,
    ctx.deps.clock,
    "mission",
    (x) => x.created_by === ctx.agent.name && x.robot_id === a.robot_id && x.kind === a.kind && x.reason === a.reason,
  );
  return { ok: true, mission_id: m?.id ?? null, status: m?.status ?? null };
}

export async function cancelOwnMission(ctx: CycleCtx, a: Args) {
  await ctx.actions.cancelOwnMission(a.mission_id);
  return ctx.deps.dryRun !== "0" ? dry(ctx) : { ok: true };
}

export function briefingKind(ctx: CycleCtx): BriefingKind {
  const t = ctx.input.task;
  if (t?.kind === "answer_rescuer") return "answer";
  if (t) return "briefing";
  const k = ctx.input.wakes[0]?.kind;
  if (k === "nav") return "nav";
  if (k === "nudge") return "nudge";
  return "briefing";
}

export async function sendBriefing(ctx: CycleCtx, a: Args) {
  const task = ctx.input.task;
  const payload = task ? parsePayload<Record<string, any>>(task.payload_json) ?? {} : {};
  const audience = String(a.audience).toLowerCase();
  const sid: number = a.survivor_id ?? payload.survivor_id ?? ctx.input.wakes[0]?.survivorId ?? 0;
  // The module allows one briefing per 3 s per (created_by, audience); wait out the gap instead of failing.
  const last = ctx.world
    .raw("briefing")
    .filter((b) => b.created_by === ctx.agent.name && b.audience === audience)
    .reduce((m, b) => Math.max(m, b.created_at), 0);
  const wait = last ? BRIEFING_GAP_MS - (ctx.world.now() - last) : 0;
  if (wait > 0) await ctx.deps.clock.sleep(wait + 50);
  await ctx.actions.postBriefing(audience, a.text, a.priority, sid, briefingKind(ctx));
  const now = ctx.world.now();
  ctx.memory.briefings.set(`${audience}|${a.text}`, now);
  ctx.state.briefingsSent++;
  let id: number | null = null;
  if (ctx.deps.dryRun === "0") {
    const b = await waitForRow(ctx.world, ctx.deps.clock, "briefing", (x) => x.audience === audience && x.text === a.text && x.created_by === ctx.agent.name);
    id = b?.id ?? null;
  }
  ctx.state.lastBriefing = { text: a.text, audience, briefing_id: id };
  return ctx.deps.dryRun !== "0" ? dry(ctx) : { ok: true, briefing_id: id };
}

export async function submitReview(ctx: CycleCtx, a: Args) {
  const task = ctx.input.task!;
  const result: Record<string, unknown> = {
    verdict: a.verdict,
    reason: a.reason,
    suggested_action: a.suggested_action ?? "",
    fallback: false,
  };
  if (a.verdict === "disagree") result.flag_kind = a.flag_kind ?? "proposal_disagree";
  await ctx.board.complete(task.id, "done", result);
  ctx.state.taskCompleted = true;
  return ctx.deps.dryRun !== "0" ? dry(ctx) : { ok: true };
}
