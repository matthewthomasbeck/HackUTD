// Typed configuration from the environment (.env through dotenv in index.ts and the scripts).
// Fails fast on a missing NVIDIA_API_KEY unless LLM_MODE=mock.

import type { AgentName } from "./types.ts";

export type ToolMode = "native" | "json";
export type DryRun = "0" | "1" | "log";
export type LlmMode = "nvidia" | "mock";

export interface Config {
  NVIDIA_API_KEY: string;
  NVIDIA_BASE_URL: string;
  MODEL_SUPER: string;
  MODEL_NANO: string;
  MODEL_VISION: string;
  TOOL_MODE: ToolMode;
  TOOL_MODE_SUPER: ToolMode;
  TOOL_MODE_NANO: ToolMode;
  RPM_BUDGET: number;
  AGENTS: AgentName[];
  STDB_URI: string;
  STDB_DATABASE: string;
  STDB_TOKEN_DIR: string;
  DRY_RUN: DryRun;
  LLM_MODE: LlmMode;
  ENABLE_VISION: boolean;
  ENABLE_SITREP: boolean;
  ENABLE_QUESTIONS: boolean;
  ENABLE_AUDITOR_MODEL: boolean;
  ENABLE_COMMS_MODEL: boolean;
  DEBOUNCE_MS: number;
  MAX_WAIT_MS: number;
  // Runner additions, documented in README.md.
  MOCK_FIXTURES: string[];
  NANO_THINKING_OFF: boolean;
  LOG_LEVEL: "debug" | "info" | "warn" | "error";
}

export class ConfigError extends Error {}

type Env = Record<string, string | undefined>;

function str(env: Env, key: string, def: string): string {
  const v = env[key];
  return v === undefined || v.trim() === "" ? def : v.trim();
}
function num(env: Env, key: string, def: number): number {
  const v = str(env, key, String(def));
  const n = Number(v);
  if (!Number.isFinite(n)) throw new ConfigError(`${key} must be a number, got "${v}"`);
  return n;
}
function bool(env: Env, key: string, def: boolean): boolean {
  const v = str(env, key, def ? "1" : "0").toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}
function oneOf<T extends string>(env: Env, key: string, allowed: readonly T[], def: T): T {
  const v = str(env, key, def) as T;
  if (!allowed.includes(v)) throw new ConfigError(`${key} must be one of ${allowed.join(", ")}, got "${v}"`);
  return v;
}

const ALL_AGENTS: AgentName[] = ["orchestrator", "comms_agent", "auditor"];

export function parseAgents(v: string): AgentName[] {
  if (v === "all") return [...ALL_AGENTS];
  const out: AgentName[] = [];
  for (const raw of v.split(",")) {
    const name = raw.trim();
    if (!name) continue;
    if (!ALL_AGENTS.includes(name as AgentName)) throw new ConfigError(`AGENTS: unknown agent "${name}"`);
    if (!out.includes(name as AgentName)) out.push(name as AgentName);
  }
  if (out.length === 0) throw new ConfigError("AGENTS is empty");
  return out;
}

export function loadConfig(env: Env = process.env, opts: { requireKey?: boolean } = {}): Config {
  const toolMode = oneOf(env, "TOOL_MODE", ["native", "json"] as const, "native");
  const cfg: Config = {
    NVIDIA_API_KEY: str(env, "NVIDIA_API_KEY", ""),
    NVIDIA_BASE_URL: str(env, "NVIDIA_BASE_URL", "https://integrate.api.nvidia.com/v1"),
    MODEL_SUPER: str(env, "MODEL_SUPER", "nvidia/nemotron-3.5-super-vl-120b-a12b"),
    MODEL_NANO: str(env, "MODEL_NANO", "nvidia/nemotron-3.5-lightning-30b-a3b"),
    MODEL_VISION: str(env, "MODEL_VISION", "nvidia/nemotron-nano-12b-v2-vl"),
    TOOL_MODE: toolMode,
    TOOL_MODE_SUPER: oneOf(env, "TOOL_MODE_SUPER", ["native", "json"] as const, toolMode),
    TOOL_MODE_NANO: oneOf(env, "TOOL_MODE_NANO", ["native", "json"] as const, toolMode),
    RPM_BUDGET: num(env, "RPM_BUDGET", 20),
    AGENTS: parseAgents(str(env, "AGENTS", "all")),
    STDB_URI: str(env, "STDB_URI", "ws://localhost:3000"),
    STDB_DATABASE: str(env, "STDB_DATABASE", ""),
    STDB_TOKEN_DIR: str(env, "STDB_TOKEN_DIR", ".tokens"),
    DRY_RUN: oneOf(env, "DRY_RUN", ["0", "1", "log"] as const, "0"),
    LLM_MODE: oneOf(env, "LLM_MODE", ["nvidia", "mock"] as const, "nvidia"),
    ENABLE_VISION: bool(env, "ENABLE_VISION", false),
    ENABLE_SITREP: bool(env, "ENABLE_SITREP", false),
    ENABLE_QUESTIONS: bool(env, "ENABLE_QUESTIONS", true),
    ENABLE_AUDITOR_MODEL: bool(env, "ENABLE_AUDITOR_MODEL", true),
    ENABLE_COMMS_MODEL: bool(env, "ENABLE_COMMS_MODEL", true),
    DEBOUNCE_MS: num(env, "DEBOUNCE_MS", 1500),
    MAX_WAIT_MS: num(env, "MAX_WAIT_MS", 4000),
    MOCK_FIXTURES: str(env, "MOCK_FIXTURES", "chain")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    NANO_THINKING_OFF: bool(env, "NANO_THINKING_OFF", false),
    LOG_LEVEL: oneOf(env, "LOG_LEVEL", ["debug", "info", "warn", "error"] as const, "info"),
  };
  if (cfg.RPM_BUDGET < 1) throw new ConfigError("RPM_BUDGET must be at least 1");
  const requireKey = opts.requireKey ?? true;
  if (requireKey && cfg.LLM_MODE === "nvidia" && !cfg.NVIDIA_API_KEY) {
    throw new ConfigError(
      "NVIDIA_API_KEY is missing. Put it in backend/agent/.env (never commit it), or run with LLM_MODE=mock.",
    );
  }
  return cfg;
}

export function toolModeFor(cfg: Config, model: string): ToolMode {
  if (model === cfg.MODEL_SUPER) return cfg.TOOL_MODE_SUPER;
  if (model === cfg.MODEL_NANO) return cfg.TOOL_MODE_NANO;
  return cfg.TOOL_MODE;
}
