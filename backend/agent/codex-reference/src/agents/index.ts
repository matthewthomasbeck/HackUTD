import { readFileSync } from 'node:fs';
import type { AgentConfig, AgentName } from '../types.js';
import type { Config } from '../config.js';
export function agentConfig(name: AgentName,cfg: Config): AgentConfig {
  const common={name,role:name==='auditor' ? 'auditor' as const : 'agent' as const,model:name==='orchestrator'?cfg.modelSuper:cfg.modelNano};
  const settings={
    orchestrator:{file:'orchestrator',tools:['get_board','get_survivor','list_rescuers','list_cells','get_robot','propose_assignment','delegate','set_flag_status','create_mission','cancel_own_mission',...(cfg.sitrep?['sitrep']:[])],timeoutMs:15000,maxSteps:4,maxToolCalls:8,maxTokens:1536},
    comms_agent:{file:'comms',tools:['get_survivor','send_briefing'],timeoutMs:6000,maxSteps:2,maxToolCalls:3,maxTokens:512},
    auditor:{file:'auditor',tools:['get_board','get_survivor','list_rescuers','submit_review'],timeoutMs:10000,maxSteps:2,maxToolCalls:3,maxTokens:512},
  }[name];
  return {...common,...settings,prompt:readFileSync(new URL(`./${settings.file}.prompt.txt`,import.meta.url),'utf8')};
}
