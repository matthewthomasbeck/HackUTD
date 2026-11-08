import { useBoard } from '../data/LiveSource';
import { enumTagToContract } from '../stdb/enums';
import { timestampToMs, formatCountdown } from '../stdb/time';
import { countdownForDueAt } from '../model/timers';

const releaseLabels: Record<string, string> = {
  declined: 'released by rescuer', expired: 'lease expired', heartbeat: 'heartbeat missed',
  disconnected: 'glasses disconnected', reassigned: 'reassigned by coordinator',
};

export function AssignmentsPanel() {
  const board = useBoard();
  const ranks = new Map(board.survivors.slice().sort((a, b) => b.criticalScore - a.criticalScore).map((row, index) => [row.id, index + 1]));
  const visible = board.assignments.filter((row) => {
    const survivor = board.survivors.find((item) => item.id === row.survivorId);
    if (board.site && survivor?.siteId !== board.site.id) return false;
    const status = enumTagToContract(row.status);
    return status === 'proposed' || status === 'active' || ((status === 'released' || status === 'completed') && board.now - timestampToMs(row.updatedAt) <= 60_000);
  }).sort((a, b) => timestampToMs(b.updatedAt) - timestampToMs(a.updatedAt));
  return <section className="panel detail-tab-panel" aria-labelledby="assignments-title">
    <div className="panel-heading"><div><p className="eyebrow">RESCUER ACKNOWLEDGEMENTS</p><h2 id="assignments-title">Assignments</h2></div><span className="count-pill">{visible.filter((row) => ['proposed', 'active'].includes(enumTagToContract(row.status))).length} active</span></div>
    <div className="assignment-list">{visible.map((assignment) => {
      const status = enumTagToContract(assignment.status);
      const survivor = board.survivors.find((row) => row.id === assignment.survivorId);
      const rescuer = board.participants.find((row) => row.identity.toHexString() === assignment.rescuerIdentity.toHexString());
      const creator = board.participants.find((row) => row.name === assignment.createdBy);
      const agent = creator && ['agent', 'auditor'].includes(enumTagToContract(creator.role));
      const lease = board.timers.leases.find((row) => row.entityId === assignment.id && enumTagToContract(row.kind) === (status === 'proposed' ? 'proposal' : 'assignment'));
      const remaining = countdownForDueAt(lease?.dueAt ?? assignment.leaseExpiresAt, board.now, lease ? 'SCHEDULE TABLE' : 'DERIVED');
      const leaseTotal = Math.max(1, (status === 'proposed' ? board.site?.proposalLeaseS : board.site?.assignmentLeaseS) ?? 1) * 1000;
      const progress = Math.min(100, Math.max(0, remaining.remainingMs / leaseTotal * 100));
      const releaseCause = assignment.releaseCause ? enumTagToContract(assignment.releaseCause) : '';
      const releaseText = releaseCause === 'expired' && !assignment.acceptedAt ? 'not acknowledged in time' : releaseLabels[releaseCause] ?? 'cause unavailable';
      return <article className={`assignment-card ${status} ${releaseCause}`} key={assignment.id.toString()}>
        <header><div><strong>#{ranks.get(assignment.survivorId) ?? '--'} · Survivor #{assignment.survivorId}</strong><span>{survivor?.houseLabel ?? 'No house label'} · {survivor ? enumTagToContract(survivor.criticalLevel).toUpperCase() : 'survivor not loaded'}</span></div><span className={`assignment-state ${status}`}>{status.toUpperCase()}</span></header>
        <p><strong>Rescuer:</strong> {rescuer?.name ?? assignment.rescuerIdentity.toHexString().slice(0, 10)} <span className="source-chip">{agent ? 'AGENT' : 'HUMAN'} · {assignment.createdBy}</span></p>
        {status === 'proposed' && <p className="assignment-warning">WAITING FOR ACKNOWLEDGEMENT ON THE GLASSES · {formatCountdown(remaining.remainingMs)}</p>}
        {status === 'active' && <div className={`lease-meter ${remaining.state}`}><div><strong>{remaining.state === 'expiring' ? 'EXPIRING' : remaining.state === 'expired' ? 'EXPIRED, waiting for the database' : 'Lease'}</strong><span>{formatCountdown(remaining.remainingMs)}</span></div><progress max="100" value={progress} aria-label={`Assignment lease ${Math.round(progress)} percent remains`} /></div>}
        {status === 'released' && <p className={releaseCause === 'disconnected' ? 'disconnect-cause' : 'released-cause'}>RELEASED, survivor back on the board · {releaseText}</p>}
        {status === 'completed' && <p className="released-cause">Completed · {new Date(timestampToMs(assignment.updatedAt)).toLocaleTimeString()}</p>}
      </article>;
    })}</div>
    {visible.length === 0 && <p className="empty-state">No assignments yet.</p>}
  </section>;
}
