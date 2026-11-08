const agentStyles: Record<string, string> = {
  orchestrator: 'agent-chip orchestrator',
  auditor: 'agent-chip auditor',
  comms_agent: 'agent-chip comms',
  module: 'agent-chip module',
  human: 'agent-chip human',
};

export function AgentChip({ agent }: { agent: string }) {
  const label = agent === 'comms_agent' ? 'COMMS AGENT' : agent.replaceAll('_', ' ').toUpperCase();
  return <span className={agentStyles[agent] ?? 'agent-chip'}>{label}</span>;
}
