// Two fixes found by running the chain scenario on real Nemotron (scenario --real):
// the auditor's board shows the reviewed rescuer as before the proposal, and over-long review
// text is clipped instead of rejected.
import { describe, expect, it } from "vitest";
import { reviewChecks } from "../src/rules.ts";
import { clipText, dispatch } from "../src/tools/dispatch.ts";
import { ctxFor, fakeWorld, RESCUER, survivorAt } from "./helpers.ts";

function reviewTask(h: ReturnType<typeof fakeWorld>["h"]) {
  const t = h.store.rows("agent_task").find((x) => x.kind === "review")!;
  h.module.claimAgentTask(h.identity("auditor"), t.id);
  return h.store.get("agent_task", t.id)!;
}

describe("auditor board view during a review", () => {
  it("shows the rescuer holding the reviewed proposal as available, others unchanged", async () => {
    const { h } = fakeWorld();
    const sid = survivorAt(h, 3);
    h.module.proposeAssignment(h.identity("orchestrator"), sid, RESCUER.A, "IMMEDIATE, nearest");
    const task = reviewTask(h);
    const r = await dispatch(ctxFor(h, "auditor", task), "get_board", { reason: "check the proposal" }, "m");
    expect(r.ok).toBe(true);
    const rescuers = (r as { result: { rescuers: Array<Record<string, unknown>> } }).result.rescuers;
    const a = rescuers.find((x) => x.identity === RESCUER.A)!;
    expect(a).toMatchObject({ available: true, free: true, holding_proposal: null });
    expect(a.under_review).toBeTruthy();
    expect(rescuers.find((x) => x.identity === RESCUER.B)).toMatchObject({ available: true, holding_proposal: null });

    const o = await dispatch(ctxFor(h, "orchestrator"), "get_board", { reason: "board" }, "m");
    const ao = (o as { result: { rescuers: Array<Record<string, unknown>> } }).result.rescuers.find((x) => x.identity === RESCUER.A)!;
    expect(ao).toMatchObject({ available: false, free: false });
    expect(ao.holding_proposal).not.toBeNull();
  });
});

describe("reviewed assignment after the rescuer accepted", () => {
  it("does not count as the rescuer's load, on the board or in the rule checks", async () => {
    const { h } = fakeWorld();
    const sid = survivorAt(h, 3);
    h.module.proposeAssignment(h.identity("orchestrator"), sid, RESCUER.A, "IMMEDIATE, nearest");
    const aid = h.store.rows("assignment").find((a) => a.survivor_id === sid)!.id;
    h.module.acceptAssignment(RESCUER.A, aid);
    expect(h.store.get("assignment", aid)!.status).toBe("active");
    const task = reviewTask(h);
    const r = await dispatch(ctxFor(h, "auditor", task), "get_board", { reason: "check the proposal" }, "m");
    const a = (r as { result: { rescuers: Array<Record<string, unknown>> } }).result.rescuers.find((x) => x.identity === RESCUER.A)!;
    expect(a).toMatchObject({ active_assignments: 0, free: true });
    const c = reviewChecks(ctxFor(h, "auditor", task).world, { assignment_id: aid, survivor_id: sid, rescuer_identity: RESCUER.A } as never);
    expect(c.proposedActive).toBe(0);
  });
});

describe("submit_review text clipping", () => {
  it("clips at a word boundary and keeps short text as is", () => {
    expect(clipText("short reason", 200)).toBe("short reason");
    const long = "Rescuer A is 40 m W from survivor #1, has 0 active assignments, ".repeat(5);
    const c = clipText(long, 200);
    expect(c.length).toBeLessThanOrEqual(200);
    expect(c.endsWith("...")).toBe(true);
    expect(c).not.toMatch(/\s\.\.\.$/);
  });
  it("a 300-character review reason is accepted, clipped to 200", async () => {
    const { h } = fakeWorld();
    const sid = survivorAt(h, 3);
    h.module.proposeAssignment(h.identity("orchestrator"), sid, RESCUER.A, "IMMEDIATE, nearest");
    const task = reviewTask(h);
    const reason = "Rescuer A is 40 m W, has 0 active assignments, and no higher tier survivor waits; ".repeat(4);
    const r = await dispatch(ctxFor(h, "auditor", task), "submit_review", { verdict: "agree", reason }, "m");
    expect(r.ok).toBe(true);
    const done = h.store.get("agent_task", task.id)!;
    expect(JSON.parse(done.result_json!).reason.length).toBeLessThanOrEqual(200);
  });
  it("a long reason on any tool is clipped to 140", async () => {
    const { h } = fakeWorld();
    const r = await dispatch(ctxFor(h, "orchestrator"), "get_board", { reason: "because ".repeat(40) }, "m");
    expect(r.ok).toBe(true);
    const act = h.store.rows("agent_action").find((x) => x.tool === "get_board")!;
    expect(act.reason.length).toBeLessThanOrEqual(140);
  });
  it("briefings are still rejected over 120 characters", async () => {
    const { h } = fakeWorld();
    const sid = survivorAt(h, 3);
    const r = await dispatch(ctxFor(h, "comms_agent"), "send_briefing", { audience: RESCUER.A, kind: "briefing", survivor_id: sid, text: "x".repeat(121), reason: "brief" }, "m");
    expect(r.ok).toBe(false);
  });
});
