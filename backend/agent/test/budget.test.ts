import { describe, expect, it } from "vitest";
import { VirtualClock } from "../src/clock.ts";
import { Budget } from "../src/llm/budget.ts";
import { LlmGateway, ModelHealth } from "../src/llm/client.ts";
import { MockLLM } from "../src/llm/mock.ts";
import { LlmError, type ChatRequest } from "../src/llm/types.ts";

const req = (over: Partial<ChatRequest> = {}): ChatRequest => ({
  agent: "orchestrator",
  model: "m",
  messages: [{ role: "user", content: "hi" }],
  maxTokens: 10,
  timeoutMs: 15_000,
  ...over,
});

describe("budget.ts (agent.md 5.3)", () => {
  it("25 requests queued in a minute: at most 20 go out in any 60 s, and the rest follow", async () => {
    const clock = new VirtualClock();
    const b = new Budget(20, clock);
    let granted = 0;
    for (let i = 0; i < 25; i++) b.acquire({ agent: "auditor", priority: "normal", deadlineAt: clock.now() + 600_000 }).then(() => granted++);
    await clock.run(59_000, 500);
    expect(granted).toBeLessThanOrEqual(20);
    expect(granted).toBeGreaterThanOrEqual(19);
    await clock.run(30_000, 500);
    expect(granted).toBe(25);
    expect(b.maxPerMinute()).toBeLessThanOrEqual(20);
  });

  it("a critical orchestrator request jumps a normal auditor request", async () => {
    const clock = new VirtualClock();
    const b = new Budget(4, clock); // burst of 1
    const order: string[] = [];
    await b.acquire({ agent: "comms_agent", priority: "high", deadlineAt: clock.now() + 600_000 });
    b.acquire({ agent: "auditor", priority: "normal", deadlineAt: clock.now() + 600_000 }).then(() => order.push("auditor"));
    b.acquire({ agent: "orchestrator", priority: "critical", deadlineAt: clock.now() + 600_000 }).then(() => order.push("orchestrator"));
    await clock.run(120_000, 1000);
    expect(order).toEqual(["orchestrator", "auditor"]);
  });

  it("a request still queued at its deadline is dropped (the caller falls back)", async () => {
    const clock = new VirtualClock();
    const b = new Budget(4, clock);
    await b.acquire({ agent: "orchestrator", priority: "critical", deadlineAt: clock.now() + 600_000 });
    let err: unknown = null;
    b.acquire({ agent: "auditor", priority: "normal", deadlineAt: clock.now() + 5000 }).catch((e) => (err = e));
    await clock.run(6000, 500);
    expect(err).toBeInstanceOf(LlmError);
    expect((err as LlmError).kind).toBe("dropped");
    expect(b.drops[0].agent).toBe("auditor");
  });
});

describe("LlmGateway retries and the model-down switch", () => {
  it("429 backs off and retries inside the budget, then succeeds", async () => {
    const clock = new VirtualClock();
    const mock = new MockLLM([{ fail: "rate_limit", turn: 0, contains: ["first"] }, { reply: { content: "ok" } }], clock);
    let n = 0;
    const provider = { send: (r: ChatRequest) => (n++ === 0 ? mock.send({ ...r, messages: [{ role: "user", content: "first" }] }) : mock.send(r)) };
    const g = new LlmGateway(provider, new Budget(20, clock), new ModelHealth(clock), clock, () => 0);
    let out = "";
    g.chat(req(), { priority: "high", deadlineAt: clock.now() + 60_000 }).then((r) => (out = r.content));
    await clock.run(5000, 250);
    expect(out).toContain("ok"); // no tools in the request, so the mock answers in JSON mode
    expect(n).toBe(2);
  });

  it("two failures in a row mark the model down for 60 s and log the switch", async () => {
    const clock = new VirtualClock();
    const health = new ModelHealth(clock);
    const switches: string[] = [];
    health.onSwitch((m, s) => switches.push(`${m}:${s}`));
    const mock = new MockLLM([{ fail: "server" }], clock);
    const g = new LlmGateway(mock, new Budget(20, clock), health, clock, () => 0);
    let err: LlmError | null = null;
    g.chat(req(), { priority: "high", deadlineAt: clock.now() + 60_000 }).catch((e) => (err = e));
    await clock.run(1000, 100);
    expect(err!.kind).toBe("server");
    expect(mock.requests.length).toBe(2); // one retry, then stop
    expect(health.isDown("m")).toBe(true);
    expect(switches).toEqual(["m:down"]);
    await expect(g.chat(req(), { priority: "high", deadlineAt: clock.now() + 60_000 })).rejects.toMatchObject({ kind: "down" });
    await clock.run(61_000, 1000);
    expect(health.isDown("m")).toBe(false);
  });

  it("a slow reply times out at the agent's request timeout", async () => {
    const clock = new VirtualClock();
    const mock = new MockLLM([{ delay_ms: 20_000, reply: { content: "late" } }], clock);
    const g = new LlmGateway(mock, new Budget(20, clock), new ModelHealth(clock), clock, () => 0);
    let err: LlmError | null = null;
    g.chat(req({ timeoutMs: 6000 }), { priority: "high", deadlineAt: clock.now() + 60_000 }).catch((e) => (err = e));
    await clock.run(15_000, 500);
    expect(err!.kind).toBe("timeout");
  });
});
