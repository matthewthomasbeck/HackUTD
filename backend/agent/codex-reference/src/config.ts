import 'dotenv/config';
import type { AgentName } from './types.js';

export function loadConfig(env = process.env) {
  const flag = (key: string, fallback: boolean) => env[key] === undefined ? fallback : env[key] === '1';
  const integer = (key: string, fallback: number) => {
    const value = Number(env[key] ?? fallback);
    if (!Number.isInteger(value) || value < 1) throw new Error(`${key} must be a positive integer`);
    return value;
  };
  const dryRun = env.DRY_RUN ?? '0';
  if (!['0', '1', 'log'].includes(dryRun)) throw new Error('DRY_RUN must be 0, 1, or log');
  const names: AgentName[] = ['orchestrator', 'comms_agent', 'auditor'];
  const agents = !env.AGENTS || env.AGENTS === 'all' ? names : env.AGENTS.split(',') as AgentName[];
  if (agents.some(a => !names.includes(a))) throw new Error('Unknown AGENTS entry');
  const mode = env.TOOL_MODE || 'native';
  if (![mode, env.TOOL_MODE_SUPER || mode, env.TOOL_MODE_NANO || mode].every(m => ['json', 'native'].includes(m))) throw new Error('Tool mode must be native or json');
  if (!['mock', 'nvidia'].includes(env.LLM_MODE || 'nvidia')) throw new Error('LLM_MODE must be mock or nvidia');
  return {
    apiKey: env.NVIDIA_API_KEY || '', baseURL: env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1',
    modelSuper: env.MODEL_SUPER || 'nvidia/nemotron-3-super-120b-a12b',
    modelNano: env.MODEL_NANO || 'nvidia/nemotron-3-nano-30b-a3b',
    modelVision: env.MODEL_VISION || 'nvidia/nemotron-nano-12b-v2-vl',
    toolModeSuper: env.TOOL_MODE_SUPER || mode, toolModeNano: env.TOOL_MODE_NANO || mode,
    rpm: integer('RPM_BUDGET', 20), agents, dryRun: dryRun as '0' | '1' | 'log',
    llmMode: env.LLM_MODE || 'nvidia', stdbUri: env.STDB_URI || 'ws://localhost:3000',
    database: env.STDB_DATABASE || '', tokenDir: env.STDB_TOKEN_DIR || '.tokens',
    commsModel: flag('ENABLE_COMMS_MODEL', false), auditorModel: flag('ENABLE_AUDITOR_MODEL', true),
    questions: flag('ENABLE_QUESTIONS', true), vision: flag('ENABLE_VISION', false), sitrep: flag('ENABLE_SITREP', false),
    nanoThinkingOff: flag('NANO_THINKING_OFF', false), debounceMs: integer('DEBOUNCE_MS', 1500), maxWaitMs: integer('MAX_WAIT_MS', 4000),
  };
}
export type Config = ReturnType<typeof loadConfig>;
