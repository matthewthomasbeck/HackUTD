// MockLLM (LLM_MODE=mock, our addition; README.md): replays recorded replies from test/fixtures/.
// A request with no matching fixture fails as a model error, so the agent's fallback runs.
//
// Fixture file: a JSON array of rules, first match wins:
//   { "agent": "orchestrator", "contains": ["WAKE:", "#1 "], "turn": 0,
//     "delay_ms": 0, "reply": { "tool_calls": [{ "name": "...", "arguments": {...} }], "content": "..." } }
// - contains: every string must appear in the first user message (the wake packet).
// - turn: number of assistant messages so far (0 = first request); "any" or omitted matches every turn.
// - policy: instead of "reply", the name of a function registered by the caller (scenarios use one
//   to play a scripted orchestrator over many survivors).
// In JSON tool mode (no tools in the request) a tool-call reply is rendered as the strict JSON
// action object, wrapped in a <think> block and a code fence, so the parse.ts path is exercised.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Clock } from "../clock.ts";
import { LlmError, type ChatReply, type ChatRequest, type LlmProvider, type ToolCall } from "./types.ts";

export interface FixtureReply {
  content?: string;
  tool_calls?: Array<{ name: string; arguments: Record<string, unknown> }>;
  /** Raw content to send in JSON mode instead of the rendered actions. */
  json_content?: string;
}

export interface FixtureRule {
  agent?: string;
  contains?: string[];
  turn?: number | "any";
  delay_ms?: number;
  reply?: FixtureReply;
  policy?: string;
  /** Fail this request with an error kind instead of replying (for fallback tests). */
  fail?: "timeout" | "server" | "rate_limit" | "bad_request";
}

export type MockPolicy = (req: ChatRequest) => FixtureReply | null;

export function loadFixtures(names: string[], dir: string): FixtureRule[] {
  const out: FixtureRule[] = [];
  for (const n of names) {
    const path = join(dir, n.endsWith(".json") ? n : `${n}.json`);
    const data = JSON.parse(readFileSync(path, "utf8"));
    if (!Array.isArray(data)) throw new Error(`fixture ${path} must be a JSON array`);
    out.push(...(data as FixtureRule[]));
  }
  return out;
}

export const DEFAULT_FIXTURE_DIR = new URL("../../test/fixtures/", import.meta.url).pathname;

export class MockLLM implements LlmProvider {
  /** Every request seen, for tests and scenario checks. */
  readonly requests: Array<{ at: number; agent: string; model: string; turn: number; native: boolean }> = [];
  /** Requests answered with an emulated hosted 429. */
  limited = 0;
  private sentAt: number[] = [];
  private callSeq = 0;

  constructor(
    private rules: FixtureRule[],
    private clock: Clock,
    private policies: Record<string, MockPolicy> = {},
    /** Emulated hosted limit; above it the mock answers 429 like the real API. */
    private hostedRpm = 40,
  ) {}

  addRules(rules: FixtureRule[], front = true): void {
    this.rules = front ? [...rules, ...this.rules] : [...this.rules, ...rules];
  }

  async send(req: ChatRequest): Promise<ChatReply> {
    const now = this.clock.now();
    this.sentAt = this.sentAt.filter((t) => t > now - 60_000);
    this.sentAt.push(now);
    const turn = req.messages.filter((m) => m.role === "assistant").length;
    const native = !!req.tools && req.tools.length > 0;
    this.requests.push({ at: now, agent: req.agent, model: req.model, turn, native });
    if (this.sentAt.length > this.hostedRpm && ++this.limited) throw new LlmError("HTTP 429: mock hosted limit", "rate_limit", 429);

    const packet = req.messages.find((m) => m.role === "user")?.content ?? "";
    const rule = this.rules.find(
      (r) =>
        (!r.agent || r.agent === req.agent) &&
        (r.turn === undefined || r.turn === "any" || r.turn === turn) &&
        (r.contains ?? []).every((c) => packet.includes(c)),
    );
    if (!rule) throw new LlmError(`mock: no fixture for ${req.agent} turn ${turn}`, "no_fixture");
    if (rule.delay_ms) await this.clock.sleep(rule.delay_ms);
    if (rule.fail === "timeout") throw new LlmError("mock timeout", "timeout");
    if (rule.fail === "server") throw new LlmError("HTTP 500: mock", "server", 500);
    if (rule.fail === "rate_limit") throw new LlmError("HTTP 429: mock", "rate_limit", 429);
    if (rule.fail === "bad_request") throw new LlmError("HTTP 400: mock", "bad_request", 400);

    let reply: FixtureReply | null = rule.reply ?? null;
    if (rule.policy) {
      const p = this.policies[rule.policy];
      if (!p) throw new LlmError(`mock: unknown policy ${rule.policy}`, "no_fixture");
      reply = p(req);
    }
    if (!reply) throw new LlmError(`mock: policy ${rule.policy} gave no reply`, "no_fixture");
    return this.render(reply, native);
  }

  private render(reply: FixtureReply, native: boolean): ChatReply {
    const calls = reply.tool_calls ?? [];
    if (native) {
      const toolCalls: ToolCall[] = calls.map((c) => ({
        id: `mock_${++this.callSeq}`,
        type: "function",
        function: { name: c.name, arguments: JSON.stringify(c.arguments) },
      }));
      return { content: reply.content ?? "", toolCalls, reasoning: null, status: 200, latencyMs: 0 };
    }
    let content: string;
    if (reply.json_content !== undefined) content = reply.json_content;
    else if (calls.length) {
      const body = JSON.stringify({ actions: calls.map((c) => ({ tool: c.name, args: c.arguments })) });
      content = "<think>Planning the actions.</think>\n```json\n" + body + "\n```";
    } else content = JSON.stringify({ done: true, summary: reply.content ?? "done" });
    return { content, toolCalls: [], reasoning: null, status: 200, latencyMs: 0 };
  }
}
