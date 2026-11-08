import { describe, expect, it, vi } from "vitest";
import { runCycle } from "../src/loop.ts";
import type { FixtureRule } from "../src/llm/mock.ts";
import { ctxFor, fakeWorld, postAndClaim, RESCUER, survivorAt } from "./helpers.ts";

function setup(rules: FixtureRule[] = [], env: Record<string, string> = {}, sidPresent = true) {
  const { h } = fakeWorld({ rules, env });
  const sid = survivorAt(h, 3);
  h.module.proposeAssignment(h.identity("orchestrator"), sid, RESCUER.A, "IMMEDIATE, nearest");
  const task = postAndClaim(h, "orchestrator", "comms_agent", "answer_rescuer", {
    rescuer_identity: RESCUER.A, rescuer_name: "PRIVATE PAYLOAD NAME",
    text: "Ana Lopez asks: where is the person?", audio_url: "https://private.invalid/voice.wav",
    survivor_id: sidPresent ? String(sid) : "0", ignored: "PRIVATE EXTRA FIELD",
  }, h.module.survivorChain(sid));
  return { h, task, ctx: ctxFor(h, "comms_agent", task) };
}

function reply(text: string, audience = "Rescuer A", survivorId = 1): FixtureRule {
  return { agent: "comms_agent", turn: "any", reply: { tool_calls: [{
    name: "send_briefing", arguments: {
      audience, text, priority: "info", ...(survivorId ? { survivor_id: survivorId } : {}), reason: "Answer from the board facts",
    },
  }] } };
}

describe("rescuer question model path (A6)", () => {
  it.each(["native", "json"])("sends a factual answer with the question chain in %s mode", async mode => {
    const text = "IMMEDIATE house 3: 8 m in from front door. Breathing 34/min (conf 0.71).";
    const { h, task, ctx } = setup([reply(text)], { TOOL_MODE: mode });
    const send = vi.spyOn(h.mock, "send");
    await runCycle(ctx);
    expect(h.store.rows("briefing")).toHaveLength(1);
    expect(h.store.rows("briefing")[0]).toMatchObject({
      audience: RESCUER.A, text, kind: "answer", survivor_id: 1, chain_id: task.chain_id,
    });
    expect(JSON.parse(h.store.get("agent_task", task.id)!.result_json!)).toMatchObject({ text, fallback: false });
    const sent = JSON.stringify(send.mock.calls.map(c => c[0]));
    expect(sent).toContain("where is the person?");
    expect(sent).toContain("own_assignments");
    expect(sent).toContain("breathing_confidence");
    expect(sent).not.toMatch(/Ana Lopez|Ben Okafor|PRIVATE|private.invalid|[0-9a-f]{64}/i);
    expect(h.mock.requests).toHaveLength(1);
  });

  it("accepts an explicit unknown answer when board facts cannot answer the question", async () => {
    const text = "I do not know. Ask a coordinator.";
    const { h, ctx } = setup([reply(text, "Rescuer A", 0)], {}, false);
    const send = vi.spyOn(h.mock, "send");
    await runCycle(ctx);
    expect(h.store.rows("briefing")[0]).toMatchObject({ text, survivor_id: null, kind: "answer" });
    const packet = send.mock.calls[0][0].messages[1].content;
    expect(packet).toContain('"survivor":null');
    expect(packet).toContain("If FACTS do not answer the question");
    expect(ctx.state.usedFallback).toBe(false);
  });

  it.each(["Rescuer B", "all", "coordinators", "commander"])("rejects an answer addressed to %s and falls back to the asker", async audience => {
    const { h, ctx } = setup([reply("Answer only for the asker.", audience)]);
    await runCycle(ctx);
    expect(h.store.rows("briefing")).toHaveLength(1);
    expect(h.store.rows("briefing")[0]).toMatchObject({ audience: RESCUER.A, kind: "answer" });
    expect(ctx.state.usedFallback).toBe(true);
    expect(h.store.rows("agent_action").some(a => a.result.includes("write only to the rescuer named"))).toBe(true);
  });

  it("rejects a different survivor and uses the task's survivor in the template", async () => {
    const { h, ctx } = setup([reply("Here is the answer.", "Rescuer A", 2)]);
    survivorAt(h, 4);
    await runCycle(ctx);
    expect(ctx.state.usedFallback).toBe(true);
    expect(h.store.rows("briefing")[0].survivor_id).toBe(1);
  });

  it("rejects 121 characters and sends a short template", async () => {
    const { h, ctx } = setup([reply("x".repeat(121))]);
    await runCycle(ctx);
    expect(ctx.state.usedFallback).toBe(true);
    expect(h.store.rows("agent_action").some(a => a.tool === "send_briefing" && a.result.startsWith("error:"))).toBe(true);
    expect(h.store.rows("briefing")[0].text).toMatch(/^Board: house 3/);
    expect(h.store.rows("briefing")[0].text.length).toBeLessThanOrEqual(120);
  });

  it.each(["timeout", "server"] as const)("uses the template after model %s failures", async fail => {
    const { h, task, ctx } = setup([{ agent: "comms_agent", fail }]);
    await runCycle(ctx);
    expect(ctx.state.usedFallback).toBe(true);
    expect(h.store.rows("briefing")[0].text).toMatch(/^Board: house 3/);
    expect(JSON.parse(h.store.get("agent_task", task.id)!.result_json!)).toMatchObject({ fallback: true });
  });

  it("uses the template without model calls when ENABLE_COMMS_MODEL=0", async () => {
    const { h, ctx } = setup([], { ENABLE_COMMS_MODEL: "0" });
    await runCycle(ctx);
    expect(h.mock.requests).toHaveLength(0);
    expect(h.store.rows("briefing")[0].text).toMatch(/^Board: house 3/);
  });

  it("makes no model request or briefing when questions are disabled", async () => {
    const { h, task, ctx } = setup([], { ENABLE_QUESTIONS: "0" });
    await runCycle(ctx);
    expect(h.mock.requests).toHaveLength(0);
    expect(h.store.rows("briefing")).toHaveLength(0);
    expect(h.store.get("agent_task", task.id)!.status).toBe("failed");
  });

  it("uses the template when the model is already down", async () => {
    const { h, ctx } = setup();
    h.health.markDown(h.cfg.MODEL_NANO, "comms_agent", "test");
    await runCycle(ctx);
    expect(h.mock.requests).toHaveLength(0);
    expect(h.store.rows("briefing")[0].text).toMatch(/^Board: house 3/);
  });

  it("sends only one answer when a model returns two writes in the same reply", async () => {
    const first = reply("house 3: 8 m in from front door.");
    first.reply!.tool_calls!.push({
      name: "send_briefing", arguments: {
        audience: "Rescuer A", text: "Another answer.", priority: "info", survivor_id: 1,
        reason: "Repeat the answer",
      },
    });
    const { h, ctx } = setup([first]);
    await runCycle(ctx);
    expect(h.store.rows("briefing")).toHaveLength(1);
    expect(h.store.rows("briefing")[0].text).toBe("house 3: 8 m in from front door.");
    expect(h.store.rows("agent_action").some(a => a.result.includes("send only one answer"))).toBe(true);
  });

  it("can fall back on a question without a survivor", async () => {
    const { h, ctx } = setup([], { ENABLE_COMMS_MODEL: "0" }, false);
    await runCycle(ctx);
    expect(h.store.rows("briefing")[0]).toMatchObject({
      audience: RESCUER.A, kind: "answer", survivor_id: null,
      text: "Board: site 0 found, 0 unaccounted. Ask coordinator for more.",
    });
  });

  it("removes contact details from the question and board notes before model requests", async () => {
    const { h, task } = setup([reply("I do not know. Ask a coordinator.")]);
    const payload = JSON.parse(task.payload_json);
    payload.text = "Call +1 214 555 0100 or 214.555.0199, email person@example.com. Where is the person?";
    const privateTask = { ...task, payload_json: JSON.stringify(payload) };
    const survivor = h.store.rows("survivor")[0];
    h.store.update("survivor", { ...survivor, location_note: "Contact entry@example.org at 214-555-0188. 8 m in." });
    const send = vi.spyOn(h.mock, "send");
    await runCycle(ctxFor(h, "comms_agent", privateTask));
    const outbound = JSON.stringify(send.mock.calls.map(c => c[0].messages));
    expect(outbound).not.toMatch(/person@example.com|entry@example.org|214[ .-]555|0100|0199|0188/);
    expect(outbound).toContain("[email removed]");
    expect(outbound).toContain("[phone removed]");
    expect(outbound).toContain("8 m in");
  });
});
