// One shared request budget for every model request in this process (agent.md 5.3).
// A token bucket (capacity a quarter of RPM_BUDGET, refilled with the rest over each minute) plus a
// hard sliding cap of RPM_BUDGET requests in any 60 s window, so even a full bucket plus its refill
// never exceeds the budget. One priority queue: wake priority, then agent order (orchestrator,
// comms agent, auditor), then age. A request still queued at its cycle deadline is dropped and the
// caller runs its fallback, so the auditor, last in the queue, falls back first.

import type { Clock, TimerHandle } from "../clock.ts";
import { AGENT_ORDER, type AgentName, type TaskPriority } from "../types.ts";
import { LlmError } from "./types.ts";

const PRIO: Record<TaskPriority, number> = { critical: 0, high: 1, normal: 2 };
const WINDOW_MS = 60_000;

export interface BudgetMeta {
  agent: AgentName;
  priority: TaskPriority;
  /** Epoch ms after which the request is dropped from the queue. */
  deadlineAt: number;
}

interface Pending extends BudgetMeta {
  seq: number;
  enqueuedAt: number;
  resolve: () => void;
  reject: (e: Error) => void;
}

export function compareRequests(a: Pick<Pending, "priority" | "agent" | "seq">, b: Pick<Pending, "priority" | "agent" | "seq">): number {
  if (PRIO[a.priority] !== PRIO[b.priority]) return PRIO[a.priority] - PRIO[b.priority];
  const oa = AGENT_ORDER.indexOf(a.agent);
  const ob = AGENT_ORDER.indexOf(b.agent);
  if (oa !== ob) return oa - ob;
  return a.seq - b.seq;
}

export class Budget {
  private sent: number[] = [];
  private queue: Pending[] = [];
  private seq = 0;
  private timer: TimerHandle | null = null;
  /** Every grant, for tests and the budget scenario. */
  readonly grants: Array<{ at: number; agent: AgentName; priority: TaskPriority }> = [];
  readonly drops: Array<{ at: number; agent: AgentName }> = [];

  readonly burst: number;
  private tokens: number;
  private lastRefill: number;
  /** Tokens per ms. */
  private rate: number;

  constructor(
    readonly rpm: number,
    private clock: Clock,
  ) {
    this.burst = Math.max(1, Math.ceil(rpm / 4));
    this.tokens = this.burst;
    this.lastRefill = clock.now();
    this.rate = Math.max(1, rpm - this.burst) / WINDOW_MS;
  }

  private refill(now: number): void {
    this.tokens = Math.min(this.burst, this.tokens + (now - this.lastRefill) * this.rate);
    this.lastRefill = now;
  }

  /** Earliest time a new request may be sent. */
  private nextSlot(now: number): number {
    this.refill(now);
    let at = this.tokens >= 1 ? now : now + Math.ceil((1 - this.tokens) / this.rate);
    if (this.sent.length >= this.rpm) at = Math.max(at, this.sent[this.sent.length - this.rpm] + WINDOW_MS);
    return at;
  }

  queued(): number {
    return this.queue.length;
  }

  /** Resolves when the request may be sent; rejects with LlmError("dropped") at its deadline. */
  acquire(meta: BudgetMeta): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.queue.push({ ...meta, seq: this.seq++, enqueuedAt: this.clock.now(), resolve, reject });
      this.pump();
    });
  }

  private pump(): void {
    const now = this.clock.now();
    while (this.sent.length && this.sent[0] <= now - WINDOW_MS) this.sent.shift();

    // Drop requests whose deadline passed while they waited.
    const keep: Pending[] = [];
    for (const p of this.queue) {
      if (p.deadlineAt <= now) {
        this.drops.push({ at: now, agent: p.agent });
        p.reject(new LlmError(`budget: ${p.agent} request dropped after waiting ${now - p.enqueuedAt} ms`, "dropped"));
      } else keep.push(p);
    }
    this.queue = keep;

    while (this.queue.length && this.nextSlot(now) <= now) {
      this.queue.sort(compareRequests);
      const p = this.queue.shift()!;
      this.tokens -= 1;
      this.sent.push(now);
      this.grants.push({ at: now, agent: p.agent, priority: p.priority });
      p.resolve();
    }

    if (this.timer != null) {
      this.clock.clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.queue.length) {
      const nextSlot = this.nextSlot(now);
      const nextDeadline = Math.min(...this.queue.map((p) => p.deadlineAt));
      const at = Math.max(now + 1, Math.min(nextSlot, nextDeadline));
      this.timer = this.clock.setTimeout(() => {
        this.timer = null;
        this.pump();
      }, at - now);
    }
  }

  /** Largest number of grants inside any 60 s window (budget scenario check). */
  maxPerMinute(): number {
    let best = 0;
    let j = 0;
    for (let i = 0; i < this.grants.length; i++) {
      while (this.grants[i].at - this.grants[j].at >= WINDOW_MS) j++;
      best = Math.max(best, i - j + 1);
    }
    return best;
  }
}
