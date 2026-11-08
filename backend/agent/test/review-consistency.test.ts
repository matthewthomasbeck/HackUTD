// The submit_review consistency guard (rules.ts reviewConsistency). The disagree cases are the
// ones real Nemotron Lightning produced in scenario --real chain runs on 2026-11-07.
import { describe, expect, it } from "vitest";
import { dispatch } from "../src/tools/dispatch.ts";
import { ctxFor, fakeWorld, RESCUER, survivorAt } from "./helpers.ts";

// fakeWorld: Rescuer A about 40 m from house 3, Rescuer B about 120 m.
function setup() {
  const { h } = fakeWorld();
  const sid = survivorAt(h, 3);
  h.module.proposeAssignment(h.identity("orchestrator"), sid, RESCUER.A, "IMMEDIATE, nearest");
  const t = h.store.rows("agent_task").find((x) => x.kind === "review")!;
  h.module.claimAgentTask(h.identity("auditor"), t.id);
  const task = h.store.get("agent_task", t.id)!;
  return { h, sid, ctx: ctxFor(h, "auditor", task) };
}

describe("review consistency guard", () => {
  it("rejects a disagree whose suggestion is the proposal itself", async () => {
    const { ctx, sid } = setup();
    const r = await dispatch(ctx, "submit_review", {
      verdict: "disagree",
      flag_kind: "proposal_disagree",
      reason: "Rescuer B is 120 m away while Rescuer A is 40 m away; assigning Rescuer A is reasonable",
      suggested_action: `Assign survivor #${sid} to Rescuer A, who is 40 m away; keep Rescuer B available.`,
    }, "m");
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).toMatch(/proposal itself/);
    expect(ctx.state.lastRejection).toMatch(/^submit_review: /);
  });

  it("rejects load_imbalance when the rescuer has no other assignment", async () => {
    const { ctx } = setup();
    const r = await dispatch(ctx, "submit_review", {
      verdict: "disagree",
      flag_kind: "load_imbalance",
      reason: "Rescuer A at 40 m and Rescuer B at 120 m both have 0 active assignments",
      suggested_action: "Split the work between Rescuer A and Rescuer B to balance the load.",
    }, "m");
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).toMatch(/no other active assignments/);
  });

  it("rejects swapping to a farther rescuer with no lighter load", async () => {
    const { ctx, sid } = setup();
    const r = await dispatch(ctx, "submit_review", {
      verdict: "disagree",
      flag_kind: "proposal_disagree",
      reason: "Rescuer B is free with 0 active assignments, 120 m away",
      suggested_action: `Assign survivor #${sid} to Rescuer B instead.`,
    }, "m");
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).toMatch(/not a better rescuer/);
  });

  it("accepts an agree, and a disagree that moves the rescuer to another survivor", async () => {
    const a = setup();
    expect((await dispatch(a.ctx, "submit_review", { verdict: "agree", reason: "Rescuer A is nearest at 40 m with 0 active assignments" }, "m")).ok).toBe(true);

    const b = setup();
    const r = await dispatch(b.ctx, "submit_review", {
      verdict: "disagree",
      flag_kind: "proposal_disagree",
      reason: "Survivor #9 is IMMEDIATE and unaccounted, 30 m from Rescuer A",
      suggested_action: "Send Rescuer A to survivor #9 first, then this one.",
    }, "m");
    expect(r.ok).toBe(true);
  });

  it("accepts a swap to a nearer free rescuer", async () => {
    const { h } = fakeWorld();
    const sid = survivorAt(h, 3);
    h.module.proposeAssignment(h.identity("orchestrator"), sid, RESCUER.B, "IMMEDIATE");
    const t = h.store.rows("agent_task").find((x) => x.kind === "review")!;
    h.module.claimAgentTask(h.identity("auditor"), t.id);
    const ctx = ctxFor(h, "auditor", h.store.get("agent_task", t.id)!);
    const r = await dispatch(ctx, "submit_review", {
      verdict: "disagree",
      flag_kind: "proposal_disagree",
      reason: "Rescuer A is free at 40 m, Rescuer B is 120 m away",
      suggested_action: `Assign survivor #${sid} to Rescuer A instead of Rescuer B.`,
    }, "m");
    expect(r.ok).toBe(true);
  });
});
