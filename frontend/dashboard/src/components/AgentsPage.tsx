// The Agents page: the hand-off chain for one survivor, a card per agent, the database fallback, and the live
// task board. Every step here is a row in SpacetimeDB (agent_task, agent_action), so it replays exactly.
import { Mascot, type MascotKind } from './Mascot';

export interface ChainOption { id: bigint; label: string; level: string }
export interface ChainStep { key: string; mascot: MascotKind; name: string; text: string; time: string; tone: 'robot' | 'orchestrator' | 'auditor' | 'comms' | 'rescuer' | 'database' | 'main' }
export interface AgentCardData { name: string; mascot: MascotKind; model: string; state: { text: string; tone: 'ok' | 'warn' | 'muted' }; about: string; stats: string[] }
export interface TimelineItem { key: string; time: string; tone: ChainStep['tone']; title: string; detail: string }

type Props = {
  chains: readonly ChainOption[];
  chainId: bigint | null;
  onChain: (id: bigint) => void;
  steps: readonly ChainStep[];
  agents: readonly AgentCardData[];
  fallback: { armed: boolean; text: string };
  timeline: readonly TimelineItem[];
};

const LEVEL_MARK: Record<string, string> = { immediate: '▲', delayed: '■', minor: '●', unknown: '◆' };

export function AgentsPage({ chains, chainId, onChain, steps, agents, fallback, timeline }: Props) {
  return <section className="agentspage" aria-label="Agents">
    <h1 className="page-title display">Agents</h1>
    <div className="chain-card">
      <div className="chain-top">
        <div><b>Hand-off chain</b> <span>{chainId !== null ? `chain #${chainId} · every step is a row on the agent_task board` : 'no chain yet'}</span></div>
        <div className="chain-pick">{chains.map((chain) => <button key={String(chain.id)} className={chain.id === chainId ? 'on' : ''} onClick={() => onChain(chain.id)}>{LEVEL_MARK[chain.level] ?? '◆'} {chain.label}</button>)}</div>
      </div>
      {steps.length === 0 ? <p className="empty">No hand-offs yet. When a robot reports a find, the chain from robot to rescuer appears here.</p>
        : <div className="steps">{steps.map((step, index) => <div key={step.key} className="step-wrap">
          {index > 0 && <span className="conn" />}
          <div className={`step tone-${step.tone}`}><Mascot kind={step.mascot} size={40} /><div><div className="nm">{step.name}</div><div className="st">{step.text}</div><div className="t">{step.time}</div></div></div>
        </div>)}</div>}
    </div>
    <div className="agents-body">
      <div className="agent-cards">
        {agents.map((agent) => <div key={agent.name} className="acard">
          <div className="top"><Mascot kind={agent.mascot} size={44} /><div><b>{agent.name}</b><span>{agent.model}</span></div><span className={`state tone-${agent.state.tone}`}><i className="sdot" />{agent.state.text}</span></div>
          <p>{agent.about}</p>
          <div className="kv">{agent.stats.map((stat) => <span key={stat}>{stat}</span>)}</div>
        </div>)}
        <div className="acard db">
          <div className="top"><Mascot kind="database" size={44} /><div><b>Database fallback</b><span>SpacetimeDB schedule tables</span></div><span className={`state tone-${fallback.armed ? 'ok' : 'muted'}`}><i className="sdot" />{fallback.armed ? 'Armed' : 'Idle'}</span></div>
          <p>{fallback.text}</p>
        </div>
      </div>
      <div className="timeline">
        <h2>Task board<span>live · newest first</span></h2>
        {timeline.length === 0 ? <p className="empty">The task board is empty for this run.</p>
          : <ol className="tl">{timeline.map((item) => <li key={item.key} className={`tone-${item.tone}`}><time>{item.time}</time><i /><div><b>{item.title}</b><small>{item.detail}</small></div></li>)}</ol>}
      </div>
    </div>
  </section>;
}
