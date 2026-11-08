import { describe, expect, it, vi } from "vitest";
import { CORRECTION, runCycle } from "../src/loop.ts";
import { dispatch } from "../src/tools/dispatch.ts";
import { parsePayload } from "../src/world.ts";
import { ctxFor, fakeWorld, postAndClaim, RESCUER, survivorAt } from "./helpers.ts";

describe("dispatch round trip (agent.md 13 step 4)", () => {
  it("a test task round-trips and appears in agent_action with its chain_id", async () => {
    const { h } = fakeWorld();
    const sid = survivorAt(h, 3);
    const chain = h.module.survivorChain(sid);
    h.module.proposeAssignment(h.identity("orchestrator"), sid, RESCUER.A, "IMMEDIATE");
    const ctx = ctxFor(h, "orchestrator", null, { chainId: chain });
    const r = await dispatch(ctx, "delegate", { reason: "Brief Rescuer A on #1", to_agent: "comms_agent", kind: "brief_rescuer", priority: "critical", survivor_id: sid }, "m");
    expect(r.ok).toBe(true);
    const task = h.store.rows("agent_task").find((t) => t.kind === "brief_rescuer")!;
    expect(task.chain_id).toBe(chain);
    // On the wire ids are decimal strings (the module's payload_json convention); parsePayload gives numbers back.
    expect(JSON.parse(task.payload_json)).toMatchObject({ chain_id: String(chain), survivor_id: String(sid), rescuer_identity: RESCUER.A });
    expect(parsePayload(task.payload_json)).toMatchObject({ chain_id: chain, survivor_id: sid, rescuer_identity: RESCUER.A });
    h.module.claimAgentTask(h.identity("comms_agent"), task.id);
    h.module.completeAgentTask(h.identity("comms_agent"), task.id, "done", JSON.stringify({ briefing_id: 1, text: "x", fallback: false }));
    expect(h.store.get("agent_task", task.id)?.status).toBe("done");
    const act = h.store.rows("agent_action").find((a) => a.tool === "delegate")!;
    expect(act).toMatchObject({ agent: "orchestrator", chain_id: chain, model: "m" });
    expect(act.result.startsWith("ok")).toBe(true);
  });
});

describe("loop.ts", () => {
  it.each(["native", "json"])("redacts known participant names in %s tool results before the next model request", async (mode) => {
    const { h } = fakeWorld({ env: { TOOL_MODE: mode }, rules: [
      { agent: "orchestrator", turn: 0, reply: { tool_calls: [{ name: "get_survivor", arguments: { survivor_id: 1, reason: "read the facts" } }] } },
      { agent: "orchestrator", turn: 1, reply: { content: '{"done":true,"summary":"done"}' } },
    ] });
    survivorAt(h, 3, { location_note: "Ana Lopez and ANA LOPEZ at the entry" });
    const send = vi.spyOn(h.mock, "send");
    await runCycle(ctxFor(h, "orchestrator"));
    expect(send.mock.calls.length).toBe(2);
    const contents = send.mock.calls[1][0].messages.map(m => m.content ?? "").join("\n");
    expect(contents).not.toMatch(/ana lopez/i);
    expect(contents).toContain("Rescuer A");
    // The cache remains authoritative; only model-bound text is redacted.
    expect(h.store.rows("survivor")[0].location_note).toContain("Ana Lopez");
  });

  it("asks the serving engine for valid JSON in JSON tool mode", async () => {
    const { h } = fakeWorld({ env: { TOOL_MODE: "json" }, rules: [{ agent: "orchestrator", turn: "any", reply: { content: "done" } }] });
    const send = vi.spyOn(h.mock, "send");
    await runCycle(ctxFor(h, "orchestrator"));
    expect(send.mock.calls[0][0]).toMatchObject({
      extra: { reasoning_effort: "low", response_format: { type: "json_object" } },
    });
    expect(send.mock.calls[0][0].tools).toBeUndefined();
  });

  it("JSON mode: one correction, then the fallback (rules verdict) completes the review", async () => {
    const { h } = fakeWorld({ env: { TOOL_MODE: "json" }, rules: [{ agent: "auditor", turn: "any", reply: { json_content: "I agree with this." } }] });
    const sid = survivorAt(h, 3);
    h.module.proposeAssignment(h.identity("orchestrator"), sid, RESCUER.A, "IMMEDIATE, nearest");
    const review = h.store.rows("agent_task").find((t) => t.kind === "review")!;
    h.module.claimAgentTask(h.identity("auditor"), review.id);
    const ctx = ctxFor(h, "auditor", h.store.get("agent_task", review.id), { chainId: review.chain_id });
    await runCycle(ctx);
    expect(h.mock.requests.length).toBe(2);
    expect(h.trace.lines.some((l) => l.event === "model_reply")).toBe(true);
    const done = h.store.get("agent_task", review.id)!;
    expect(done.status).toBe("done");
    expect(JSON.parse(done.result_json!)).toMatchObject({ verdict: "agree", fallback: true });
    const rules = h.store.rows("agent_action").find((a) => a.tool === "submit_review")!;
    expect(rules.model).toBe("rules");
    expect(rules.reason.startsWith("[fallback]")).toBe(true);
    expect(CORRECTION).toBe("Reply with one JSON object only.");
  });

  it("a tool call leaked into content in native mode is still executed", async () => {
    const { h } = fakeWorld({
      rules: [
        { agent: "orchestrator", turn: 0, reply: { content: '{"name":"get_board","arguments":{"reason":"look at the board"}}' } },
        { agent: "orchestrator", turn: 1, reply: { content: "done" } },
      ],
    });
    await runCycle(ctxFor(h, "orchestrator"));
    expect(h.store.rows("agent_action").some((a) => a.tool === "get_board" && a.result.startsWith("ok"))).toBe(true);
  });

  it("the step limit stops a model that never finishes", async () => {
    const { h } = fakeWorld({ rules: [{ agent: "orchestrator", turn: "any", reply: { tool_calls: [{ name: "get_board", arguments: { reason: "again" } }] } }] });
    await runCycle(ctxFor(h, "orchestrator"));
    expect(h.mock.requests.length).toBe(4);
    expect(h.store.rows("agent_action").filter((a) => a.tool === "get_board").length).toBe(4);
  });

  it("ENABLE_AUDITOR_MODEL=0 uses the rules verdict with no model request", async () => {
    const { h } = fakeWorld({ env: { ENABLE_AUDITOR_MODEL: "0" } });
    const sid = survivorAt(h, 3);
    h.module.proposeAssignment(h.identity("orchestrator"), sid, RESCUER.B, "IMMEDIATE, because A is about to be busy");
    const review = h.store.rows("agent_task").find((t) => t.kind === "review")!;
    h.module.claimAgentTask(h.identity("auditor"), review.id);
    await runCycle(ctxFor(h, "auditor", h.store.get("agent_task", review.id)));
    expect(h.mock.requests.length).toBe(0);
    const res = JSON.parse(h.store.get("agent_task", review.id)!.result_json!);
    // A is free at 40 m, over 50% closer than B at 120 m.
    expect(res).toMatchObject({ verdict: "disagree", flag_kind: "proposal_disagree", fallback: true });
    expect(h.store.rows("audit_flag")[0]).toMatchObject({ kind: "proposal_disagree", filed_by: "auditor" });
  });

  it("a stale task is completed by the fallback with stale: true", async () => {
    const { h } = fakeWorld();
    const sid = survivorAt(h, 3);
    h.module.proposeAssignment(h.identity("orchestrator"), sid, RESCUER.A, "IMMEDIATE");
    const task = postAndClaim(h, "orchestrator", "comms_agent", "brief_rescuer", { chain_id: 0, assignment_id: 1, survivor_id: sid, rescuer_identity: RESCUER.A, why: "x" });
    await runCycle(ctxFor(h, "comms_agent", task, { stale: true }));
    expect(h.mock.requests.length).toBe(0);
    expect(JSON.parse(h.store.get("agent_task", task.id)!.result_json!)).toMatchObject({ fallback: true, stale: true });
    expect(h.store.rows("briefing")[0].text).toMatch(/^IMMEDIATE house 3: breathing 34\/min \(conf 0\.71\)\./);
  });
});

describe("runtime heartbeat policy (agent.md 8.1)", () => {
  it("the orchestrator stops its heartbeat while a tier 0 wake waits over 8 s, and while its model is down", async () => {
    const { h } = fakeWorld({ rules: [{ agent: "orchestrator", turn: "any", delay_ms: 14_000, reply: { content: "thinking" } }] });
    await h.startAgents(["orchestrator"]);
    const rt = h.runtimes.get("orchestrator")!;
    expect(rt.shouldHeartbeat()).toBe(true);
    survivorAt(h, 3);
    await h.run(10_000);
    expect(rt.shouldHeartbeat()).toBe(false);
    await h.run(30_000);
    expect(rt.shouldHeartbeat()).toBe(true);
    h.health.markDown(h.cfg.MODEL_SUPER, "orchestrator", "test");
    expect(rt.shouldHeartbeat()).toBe(false);
    await h.clock.advance(0);
    expect(h.store.rows("agent_action").some((a) => a.tool === "model_down" && a.agent === "orchestrator")).toBe(true);
    h.stop();
  });

  it("wakes are debounced and merged into one orchestrator cycle", async () => {
    const { h } = fakeWorld({ rules: [{ agent: "orchestrator", turn: "any", reply: { content: "ok" } }] });
    await h.startAgents(["orchestrator"]);
    survivorAt(h, 1);
    await h.run(500);
    survivorAt(h, 2);
    await h.run(500);
    survivorAt(h, 4);
    await h.run(10_000);
    const cycles = h.store.rows("agent_action").filter((a) => a.agent === "orchestrator" && a.tool === "cycle_summary");
    expect(cycles.length).toBe(1);
    h.stop();
  });
});

describe("orchestrator packet reads payload ids as decimal strings", () => {
  it("shows a posted brief for a pending proposal", async () => {
    const { orchestratorPacket } = await import("../src/agents/orchestrator.ts");
    const { World } = await import("../src/world.ts");
    const { h } = fakeWorld();
    const sid = survivorAt(h, 3);
    h.module.proposeAssignment(h.identity("orchestrator"), sid, RESCUER.A, "IMMEDIATE");
    const a = h.store.rows("assignment").at(-1)!;
    // Ids as the module and payloadJson write them.
    h.module.postAgentTask(h.identity("orchestrator"), "comms_agent", "brief_rescuer", JSON.stringify({ chain_id: "0", assignment_id: String(a.id), survivor_id: String(sid), rescuer_identity: RESCUER.A, why: "w" }), "critical", "brief", 0);
    const ctx = ctxFor(h, "orchestrator");
    const packet = orchestratorPacket(new World(h.store, h.clock), ctx.input, ctx);
    expect(packet).toContain(`assignment #${a.id}, by orchestrator, brief posted`);
  });
});
