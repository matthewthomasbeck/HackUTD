// NVIDIA hosted OpenAI-compatible client (agent.md 4.2) and the gateway every agent uses:
// budget slot, timeout, 429 backoff (2, 4, 8 s plus up to 1 s jitter, at most 3 retries),
// one retry on a timeout, 5xx, 202 or empty reply, and the 60 s model-down switch after two
// failures in a row.

import OpenAI, { APIConnectionTimeoutError, APIError } from "openai";
import type { Clock } from "../clock.ts";
import type { Config } from "../config.ts";
import type { AgentName, TaskPriority } from "../types.ts";
import { Budget } from "./budget.ts";
import { stripThink } from "./parse.ts";
import { LlmError, type ChatReply, type ChatRequest, type LlmProvider, type ToolCall } from "./types.ts";

export const MODEL_DOWN_MS = 60_000;

/** The request body of agent.md 4.2. Exported so smoke-llm.ts uses the same body. */
export function buildBody(req: ChatRequest): Record<string, unknown> {
  return {
    model: req.model,
    messages: req.messages,
    temperature: 0.6,
    top_p: 0.95,
    max_tokens: req.maxTokens,
    stream: false,
    ...(req.tools && req.tools.length ? { tools: req.tools, tool_choice: "auto" } : {}),
    ...(req.extra ?? {}),
  };
}

/** Per-model body extras: reasoning_effort "low" on Super, thinking off on Nano if enabled. */
export function modelExtras(cfg: Config, model: string): Record<string, unknown> {
  if (model === cfg.MODEL_SUPER) return { reasoning_effort: "low" };
  if (model === cfg.MODEL_NANO && cfg.NANO_THINKING_OFF) return { chat_template_kwargs: { enable_thinking: false } };
  return {};
}

export function toLlmError(err: unknown): LlmError {
  if (err instanceof LlmError) return err;
  if (err instanceof APIConnectionTimeoutError) return new LlmError("request timed out", "timeout");
  if (err instanceof APIError) {
    const s = err.status ?? 0;
    const msg = `HTTP ${s}: ${String(err.message).slice(0, 200)}`;
    if (s === 429) return new LlmError(msg, "rate_limit", s);
    if (s === 401 || s === 403) return new LlmError(msg, "auth", s);
    if (s >= 400 && s < 500) return new LlmError(msg, "bad_request", s);
    if (s >= 500) return new LlmError(msg, "server", s);
    return new LlmError(msg, "network", s);
  }
  return new LlmError(String((err as Error)?.message ?? err).slice(0, 200), "network");
}

export class NvidiaProvider implements LlmProvider {
  private client: OpenAI;
  constructor(apiKey: string, baseURL: string) {
    // maxRetries 0: every retry goes through the shared budget queue.
    this.client = new OpenAI({ apiKey, baseURL, maxRetries: 0, timeout: 30_000 });
  }
  async send(req: ChatRequest): Promise<ChatReply> {
    const t0 = Date.now();
    let data: any;
    let status = 0;
    try {
      const { data: d, response } = await this.client.chat.completions
        .create(buildBody(req) as any, { timeout: req.timeoutMs, maxRetries: 0 })
        .withResponse();
      data = d;
      status = response.status;
    } catch (err) {
      throw toLlmError(err);
    }
    const latencyMs = Date.now() - t0;
    if (status === 202) throw new LlmError("HTTP 202: result pending", "pending", 202);
    const choice = data?.choices?.[0];
    if (!choice) throw new LlmError("empty choices", "empty", status);
    const msg = choice.message ?? {};
    const toolCalls: ToolCall[] = Array.isArray(msg.tool_calls)
      ? msg.tool_calls
          .filter((t: any) => t?.function?.name)
          .map((t: any, i: number) => ({
            id: String(t.id ?? `call_${i}`),
            type: "function" as const,
            function: {
              name: String(t.function.name),
              arguments:
                typeof t.function.arguments === "string" ? t.function.arguments : JSON.stringify(t.function.arguments ?? {}),
            },
          }))
      : [];
    const reasoningRaw = typeof msg.reasoning_content === "string" ? msg.reasoning_content : typeof msg.reasoning === "string" ? msg.reasoning : null;
    return {
      content: stripThink(typeof msg.content === "string" ? msg.content : ""),
      toolCalls,
      reasoning: reasoningRaw ? reasoningRaw.slice(0, 300) : null,
      status,
      latencyMs,
    };
  }
}

export type HealthListener = (model: string, state: "down" | "up", agent: AgentName, why: string) => void;

export class ModelHealth {
  private failures = new Map<string, number>();
  private downUntil = new Map<string, number>();
  private wasDown = new Set<string>();
  private listeners: HealthListener[] = [];
  constructor(private clock: Clock) {}
  onSwitch(l: HealthListener): void {
    this.listeners.push(l);
  }
  isDown(model: string): boolean {
    return (this.downUntil.get(model) ?? 0) > this.clock.now();
  }
  /** Force a model down (tests, scenarios, or an operator switch). */
  markDown(model: string, agent: AgentName, why: string, ms = MODEL_DOWN_MS): void {
    this.downUntil.set(model, this.clock.now() + ms);
    this.wasDown.add(model);
    for (const l of this.listeners) l(model, "down", agent, why);
  }
  recordFailure(model: string, agent: AgentName, why: string): void {
    const n = (this.failures.get(model) ?? 0) + 1;
    this.failures.set(model, n);
    if (n >= 2 && !this.isDown(model)) {
      this.failures.set(model, 0);
      this.markDown(model, agent, why);
    }
  }
  recordSuccess(model: string, agent: AgentName): void {
    this.failures.set(model, 0);
    if (this.wasDown.has(model)) {
      this.wasDown.delete(model);
      for (const l of this.listeners) l(model, "up", agent, "request succeeded");
    }
  }
}

export interface ChatMeta {
  priority: TaskPriority;
  /** The cycle deadline. */
  deadlineAt: number;
}

export class LlmGateway {
  constructor(
    readonly provider: LlmProvider,
    readonly budget: Budget,
    readonly health: ModelHealth,
    private clock: Clock,
    private random: () => number = Math.random,
  ) {}

  private withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const h = this.clock.setTimeout(() => reject(new LlmError(`timed out after ${ms} ms`, "timeout")), ms);
      p.then(
        (v) => {
          this.clock.clearTimeout(h);
          resolve(v);
        },
        (e) => {
          this.clock.clearTimeout(h);
          reject(e);
        },
      );
    });
  }

  async chat(req: ChatRequest, meta: ChatMeta): Promise<ChatReply> {
    if (this.health.isDown(req.model)) throw new LlmError(`model ${req.model} is marked down`, "down");
    let retriedOnce = false;
    let rateRetries = 0;
    for (;;) {
      const now = this.clock.now();
      if (meta.deadlineAt <= now) throw new LlmError("cycle deadline reached", "dropped");
      await this.budget.acquire({ agent: req.agent, priority: meta.priority, deadlineAt: meta.deadlineAt });
      try {
        const remaining = Math.max(1, meta.deadlineAt - this.clock.now());
        const reply = await this.withTimeout(this.provider.send(req), Math.min(req.timeoutMs, remaining));
        this.health.recordSuccess(req.model, req.agent);
        return reply;
      } catch (e) {
        const err = toLlmError(e);
        if (err.kind === "rate_limit" && rateRetries < 3) {
          const wait = 2000 * 2 ** rateRetries + Math.floor(this.random() * 1000);
          rateRetries++;
          if (this.clock.now() + wait >= meta.deadlineAt) throw err;
          await this.clock.sleep(wait);
          continue;
        }
        if (err.kind !== "rate_limit") this.health.recordFailure(req.model, req.agent, err.message);
        if (err.retryable && !retriedOnce && !this.health.isDown(req.model)) {
          retriedOnce = true;
          continue;
        }
        throw err;
      }
    }
  }
}
