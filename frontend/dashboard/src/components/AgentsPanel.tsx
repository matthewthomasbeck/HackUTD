import { useMemo } from 'react';
import { useBoard } from '../data/LiveSource';
import { listAgents } from '../model/agents';
import { orderChainRows, type ChainRow } from '../model/chains';
import { enumTagToContract } from '../stdb/enums';
import { formatCountdown, formatDuration, timestampToMs } from '../stdb/time';
import { AgentChip } from './AgentChip';

function friendlyAgent(agent: string): string {
  const names: Record<string, string> = {
    orchestrator: 'Orchestrator',
    comms_agent: 'Comms agent',
    auditor: 'Auditor',
    module: 'Module',
  };
  return names[agent] ?? agent;
}

export function AgentsPanel({ selectedId, isFullScreen, onSelectSurvivor }: {
  selectedId: bigint | null;
  isFullScreen: boolean;
  onSelectSurvivor: (id: bigint) => void;
}) {
  const board = useBoard();
  const agents = listAgents(board.participants, board.agentTasks, board.agentActions, board.now);
  const openTasks = board.agentTasks.filter((task) => ['open', 'claimed'].includes(enumTagToContract(task.status))).slice().sort((a, b) => Number(b.createdAt.microsSinceUnixEpoch - a.createdAt.microsSinceUnixEpoch));
  const selected = board.survivors.find((survivor) => survivor.id === selectedId);
  const chainRows = useMemo(() => {
    if (!selected) return [];
    const assignmentRows = board.assignments.filter((row) => row.survivorId === selected.id);
    const detectionRows = board.detections.filter((row) => row.survivorId === selected.id);
    const chainIds = new Set<bigint>([...assignmentRows.map((row) => row.chainId), ...detectionRows.map((row) => row.chainId)].filter((id) => id !== 0n));
    const rows: Array<ChainRow & { label: string; actor: string; detail: string }> = [];
    for (const id of chainIds) {
      for (const row of detectionRows.filter((item) => item.chainId === id)) rows.push({ ...row, source: 'detection', label: 'DETECTION', actor: row.robotId, detail: `${enumTagToContract(row.source).toUpperCase()} finding at ${row.locationNote || 'saved position'}` });
      for (const row of board.missions.filter((item) => item.chainId === id)) rows.push({ ...row, source: 'mission', label: 'MISSION', actor: row.createdBy, detail: `${enumTagToContract(row.kind)} · ${enumTagToContract(row.status)}` });
      for (const row of assignmentRows.filter((item) => item.chainId === id)) rows.push({ ...row, source: 'assignment', label: 'ASSIGNMENT', actor: row.createdBy, detail: `${enumTagToContract(row.status)} · ${row.releaseCause ? enumTagToContract(row.releaseCause) : 'awaiting action'}` });
      for (const row of board.agentTasks.filter((item) => item.chainId === id)) rows.push({ ...row, source: 'agent_task', label: enumTagToContract(row.kind).toUpperCase(), actor: `${row.fromAgent} to ${enumTagToContract(row.toAgent)}`, detail: row.reason });
      for (const row of board.agentActions.filter((item) => item.chainId === id)) rows.push({ ...row, source: 'agent_action', label: row.tool.toUpperCase(), actor: row.agent, detail: `${row.reason}${row.result ? ` · ${row.result}` : ''}` });
      for (const row of board.briefings.filter((item) => item.chainId === id)) rows.push({ ...row, source: 'briefing', label: 'BRIEFING', actor: row.createdBy, detail: row.text });
      const assignmentIds = new Set(assignmentRows.filter((item) => item.chainId === id).map((item) => item.id));
      for (const row of board.events.filter((item) => item.id === id || (item.entity === 'survivor' && item.entityId === selected.id) || (item.entity === 'assignment' && assignmentIds.has(item.entityId)))) {
        rows.push({ ...row, chainId: id, source: 'event', label: enumTagToContract(row.kind).replaceAll('_', ' ').toUpperCase(), actor: 'module', detail: row.message });
      }
    }
    return [...new Map([...chainIds].flatMap((id) => orderChainRows(rows, id)).map((row) => [row.id.toString() + row.source, row])).values()]
      .sort((a, b) => timestampToMs(a.createdAt) - timestampToMs(b.createdAt) || a.id.toString().localeCompare(b.id.toString()));
  }, [selected, board.assignments, board.detections, board.missions, board.agentTasks, board.agentActions, board.briefings, board.events]);

  return (
    <section className={`agents-panel ${isFullScreen ? 'agents-fullscreen' : ''}`} aria-label="Agents panel">
      <div className="panel-heading agents-heading">
        <div><p className="eyebrow">NVIDIA · MULTI-AGENT HANDOFF</p><h2>Agents</h2></div>
        <span className="panel-hint">Shared task board · live</span>
      </div>
      <div className="agent-status-row">
        {agents.map((agent) => {
          const participant = board.participants.find((person) => person.name === agent.name);
          const lastAction = agent.lastActionAt === null ? null : Math.max(0, Math.floor((board.now - agent.lastActionAt) / 1000));
          const currentTask = board.agentTasks.find((task) => enumTagToContract(task.toAgent) === agent.name && enumTagToContract(task.status) === 'claimed');
          const latestAction = board.agentActions.filter((action) => action.agent === agent.name).slice().sort((a, b) => Number(b.createdAt.microsSinceUnixEpoch - a.createdAt.microsSinceUnixEpoch))[0];
          return <article className={`agent-status-card status-${agent.status}`} key={agent.name}>
            <div className="agent-card-top"><AgentChip agent={agent.name} /><strong className={`agent-status-word ${agent.status}`}>{agent.status.replace('_', ' ').toUpperCase()}</strong></div>
            <p className="agent-card-heartbeat">{participant ? `heartbeat ${Math.max(0, Math.floor((board.now - timestampToMs(participant.lastHeartbeat)) / 1000))} s ago` : 'never connected'}</p>
            <p className="agent-card-task">{currentTask ? `${enumTagToContract(currentTask.kind)} · ${formatDuration(board.now - timestampToMs(currentTask.createdAt))}` : 'No active task'}</p>
            <p className="agent-card-action">{latestAction ? `${latestAction.tool}: ${latestAction.reason}` : lastAction !== null ? `last action ${lastAction} s ago` : 'No actions logged yet'}</p>
            {latestAction?.model === 'rules' && <span className="fallback-chip">RULES FALLBACK</span>}
          </article>;
        })}
        {agents.length === 0 && <p className="empty-state">Agents will appear here when they connect or receive a task.</p>}
      </div>
      <div className="agents-content-grid">
        <section className="panel-inset task-board">
          <div className="subpanel-heading"><h3>Task board</h3><span>{openTasks.length} active</span></div>
          <div className="task-columns">
            {(['open', 'claimed', 'done', 'failed'] as const).map((status) => {
              const tasks = board.agentTasks.filter((task) => {
                const tag = enumTagToContract(task.status);
                return status === 'failed' ? tag === 'failed' || tag === 'expired' : tag === status;
              }).slice().sort((a, b) => Number(b.createdAt.microsSinceUnixEpoch - a.createdAt.microsSinceUnixEpoch)).slice(0, status === 'open' || status === 'claimed' ? 20 : 8);
              return <div className="task-column" key={status}>
                <h4>{status === 'failed' ? 'FAILED / EXPIRED' : status.toUpperCase()} <span>{tasks.length}</span></h4>
                {tasks.map((task) => <details className={`task-card task-${enumTagToContract(task.status)}`} key={task.id.toString()}>
                  <summary><span className="task-id">#{task.id.toString()}</span><strong>{task.kind}</strong><span className="task-priority">{enumTagToContract(task.priority).toUpperCase()}</span></summary>
                  <p>{task.fromAgent} to {enumTagToContract(task.toAgent)}</p><p>{task.reason}</p>
                  {task.leaseExpiresAt && <p className="mono">lease {formatCountdown(Math.max(0, timestampToMs(task.leaseExpiresAt) - board.now))}</p>}
                  <pre>{task.payloadJson}</pre>{task.resultJson && <pre>{task.resultJson}</pre>}
                </details>)}
                {tasks.length === 0 && <p className="empty-column">No tasks</p>}
              </div>;
            })}
          </div>
        </section>
        <section className="panel-inset chain-panel">
          <div className="subpanel-heading"><h3>Chain per survivor</h3>
            <select aria-label="Select survivor chain" value={selectedId?.toString() ?? ''} onChange={(event) => { const id = event.target.value; if (id) onSelectSurvivor(BigInt(id)); }}>
              {board.survivors.slice().sort((a, b) => Number(b.createdAt.microsSinceUnixEpoch - a.createdAt.microsSinceUnixEpoch)).slice(0, 25).map((survivor) => <option key={survivor.id.toString()} value={survivor.id.toString()}>#{survivor.id.toString()} · {survivor.houseLabel ?? 'No house'} · {enumTagToContract(survivor.criticalLevel).toUpperCase()}</option>)}
            </select>
          </div>
          {selected ? <>
            <p className="chain-summary">#{selected.id.toString()} · {selected.houseLabel ?? 'No house'} · {selected.scoreReasons[0] ?? 'Triage details pending'}</p>
            <div className="chain-steps">
              {chainRows.map((row) => <article className={`chain-step ${row.label.includes('DISAGREE') ? 'disagreement' : ''}`} key={`${row.source}-${row.id.toString()}`}>
                <time>{formatDuration(Math.max(0, timestampToMs(row.createdAt) - timestampToMs(selected.createdAt)))}</time>
                <div><strong>{row.label}</strong><span>{friendlyAgent(row.actor)}</span><p>{row.detail}</p></div>
                {row.source === 'agent_action' && <AgentChip agent={row.actor} />}
              </article>)}
              {chainRows.length === 0 && <p className="empty-state">No handoff events recorded for this survivor yet.</p>}
            </div>
          </> : <p className="empty-state">Select a survivor to inspect its chain.</p>}
        </section>
      </div>
      <section className="panel-inset agent-action-log">
        <div className="subpanel-heading"><h3>Action log</h3><span>Newest first · {board.agentActions.length} actions</span></div>
        <div className="action-log-list">
          {board.agentActions.slice().sort((a, b) => Number(b.createdAt.microsSinceUnixEpoch - a.createdAt.microsSinceUnixEpoch)).slice(0, 40).map((action) => <article className="action-log-row" key={action.id.toString()}>
            <time>{new Date(timestampToMs(action.createdAt)).toLocaleTimeString()}</time><AgentChip agent={action.agent} /><span className="tool-name">{action.tool}</span><p>{action.reason}</p><span className="action-result">{action.result}</span>{action.model === 'rules' && <span className="fallback-chip">RULES FALLBACK</span>}
          </article>)}
          {board.agentActions.length === 0 && <p className="empty-state">Agent tool calls will appear here in time order.</p>}
        </div>
      </section>
    </section>
  );
}
