import type { AgentName } from "../types.ts";

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ToolDef {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface ChatRequest {
  agent: AgentName;
  model: string;
  messages: ChatMessage[];
  /** Present only in native tool mode. */
  tools?: ToolDef[];
  maxTokens: number;
  timeoutMs: number;
  /** Extra body fields: reasoning_effort for Super, chat_template_kwargs for Nano. */
  extra?: Record<string, unknown>;
}

export interface ChatReply {
  content: string;
  toolCalls: ToolCall[];
  /** First 300 characters of reasoning_content, for the trace only. */
  reasoning: string | null;
  status: number;
  latencyMs: number;
}

export type LlmErrorKind =
  | "rate_limit"
  | "timeout"
  | "server"
  | "pending"
  | "empty"
  | "bad_request"
  | "auth"
  | "network"
  | "no_fixture"
  | "down"
  | "dropped";

export class LlmError extends Error {
  constructor(
    message: string,
    readonly kind: LlmErrorKind,
    readonly status = 0,
  ) {
    super(message);
  }
  get retryable(): boolean {
    return ["timeout", "server", "pending", "empty", "network"].includes(this.kind);
  }
}

export interface LlmProvider {
  send(req: ChatRequest): Promise<ChatReply>;
}
