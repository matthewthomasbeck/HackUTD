import { useBoard } from '../data/LiveSource';
import { enumTagToContract } from '../stdb/enums';
import { formatCountdown } from '../stdb/time';
import { countdownForDueAt } from '../model/timers';

type Props = { readOnly: boolean; onApprove: (id: bigint) => void; onCancel: (id: bigint) => void };

export function MissionQueuePanel({ readOnly, onApprove, onCancel }: Props) {
  const board = useBoard();
  const live = board.missions.filter((mission) => ['proposed', 'queued', 'leased', 'active'].includes(enumTagToContract(mission.status)));
  const recent = board.missions.filter((mission) => ['done', 'failed', 'cancelled'].includes(enumTagToContract(mission.status))).sort((a, b) => Number(b.updatedAt.microsSinceUnixEpoch - a.updatedAt.microsSinceUnixEpoch)).slice(0, 5);
  const all = [...live, ...recent];
  return <section className="panel mission-panel" aria-labelledby="missions-title">
    <div className="panel-heading"><div><p className="eyebrow">ROBOT DISPATCH</p><h2 id="missions-title">Mission queue</h2></div><span className="count-pill">{live.length} live</span></div>
    <div className="mission-list">{all.map((mission) => {
      const status = enumTagToContract(mission.status);
      const creator = board.participants.find((row) => row.name === mission.createdBy);
      const agent = creator && ['agent', 'auditor'].includes(enumTagToContract(creator.role));
      const targets = mission.targetCellIds.map((cellId) => board.cells.find((cell) => cell.id === cellId)?.label ?? `cell #${cellId}`).join(', ')
        || (mission.targetLat != null && mission.targetLon != null ? `${mission.targetLat.toFixed(5)}, ${mission.targetLon.toFixed(5)}` : 'No target recorded');
      const countdown = mission.leaseExpiresAt ? countdownForDueAt(mission.leaseExpiresAt, board.now, board.timers.leases.some((row) => row.entityId === mission.id) ? 'SCHEDULE TABLE' : 'DERIVED') : null;
      return <article className={`mission-card ${status}`} key={mission.id.toString()}>
        <header><div><strong>Mission #{mission.id} · {enumTagToContract(mission.kind).replaceAll('_', ' ')}</strong><span>{mission.robotId} · {targets}</span></div><span className={`mission-status ${status}`}>{status.toUpperCase()}</span></header>
        {countdown && ['leased', 'active'].includes(status) && <p>Lease · {formatCountdown(countdown.remainingMs)} <span className="source-chip">{countdown.source}</span></p>}
        <p className="mission-reason">{mission.reason}</p>
        <p>Created by {mission.createdBy} · <span className="source-chip">{agent ? 'AGENT' : 'HUMAN'}</span></p>
        {status === 'proposed' && <div className="mission-actions"><strong>NEEDS APPROVAL</strong><button className="button primary" disabled={readOnly} onClick={() => onApprove(mission.id)}>Approve</button><button className="button secondary" disabled={readOnly} onClick={() => onCancel(mission.id)}>Cancel</button></div>}
      </article>;
    })}</div>
    {all.length === 0 && <p className="empty-state">No robot missions posted.</p>}
  </section>;
}
