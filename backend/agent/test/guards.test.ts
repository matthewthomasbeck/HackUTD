import { describe, expect, it } from "vitest";
import { briefingProblem, redactForModel, redactNames, resolveCallsigns, textProblem } from "../src/guards.ts";
import { dispatch } from "../src/tools/dispatch.ts";
import { ctxFor, fakeWorld, postAndClaim, RESCUER, survivorAt } from "./helpers.ts";

describe("text guards (G2, G5)", () => {
  it('rejects "possibly dead" and other death words, passes the allowed wording', () => {
    expect(textProblem("possibly dead under the slab")).toMatch(/forbidden/);
    expect(textProblem("no pulse found")).toMatch(/forbidden/);
    expect(textProblem("no signs of life detected, low confidence")).toBeNull();
  });
  it("rejects a 121-character briefing with its length, passes 120", () => {
    expect(briefingProblem("x".repeat(121))).toMatch(/121 characters/);
    expect(briefingProblem("x".repeat(120))).toBeNull();
  });
  it('rejects "rescued", "safe now", non-ASCII, and line breaks in briefings', () => {
    expect(briefingProblem("house 3 rescued")).toMatch(/only a person/);
    expect(briefingProblem("they are safe now")).toMatch(/only a person/);
    expect(briefingProblem("café entrance")).toMatch(/ASCII/);
    expect(briefingProblem("a\nb c")).toMatch(/one line/);
  });
});

describe("G8: names never reach a model", () => {
  it("replaces rescuer names with callsigns", () => {
    const { h } = fakeWorld();
    const ctx = ctxFor(h, "orchestrator");
    expect(redactNames("Ana Lopez is closer than Ben Okafor", ctx.world)).toBe("Rescuer A is closer than Rescuer B");
  });
  it("replaces rescuer identity hex with callsigns, in any case", () => {
    const { h } = fakeWorld();
    const ctx = ctxFor(h, "orchestrator");
    const out = redactForModel(`assign ${RESCUER.A} or ${RESCUER.B.toUpperCase()}`, ctx.world);
    expect(out).toBe("assign Rescuer A or Rescuer B");
    expect(out).not.toMatch(/[0-9a-f]{64}/i);
  });
  it("maps callsigns in rescuer_identity and audience back to hex, from objects and JSON strings", () => {
    const { h } = fakeWorld();
    const ctx = ctxFor(h, "orchestrator");
    expect(resolveCallsigns({ reason: "r", survivor_id: 1, rescuer_identity: "rescuer a" }, ctx.world)).toEqual({ reason: "r", survivor_id: 1, rescuer_identity: RESCUER.A });
    expect(resolveCallsigns(JSON.stringify({ audience: "Rescuer B", text: "go" }), ctx.world)).toEqual({ audience: RESCUER.B, text: "go" });
    expect(resolveCallsigns({ audience: "coordinators" }, ctx.world)).toEqual({ audience: "coordinators" });
    expect(resolveCallsigns("{not json", ctx.world)).toBe("{not json");
  });
});

describe("tool guards", () => {
  it("comms agent calling propose_assignment is an unknown tool", async () => {
    const { h } = fakeWorld();
    const sid = survivorAt(h, 3);
    const r = await dispatch(ctxFor(h, "comms_agent"), "propose_assignment", { reason: "try it", survivor_id: sid, rescuer_identity: RESCUER.A }, "m");
    expect(r).toEqual({ ok: false, error: "unknown tool" });
    expect(h.store.rows("assignment").length).toBe(0);
    // Rejected calls are logged too.
    expect(h.store.rows("agent_action").some((a) => a.tool === "propose_assignment" && a.result === "error: unknown tool")).toBe(true);
  });

  it("invalid arguments are rejected by ajv", async () => {
    const { h } = fakeWorld();
    const r = await dispatch(ctxFor(h, "orchestrator"), "propose_assignment", { reason: "x", survivor_id: 1, rescuer_identity: "zz" }, "m");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/invalid arguments/);
  });

  it("propose_assignment passes for the nearest available rescuer, and a second proposal is rejected", async () => {
    const { h } = fakeWorld();
    const sid = survivorAt(h, 3);
    const ctx = ctxFor(h, "orchestrator");
    const ok = await dispatch(ctx, "propose_assignment", { reason: "IMMEDIATE, Rescuer A nearest at 40 m", survivor_id: sid, rescuer_identity: RESCUER.A }, "m");
    expect(ok.ok).toBe(true);
    const again = await dispatch(ctx, "propose_assignment", { reason: "IMMEDIATE, try B too", survivor_id: sid, rescuer_identity: RESCUER.B }, "m");
    expect(again.ok).toBe(false);
    expect(again.error).toMatch(/already has proposed assignment/);
  });

  it("a delayed survivor proposed while a tier 0 survivor waits is rejected, naming it", async () => {
    const { h } = fakeWorld();
    const delayed = survivorAt(h, 2, { level: "delayed", score: 90 });
    const urgent = survivorAt(h, 3, { breathing: "not_detected", level: "immediate", score: 10 });
    const r = await dispatch(ctxFor(h, "orchestrator"), "propose_assignment", { reason: "first come first served", survivor_id: delayed, rescuer_identity: RESCUER.A }, "m");
    expect(r.ok).toBe(false);
    expect(r.error).toContain(`#${urgent}`);
  });

  it("a much farther rescuer needs a reason that says why", async () => {
    const { h } = fakeWorld();
    const sid = survivorAt(h, 3);
    const ctx = ctxFor(h, "orchestrator");
    const weak = await dispatch(ctx, "propose_assignment", { reason: "Rescuer B is available", survivor_id: sid, rescuer_identity: RESCUER.B }, "m");
    expect(weak.error).toMatch(/over 50% closer/);
    const why = await dispatch(ctx, "propose_assignment", { reason: "B because A is about to be sent to house 5", survivor_id: sid, rescuer_identity: RESCUER.B }, "m");
    expect(why.ok).toBe(true);
  });

  it("the watchdog's proposal makes the orchestrator skip with 'already proposed by watchdog'", async () => {
    const { h } = fakeWorld();
    const sid = survivorAt(h, 3);
    h.module.proposeAssignment("module", sid, RESCUER.A, "watchdog: test");
    const r = await dispatch(ctxFor(h, "orchestrator"), "propose_assignment", { reason: "IMMEDIATE, B as well", survivor_id: sid, rescuer_identity: RESCUER.B }, "m");
    expect(r.error).toBe("already proposed by watchdog");
  });

  it("a search_cells mission on a searched cell is rejected; on an unsearched cell it passes", async () => {
    const { h, cells } = fakeWorld();
    h.store.update("search_cell", { ...cells[0], status: "searched" });
    const ctx = ctxFor(h, "orchestrator");
    const bad = await dispatch(ctx, "create_mission", { reason: "search house 1", robot_id: "dog1", kind: "search_cells", target_cell_ids: [cells[0].id] }, "m");
    expect(bad.error).toMatch(/already searched/);
    const good = await dispatch(ctx, "create_mission", { reason: "search house 2", robot_id: "dog1", kind: "search_cells", target_cell_ids: [cells[1].id] }, "m");
    expect(good.ok).toBe(true);
  });

  it("hold needs low battery or a failed device named in the reason", async () => {
    const { h } = fakeWorld();
    const ctx = ctxFor(h, "orchestrator");
    const r = await dispatch(ctx, "create_mission", { reason: "pause", robot_id: "dog1", kind: "hold" }, "m");
    expect(r.error).toMatch(/battery under 20%/);
    h.module.setRobot("dog1", { battery_pct: 12 });
    const ok = await dispatch(ctx, "create_mission", { reason: "battery at 12%", robot_id: "dog1", kind: "hold" }, "m");
    expect(ok.ok).toBe(true);
  });

  it("the orchestrator cancelling a mission it did not create is rejected", async () => {
    const { h, cells } = fakeWorld();
    const coord = "f".repeat(64);
    h.module.registerParticipant(coord, "coord", "coordinator");
    h.module.createMission(coord, "dog1", "search_cells", [cells[0].id], null, null, "by hand", 0);
    const m = h.store.rows("mission")[0];
    const r = await dispatch(ctxFor(h, "orchestrator"), "cancel_own_mission", { reason: "not needed", mission_id: m.id }, "m");
    expect(r.error).toMatch(/created by coord/);
  });

  it("a briefing to a rescuer without the assignment is rejected; with it, it passes", async () => {
    const { h } = fakeWorld();
    const sid = survivorAt(h, 3);
    const ctx = ctxFor(h, "comms_agent");
    const args = { reason: "brief", audience: RESCUER.A, text: "IMMEDIATE house 3: go now.", priority: "critical", survivor_id: sid };
    const bad = await dispatch(ctx, "send_briefing", args, "m");
    expect(bad.error).toMatch(/holds no proposed or active assignment/);
    h.module.proposeAssignment(h.identity("orchestrator"), sid, RESCUER.A, "IMMEDIATE");
    const ok = await dispatch(ctx, "send_briefing", args, "m");
    expect(ok.ok).toBe(true);
    // The same text to the same audience within 60 s is rejected.
    await h.clock.advance(4000);
    const dup = await dispatch(ctx, "send_briefing", args, "m");
    expect(dup.error).toMatch(/last 60 s/);
  });

  it("submit_review needs a claimed review task and a reason that cites a fact", async () => {
    const { h } = fakeWorld();
    const sid = survivorAt(h, 3);
    const none = await dispatch(ctxFor(h, "auditor"), "submit_review", { reason: "fine", verdict: "agree" }, "m");
    expect(none.error).toMatch(/claimed review task/);
    const task = postAndClaim(h, "orchestrator", "auditor", "review", { assignment_id: 1, survivor_id: sid, rescuer_identity: RESCUER.A });
    const ctx = ctxFor(h, "auditor", task);
    const vague = await dispatch(ctx, "submit_review", { reason: "looks fine", verdict: "agree" }, "m");
    expect(vague.error).toMatch(/cite at least one fact/);
    const ok = await dispatch(ctx, "submit_review", { reason: "A nearest at 40 m, load 0", verdict: "agree" }, "m");
    expect(ok.ok).toBe(true);
    expect(h.store.get("agent_task", task.id)?.status).toBe("done");
  });

  it("death words in any argument are rejected before the reducer", async () => {
    const { h, cells } = fakeWorld();
    const r = await dispatch(ctxFor(h, "orchestrator"), "create_mission", { reason: "check the dead zone", robot_id: "dog1", kind: "search_cells", target_cell_ids: [cells[1].id] }, "m");
    expect(r.error).toMatch(/forbidden/);
    expect(h.store.rows("mission").length).toBe(0);
  });
});
