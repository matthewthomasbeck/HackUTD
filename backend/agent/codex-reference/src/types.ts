export type AgentName = 'orchestrator' | 'comms_agent' | 'auditor';
export type Priority = 'critical' | 'high' | 'normal';
export type Row = Record<string, any>;
export interface Wake { kind: string; priority: Priority; chain_id?: number; survivor_id?: number; task_id?: number; assignment_id?: number; created_at?: number }
export interface Action { tool: string; args: Row }
export interface Reply { actions: Action[]; done?: boolean; summary?: string }
export interface AgentConfig { name: AgentName; role: 'agent' | 'auditor'; model: string; prompt: string; tools: string[]; timeoutMs: number; maxSteps: number; maxToolCalls: number; maxTokens: number }
export interface Actions { call(name: string, args: Row): Promise<void> }
export interface Trace { agent: AgentName; model: string; tool: string; args: Row; result: unknown; reason: string; step: number; chain_id: number }
