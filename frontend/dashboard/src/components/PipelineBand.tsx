import { useBoard } from '../data/LiveSource';
import { enumTagToContract } from '../stdb/enums';

export function PipelineBand({ onOpenAgents }: { onOpenAgents: () => void }) {
  const board = useBoard();
  const immediateUnassigned = board.survivors.filter((row) => row.siteId === board.site?.id && enumTagToContract(row.criticalLevel) === 'immediate' && enumTagToContract(row.status) === 'unassigned').length;
  const searched = board.cells.filter((row) => row.siteId === board.site?.id && enumTagToContract(row.status) === 'searched').length;
  const partial = board.cells.filter((row) => row.siteId === board.site?.id && enumTagToContract(row.status) === 'partially_searched').length;
  const detections = board.run ? board.detections.filter((row) => row.runId === board.run?.id).length : board.detections.length;
  const resolved = board.survivors.filter((row) => row.siteId === board.site?.id && enumTagToContract(row.status) === 'resolved').length;
  const enRoute = board.survivors.filter((row) => enumTagToContract(row.status) === 'en_route').length;
  const stages = [
    { label: 'ROBOT SEARCH', value: `${searched} / ${board.cells.length}`, detail: `${partial} partially searched`, warning: board.robots.some((robot) => !robot.online) },
    { label: 'DETECTIONS', value: String(detections), detail: 'Thermal and camera findings', warning: false },
    { label: 'BREATHING + SCORE', value: `${board.survivors.filter((row) => enumTagToContract(row.criticalLevel) === 'immediate').length} IMMEDIATE`, detail: 'Urgency with confidence', warning: false },
    { label: 'AGENTS', value: String(board.agentTasks.length), detail: `${board.agentTasks.filter((row) => enumTagToContract(row.status) === 'open').length} open tasks`, warning: false },
    { label: 'ASSIGNMENTS', value: `${immediateUnassigned} IMMEDIATE`, detail: 'Unassigned survivors', warning: immediateUnassigned > 0 },
    { label: 'RESCUERS', value: String(enRoute), detail: `${board.participants.filter((row) => enumTagToContract(row.role) === 'rescuer' && row.online).length} online`, warning: false },
    { label: 'RESOLVED', value: String(resolved), detail: 'Human confirmed', warning: false },
  ];

  return <section className="pipeline-band" aria-label="Search pipeline">
    {stages.map((stage, index) => <button className={`pipeline-stage ${stage.warning ? 'warning' : ''}`} key={stage.label} onClick={index === 3 ? onOpenAgents : undefined} aria-label={index === 3 ? 'Open Agents panel' : undefined}>
      <span className="pipeline-index">{String(index + 1).padStart(2, '0')}</span><span className="pipeline-label">{stage.label}</span><strong>{stage.value}</strong><small>{stage.detail}</small>
    </button>)}
  </section>;
}
