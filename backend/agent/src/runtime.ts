// AgentRuntime: one agent's wake handling around loop.ts. Subscriptions turn row changes into
// wakes (agent.md 5.4), which are debounced (DEBOUNCE_MS, at most MAX_WAIT_MS) and merged, except
// a critical task, which starts at once. It also runs the heartbeat policy (8.1), the startup scan
// (8.3: claim open tasks, stale ones by fallback), and logs model_down / model_up switches.

import type { Actions } from "./actions.ts";
import { newCycleState, newMemory, type AgentConfig, type CycleCtx, type CycleInput, type RuntimeDeps, type Wake } from "./agent-types.ts";
import { Board, isStale } from "./board.ts";
import { resolveChain } from "./chain.ts";
import type { TimerHandle } from "./clock.ts";
import { logAction } from "./tools/dispatch.ts";
import { runCycle } from "./loop.ts";
import type { Change, TaskPriority } from "./types.ts";
import type { World } from "./world.ts";

const PRIO: Record<TaskPriority, number> = { critical: 0, high: 1, normal: 2 };
/**
 * register_participant retry delays in seconds, then the last one forever. Outside demo mode the
 * module rejects an agent role until a coordinator calls grant_role(identity, role), so the runner
 * keeps retrying slowly instead of needing a restart.
 */
export const REGISTER_BACKOFF_S = [2, 4, 8, 15, 30];
/** Rejections that mean "register again": the participant row is missing or the role is not granted yet. */
const REREGISTER = /not registered|role not granted/i;
export const TIER0_STALL_MS = 8000;

export class AgentRuntime {
  readonly memory = newMemory();
  readonly board: Board;
  private pendingRows = new Map<string, Wake>();
  private pendingTasks: Wake[] = [];
  private firstPendingAt: number | null = null;
  private flushTimer: TimerHandle | null = null;
  private hbTimer: TimerHandle | null = null;
  private regTimer: TimerHandle | null = null;
  private regAttempt = 0;
  /** True after register_participant succeeded; heartbeats wait for it. */
  registered = false;
  private localTimers = new Set<TimerHandle>();
  private running = false;
  private stopped = true;
  private unsub: (() => void) | null = null;
  /** First tier 0 wake not yet covered by a finished cycle (heartbeat policy 8.1). */
  private tier0Since: number | null = null;
  /** In-flight cycles, so tests can wait for quiet. */
  private inflight: Promise<void> = Promise.resolve();
  cycles = 0;

  constructor(
    readonly agent: AgentConfig,
    readonly deps: RuntimeDeps,
    readonly world: World,
    readonly actions: Actions,
  ) {
    this.board = new Board(actions);
    deps.llm.health.onSwitch((model, state, agentName, why) => {
      if (agentName !== agent.name || model !== agent.model) return;
      void this.logSwitch(state, why);
    });
  }

  private ctxFor(input: CycleInput): CycleCtx {
    return {
      agent: this.agent,
      deps: this.deps,
      world: this.world,
      actions: this.actions,
      board: this.board,
      input,
      state: newCycleState(this.agent.model),
      memory: this.memory,
    };
  }

  private bareInput(): CycleInput {
    const now = this.deps.clock.now();
    return { agent: this.agent.name, wakes: [], task: null, chainId: 0, priority: "high", deadlineAt: now + 10_000, startedAt: now };
  }

  private async logSwitch(state: "down" | "up", why: string): Promise<void> {
    const ctx = this.ctxFor(this.bareInput());
    const tool = state === "down" ? "model_down" : "model_up";
    this.deps.log.warn(this.agent.name, `${tool}: ${this.agent.model} (${why})`);
    await logAction(ctx, tool, { model: this.agent.model }, `ok: ${tool}`, state === "down" ? `[fallback] model down: ${why}` : "model answering again", "rules");
  }

  async start(): Promise<void> {
    this.stopped = false;
    await this.register();
    this.unsub = this.world.onChange((c) => this.handleChange(c));
    this.scheduleHeartbeat(0);
    this.startupScan();
  }

  /** register_participant, retried with REGISTER_BACKOFF_S on failure (never a tight loop). */
  private async register(): Promise<void> {
    if (this.stopped) return;
    try {
      await this.actions.registerParticipant(this.agent.name, this.agent.role);
      if (this.regAttempt > 0) this.deps.log.info(this.agent.name, `registered as ${this.agent.role} after ${this.regAttempt} retries`);
      this.registered = true;
      this.regAttempt = 0;
    } catch (err) {
      this.registered = false;
      const msg = (err as Error).message;
      const delay = REGISTER_BACKOFF_S[Math.min(this.regAttempt, REGISTER_BACKOFF_S.length - 1)];
      this.regAttempt++;
      const hint = /role not granted/i.test(msg) ? `; a coordinator must call grant_role(<this identity>, ${this.agent.role})` : "";
      this.deps.log.warn(this.agent.name, `register_participant failed: ${msg}${hint}; retry in ${delay} s`);
      this.scheduleRegister(delay * 1000);
    }
  }

  private scheduleRegister(ms: number): void {
    if (this.stopped || this.regTimer != null) return;
    this.regTimer = this.deps.clock.setTimeout(() => {
      this.regTimer = null;
      void this.register();
    }, ms);
  }

  stop(): void {
    this.stopped = true;
    if (this.regTimer != null) this.deps.clock.clearTimeout(this.regTimer);
    this.regTimer = null;
    this.unsub?.();
    this.unsub = null;
    const clock = this.deps.clock;
    if (this.flushTimer != null) clock.clearTimeout(this.flushTimer);
    if (this.hbTimer != null) clock.clearTimeout(this.hbTimer);
    for (const t of this.localTimers) clock.clearTimeout(t);
    this.localTimers.clear();
    this.flushTimer = this.hbTimer = null;
    this.pendingRows.clear();
    this.pendingTasks = [];
  }

  isRunning(): boolean {
    return !this.stopped;
  }

  idle(): Promise<void> {
    return this.inflight;
  }

  // ---------- heartbeat (agent.md 8.1) ----------

  /** The orchestrator's heartbeat means "able to act": model up and no tier 0 wake stalled over 8 s. */
  shouldHeartbeat(): boolean {
    if (this.agent.name !== "orchestrator") return true;
    if (this.deps.llm.health.isDown(this.agent.model)) return false;
    if (this.tier0Since != null && this.deps.clock.now() - this.tier0Since > TIER0_STALL_MS) return false;
    return true;
  }

  private scheduleHeartbeat(ms: number): void {
    if (this.stopped) return;
    this.hbTimer = this.deps.clock.setTimeout(() => {
      this.hbTimer = null;
      void this.heartbeat();
      this.scheduleHeartbeat(this.agent.heartbeatMs);
    }, ms);
  }

  private async heartbeat(): Promise<void> {
    if (this.stopped || !this.registered || !this.shouldHeartbeat()) return;
    try {
      await this.actions.agentHeartbeat();
      this.memory.lastHeartbeatAt = this.deps.clock.now();
    } catch (err) {
      const msg = (err as Error).message;
      this.deps.log.warn(this.agent.name, `agent_heartbeat failed: ${msg}`);
      // The participant row is gone (for example after a republish): register again.
      if (REREGISTER.test(msg)) {
        this.registered = false;
        this.scheduleRegister(0);
      }
    }
  }

  // ---------- wakes ----------

  private startupScan(): void {
    if (!this.world.activeRun()) return;
    const mine = this.world.tasks().filter((t) => t.to_agent === this.agent.name && t.status === "open");
    for (const t of mine) this.enqueue({ key: `task:${t.id}`, kind: "task", priority: t.priority, at: this.deps.clock.now(), note: `${t.kind} #${t.id} (startup)`, task: t });
    if (this.agent.name === "orchestrator") {
      const waiting = this.world.waitingRanked();
      const idle = this.world.robots().some((r) => this.world.robotIdle(r));
      if (waiting.length || idle)
        this.enqueue({
          key: "startup:board:0",
          kind: "startup",
          priority: waiting.some((s) => this.world.tier(s) === 0) ? "critical" : "normal",
          at: this.deps.clock.now(),
          note: "startup: one cycle on the current board",
          survivorId: waiting[0]?.id,
        });
    }
  }

  handleChange(c: Change): void {
    if (this.stopped || !this.world.activeRun()) return;
    // agent.md 6.4: with no active run the agents wait; a new run starts them on the current board.
    if (c.table === "run" && c.op === "insert") {
      this.startupScan();
      return;
    }
    for (const rule of this.agent.wakeRules) {
      let outs;
      try {
        outs = rule(c, this.world, this.agent.name);
      } catch (err) {
        this.deps.log.error(this.agent.name, `wake rule failed: ${(err as Error).message}`);
        continue;
      }
      for (const o of outs) {
        if ("wake" in o) this.enqueue(o.wake);
        else {
          const h = this.deps.clock.setTimeout(() => {
            this.localTimers.delete(h);
            if (this.stopped) return;
            const w = o.check();
            if (w) this.enqueue(w);
          }, o.afterMs);
          this.localTimers.add(h);
        }
      }
    }
  }

  enqueue(w: Wake): void {
    if (this.stopped) return;
    const now = this.deps.clock.now();
    if (w.task) {
      const id = w.task.id;
      if (this.memory.handledTasks.has(id) || this.pendingTasks.some((p) => p.task!.id === id)) return;
      this.pendingTasks.push(w);
      if (w.priority === "critical") {
        this.kick(0);
        return;
      }
    } else {
      const prev = this.pendingRows.get(w.key);
      if (prev) {
        if (PRIO[w.priority] < PRIO[prev.priority]) prev.priority = w.priority;
      } else this.pendingRows.set(w.key, { ...w });
      if (w.priority === "critical" && this.tier0Since == null) this.tier0Since = w.at || now;
    }
    if (this.firstPendingAt == null) this.firstPendingAt = now;
    const due = Math.min(now + this.deps.cfg.DEBOUNCE_MS, this.firstPendingAt + this.deps.cfg.MAX_WAIT_MS);
    this.kick(Math.max(0, due - now));
  }

  private kick(ms: number): void {
    if (this.flushTimer != null) this.deps.clock.clearTimeout(this.flushTimer);
    this.flushTimer = this.deps.clock.setTimeout(() => {
      this.flushTimer = null;
      this.inflight = this.flush();
    }, ms);
  }

  private async flush(): Promise<void> {
    if (this.running || this.stopped) return;
    this.running = true;
    try {
      for (;;) {
        if (this.stopped) break;
        if (this.pendingTasks.length) {
          this.pendingTasks.sort((a, b) => PRIO[a.priority] - PRIO[b.priority] || a.at - b.at);
          const w = this.pendingTasks.shift()!;
          await this.runTask(w);
          continue;
        }
        if (this.pendingRows.size) {
          const all = [...this.pendingRows.values()].sort((a, b) => PRIO[a.priority] - PRIO[b.priority] || a.at - b.at);
          const batch = this.agent.mergeRowWakes ? all : [all[0]];
          for (const w of batch) this.pendingRows.delete(w.key);
          this.firstPendingAt = this.pendingRows.size ? this.deps.clock.now() : null;
          await this.runRows(batch);
          continue;
        }
        break;
      }
    } finally {
      this.running = false;
      this.firstPendingAt = this.pendingRows.size || this.pendingTasks.length ? this.deps.clock.now() : null;
    }
  }

  private async runTask(w: Wake): Promise<void> {
    const id = w.task!.id;
    if (this.memory.handledTasks.has(id)) return;
    const fresh = this.world.task(id) ?? w.task!;
    if (fresh.status !== "open") return;
    this.memory.handledTasks.add(id);
    const now = this.deps.clock.now();
    const stale = isStale(fresh, now);
    try {
      await this.board.claim(id);
    } catch (err) {
      this.deps.log.info(this.agent.name, `claim of task #${id} failed (${(err as Error).message}); dropped`);
      return;
    }
    const claimed = this.world.task(id) ?? fresh;
    const lease = claimed.lease_expires_at ?? now + 30_000;
    const input: CycleInput = {
      agent: this.agent.name,
      wakes: [w],
      task: claimed,
      chainId: resolveChain(this.world, claimed, [w]),
      priority: claimed.priority,
      deadlineAt: lease - 5000,
      startedAt: now,
      stale,
    };
    await this.cycle(input);
  }

  private async runRows(batch: Wake[]): Promise<void> {
    const now = this.deps.clock.now();
    const priority = batch.reduce<TaskPriority>((p, w) => (PRIO[w.priority] < PRIO[p] ? w.priority : p), "normal");
    const input: CycleInput = {
      agent: this.agent.name,
      wakes: batch,
      task: null,
      chainId: resolveChain(this.world, null, batch),
      priority,
      deadlineAt: now + this.agent.maxSteps * this.agent.timeoutMs,
      startedAt: now,
    };
    await this.cycle(input);
  }

  private async cycle(input: CycleInput): Promise<void> {
    const ctx = this.ctxFor(input);
    this.cycles++;
    this.deps.log.info(this.agent.name, `wake: ${input.wakes.map((w) => w.note).join("; ")} (chain ${input.chainId})`);
    try {
      await runCycle(ctx);
    } catch (err) {
      this.deps.log.error(this.agent.name, `cycle failed: ${(err as Error).message}`);
    }
    // 8.1: a tier 0 wake is covered once a cycle finishes, unless the model path failed.
    const failedModel = ctx.state.usedFallback && this.agent.name === "orchestrator";
    if (!failedModel) {
      const stillCritical = [...this.pendingRows.values()].find((w) => w.priority === "critical");
      this.tier0Since = stillCritical ? stillCritical.at : null;
    }
  }
}
