// agent_task board (agent.md 5.6): post, claim, complete, and the 120 s stale rule.
// Payloads are validated with ajv; the death-word rule (G2) applies to all text.

import { Ajv } from "ajv";
import type { Actions } from "./actions.ts";
import { textProblem } from "./guards.ts";
import type { AgentName, AgentTask, TaskPriority } from "./types.ts";

export const STALE_TASK_MS = 120_000;
export const AGENT_TASK_LEASE_MS = 30_000;
export const RESULT_MAX = 2000;

const ajv = new Ajv({ allErrors: true });

const PAYLOADS: Record<string, object> = {
  brief_rescuer: {
    type: "object",
    properties: {
      chain_id: { type: "integer", minimum: 0 },
      assignment_id: { type: "integer", minimum: 0 },
      survivor_id: { type: "integer", minimum: 1 },
      rescuer_identity: { type: "string", pattern: "^[0-9a-f]{64}$" },
      why: { type: "string", maxLength: 140 },
    },
    required: ["chain_id", "assignment_id", "survivor_id", "rescuer_identity", "why"],
    additionalProperties: false,
  },
  review: {
    type: "object",
    properties: {
      assignment_id: { type: "integer", minimum: 1 },
      survivor_id: { type: "integer", minimum: 1 },
      rescuer_identity: { type: "string" },
      distance_m: { type: "number" },
      critical_level: { type: "string" },
      reason: { type: "string" },
    },
    required: ["assignment_id", "survivor_id", "rescuer_identity"],
  },
  sitrep: {
    type: "object",
    properties: { audience: { enum: ["commander", "coordinators"] }, counts: { type: "object" } },
    required: ["audience", "counts"],
  },
};
const validators = new Map(Object.entries(PAYLOADS).map(([k, s]) => [k, ajv.compile(s)]));

/** Every string inside a JSON value, collected iteratively. */
export function stringsIn(v: unknown): string[] {
  const out: string[] = [];
  const stack: unknown[] = [v];
  while (stack.length) {
    const x = stack.pop();
    if (typeof x === "string") out.push(x);
    else if (Array.isArray(x)) stack.push(...x);
    else if (x && typeof x === "object") stack.push(...Object.values(x as Record<string, unknown>));
  }
  return out;
}

export function isStale(t: AgentTask, now: number): boolean {
  return t.status === "open" && now - t.created_at > STALE_TASK_MS;
}

export class Board {
  constructor(private actions: Actions) {}

  validatePayload(kind: string, payload: unknown): string | null {
    const v = validators.get(kind);
    if (!v) return `unknown task kind ${kind}`;
    if (!v(payload)) return "invalid payload: " + ajv.errorsText(v.errors);
    for (const s of stringsIn(payload)) {
      const p = textProblem(s);
      if (p) return p;
    }
    return null;
  }

  async post(
    to: AgentName,
    kind: string,
    payload: Record<string, unknown>,
    priority: TaskPriority,
    reason: string,
    chainId: number,
  ): Promise<void> {
    const err = this.validatePayload(kind, payload) ?? textProblem(reason);
    if (err) throw new Error(err);
    await this.actions.postAgentTask(to, kind, JSON.stringify(payload), priority, reason, chainId);
  }

  async claim(taskId: number): Promise<void> {
    await this.actions.claimAgentTask(taskId);
  }

  async complete(taskId: number, status: "done" | "failed", result: Record<string, unknown>): Promise<void> {
    let json = JSON.stringify(result);
    for (const s of stringsIn(result)) {
      const p = textProblem(s);
      if (p) throw new Error(`result_json: ${p}`);
    }
    if (json.length > RESULT_MAX) json = JSON.stringify({ ...result, text: undefined, truncated: true }).slice(0, RESULT_MAX);
    await this.actions.completeAgentTask(taskId, status, json);
  }
}
