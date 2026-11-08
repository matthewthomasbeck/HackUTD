// Reducer calls one agent identity may make, in contract argument order (CONTRACTS.md v8,
// spacetimedb.md section 8). The live implementation is stdb/connect.ts; the fake module
// implements the same interface. Every method rejects with the module's error message.

import type { AgentName, AuditFlagStatus, BriefingKind, BriefingPriority, MissionKind, Role, TaskPriority } from "./types.ts";

export interface Actions {
  registerParticipant(name: string, role: Role): Promise<void>;
  agentHeartbeat(): Promise<void>;
  postAgentTask(
    to_agent: AgentName,
    kind: string,
    payload_json: string,
    priority: TaskPriority,
    reason: string,
    chain_id: number,
  ): Promise<void>;
  claimAgentTask(task_id: number): Promise<void>;
  completeAgentTask(task_id: number, status: "done" | "failed", result_json: string): Promise<void>;
  logAgentAction(
    tool: string,
    args_json: string,
    result: string,
    reason: string,
    step: number,
    model: string,
    chain_id: number,
  ): Promise<void>;
  proposeAssignment(survivor_id: number, rescuer_identity: string, reason: string): Promise<void>;
  createMission(
    robot_id: string,
    kind: MissionKind,
    target_cell_ids: number[],
    target_lat: number | null,
    target_lon: number | null,
    reason: string,
    chain_id: number,
  ): Promise<void>;
  cancelOwnMission(mission_id: number): Promise<void>;
  setAuditFlagStatus(flag_id: number, status: AuditFlagStatus): Promise<void>;
  postBriefing(
    audience: string,
    text: string,
    priority: BriefingPriority,
    survivor_id: number | null,
    kind: BriefingKind | null,
  ): Promise<void>;
}

export type DryRunMode = "0" | "1" | "log";

export const DRY_RESULT = "dry_run: not executed";

/**
 * DRY_RUN wrapper (agent.md 12.2).
 * - "1": no reducer reaches `real`. If a `shadow` is given (a fake module over an overlay of the
 *   live cache), writes go there so the chain still plays out in-process; otherwise they are no-ops.
 * - "log": the same, but log_agent_action reaches `real` with result "dry_run: not executed".
 */
export class DryRunActions implements Actions {
  constructor(
    private real: Actions,
    private mode: Exclude<DryRunMode, "0">,
    private shadow: Actions | null = null,
  ) {}
  private async sink<K extends keyof Actions>(k: K, ...args: Parameters<Actions[K]>): Promise<void> {
    if (!this.shadow) return;
    await (this.shadow[k] as (...a: unknown[]) => Promise<void>)(...args);
  }
  registerParticipant(name: string, role: Role) {
    return this.sink("registerParticipant", name, role);
  }
  agentHeartbeat() {
    return this.sink("agentHeartbeat");
  }
  postAgentTask(to: AgentName, kind: string, payload: string, prio: TaskPriority, reason: string, chain: number) {
    return this.sink("postAgentTask", to, kind, payload, prio, reason, chain);
  }
  claimAgentTask(id: number) {
    return this.sink("claimAgentTask", id);
  }
  completeAgentTask(id: number, status: "done" | "failed", result: string) {
    return this.sink("completeAgentTask", id, status, result);
  }
  async logAgentAction(tool: string, args: string, _result: string, reason: string, step: number, model: string, chain: number) {
    await this.sink("logAgentAction", tool, args, DRY_RESULT, reason, step, model, chain);
    if (this.mode === "log") await this.real.logAgentAction(tool, args, DRY_RESULT, reason, step, model, chain);
  }
  proposeAssignment(sid: number, rid: string, reason: string) {
    return this.sink("proposeAssignment", sid, rid, reason);
  }
  createMission(r: string, k: MissionKind, cells: number[], lat: number | null, lon: number | null, reason: string, chain: number) {
    return this.sink("createMission", r, k, cells, lat, lon, reason, chain);
  }
  cancelOwnMission(id: number) {
    return this.sink("cancelOwnMission", id);
  }
  setAuditFlagStatus(id: number, s: AuditFlagStatus) {
    return this.sink("setAuditFlagStatus", id, s);
  }
  postBriefing(a: string, t: string, p: BriefingPriority, sid: number | null, k: BriefingKind | null) {
    return this.sink("postBriefing", a, t, p, sid, k);
  }
}
