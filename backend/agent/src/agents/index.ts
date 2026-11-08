import type { AgentConfig } from "../agent-types.ts";
import type { Config } from "../config.ts";
import type { AgentName } from "../types.ts";
import { auditorConfig } from "./auditor.ts";
import { commsConfig } from "./comms.ts";
import { orchestratorConfig } from "./orchestrator.ts";

/** Adding an agent is one file in src/agents/ plus its name here and in the contract. */
export function buildAgent(name: AgentName, cfg: Config): AgentConfig {
  if (name === "orchestrator") return orchestratorConfig(cfg);
  if (name === "comms_agent") return commsConfig(cfg);
  return auditorConfig(cfg);
}
