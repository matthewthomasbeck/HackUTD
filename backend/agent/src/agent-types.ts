// Shapes shared by the runner and the agent configurations (agent.md 5.1).

import type { Actions, DryRunMode } from "./actions.ts";
import type { Board } from "./board.ts";
import type { Clock } from "./clock.ts";
import type { Config } from "./config.ts";
import type { LlmGateway } from "./llm/client.ts";
import type { Logger } from "./log.ts";
import type { ToolName } from "./tools/schemas.ts";
import type { AgentName, AgentTask, Change, Role, TaskPriority } from "./types.ts";
import type { World } from "./world.ts";

export interface Wake {
  /** Merge key `kind:entity:id`, so one change is one wake. */
  key: string;
  kind: string;
  priority: TaskPriority;
  at: number;
  note: string;
  task?: AgentTask;
  survivorId?: number;
  assignmentId?: number;
  chainId?: number;
}

/** A wake rule returns wakes now, and/or local timers that may produce a wake later. */
export type WakeOutput = { wake: Wake } | { afterMs: number; check: () => Wake | null };
export type WakeRule = (c: Change, w: World, self: AgentName) => WakeOutput[];

export interface CycleInput {
  agent: AgentName;
  wakes: Wake[];
  task: AgentTask | null;
  chainId: number;
  priority: TaskPriority;
  deadlineAt: number;
  startedAt: number;
  /** An open task older than 120 s: completed by the fallback with result_json.stale = true. */
  stale?: boolean;
}

/** In-process memory between cycles (agent.md 5.2): briefings sent, nudges sent, proposals made. */
export interface AgentMemory {
  briefings: Map<string, number>;
  nudged: Set<number>;
  navSent: Set<number>;
  watchdogBriefed: Set<number>;
  proposals: Map<number, number>;
  handledTasks: Set<number>;
  lastModelDownLogged: Map<string, number>;
  /** Last agent_heartbeat this agent sent (the orchestrator's packet shows the watchdog countdown). */
  lastHeartbeatAt: number;
}

export function newMemory(): AgentMemory {
  return {
    briefings: new Map(),
    nudged: new Set(),
    navSent: new Set(),
    watchdogBriefed: new Set(),
    proposals: new Map(),
    handledTasks: new Set(),
    lastModelDownLogged: new Map(),
    lastHeartbeatAt: 0,
  };
}

export interface CycleState {
  step: number;
  toolCalls: number;
  model: string;
  proposals: Array<{ survivor_id: number; rescuer_identity: string; assignment_id: number | null }>;
  delegatedSurvivors: Set<number>;
  briefingsSent: number;
  lastBriefing: { text: string; audience: string; briefing_id: number | null } | null;
  taskCompleted: boolean;
  summary: string;
  usedFallback: boolean;
  /** chain_id of the tool call being dispatched (one cycle can cover several survivors). */
  callChain: number | null;
  /** Last rejected write ("tool: error"), named in the fallback reason. */
  lastRejection: string | null;
}

export function newCycleState(model: string): CycleState {
  return {
    step: 0,
    toolCalls: 0,
    model,
    proposals: [],
    delegatedSurvivors: new Set(),
    briefingsSent: 0,
    lastBriefing: null,
    taskCompleted: false,
    summary: "",
    usedFallback: false,
    callChain: null,
    lastRejection: null,
  };
}

export interface RuntimeDeps {
  cfg: Config;
  clock: Clock;
  log: Logger;
  llm: LlmGateway;
  dryRun: DryRunMode;
  /** True when writes go to an in-process fake module (scenarios); posts are checked there. */
  fakeModule?: boolean;
}

export interface CycleCtx {
  agent: AgentConfig;
  deps: RuntimeDeps;
  world: World;
  actions: Actions;
  board: Board;
  input: CycleInput;
  state: CycleState;
  memory: AgentMemory;
}

export interface AgentConfig {
  name: AgentName;
  role: Extract<Role, "agent" | "auditor">;
  model: string;
  systemPrompt: string;
  tools: ToolName[];
  wakeRules: WakeRule[];
  timeoutMs: number;
  maxSteps: number;
  maxToolCalls: number;
  maxTokens: number;
  /** Tools offered on the last allowed model request, so the cycle ends with its write
   * (auditor: submit_review; comms agent: send_briefing) instead of another read. */
  finalTools?: ToolName[];
  /** Merge row wakes into one cycle (orchestrator) or run them one by one (comms agent). */
  mergeRowWakes: boolean;
  /** Seconds between heartbeats while healthy (orchestrator 5 s with the 8.1 policy, others 10 s). */
  heartbeatMs: number;
  buildWakePacket(w: World, input: CycleInput, ctx: CycleCtx): string;
  /** False skips the model for this cycle (ENABLE_*_MODEL=0, template-only wakes). */
  useModel(ctx: CycleCtx): boolean;
  /** Deterministic path (agent.md section 9); logged with model "rules" and "[fallback]" reasons. */
  fallback(ctx: CycleCtx, why: string): Promise<void>;
  /** After the model loop: did the cycle do its job? If not, the fallback runs. */
  satisfied(ctx: CycleCtx): boolean;
  /** True once the cycle's job is done, so the loop stops without asking the model for a summary. */
  finished?(ctx: CycleCtx): boolean;
  /** Hook after the model loop (for example the auto brief_rescuer post). */
  afterModel?(ctx: CycleCtx): Promise<void>;
}
