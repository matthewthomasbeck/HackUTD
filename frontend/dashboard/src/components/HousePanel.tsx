// The panel for one house, opened by clicking it on the map: its state, its search cell and person reports,
// and the coordinator's actions (send a robot, mark the search, add a family or neighbor report).
import { useState, type FormEvent } from 'react';
import type { CellLike, HouseView } from '../site/houses';

export interface CellCounts extends CellLike { found: number; reportedMissing: number; reportedSafe: number }

export type PersonReportInput = { cellId: bigint; kind: 'missing' | 'safe'; count: number; nameOrUnit: string; note: string; source: 'family' | 'neighbor' | 'hotline' | 'coordinator' };
export type HouseAction = 'send' | 'searched' | 'partial';
export interface ReportRow { id: bigint; text: string; time: string }

type Props = {
  view: HouseView<CellCounts>;
  reports: readonly ReportRow[];
  canSendRobot: boolean;
  readOnly: boolean;
  onAction: (action: HouseAction, cellId: bigint) => void;
  onReport: (input: PersonReportInput) => Promise<void>;
  onClose: () => void;
};

const STATE_TEXT: Record<string, string> = {
  immediate: 'IMMEDIATE survivor inside', delayed: 'DELAYED survivor inside', minor: 'MINOR survivor inside', unscored: 'Survivor not scored yet',
  unaccounted: 'People unaccounted for', searching: 'Robot searching now', partial: 'Partly searched, still open', searched: 'Searched, clear', unsearched: 'Not searched yet',
};

export function HousePanel({ view, reports, canSendRobot, readOnly, onAction, onReport, onClose }: Props) {
  const { house, cell, state } = view;
  const [kind, setKind] = useState<PersonReportInput['kind']>('missing');
  const [count, setCount] = useState('1');
  const [source, setSource] = useState<PersonReportInput['source']>('family');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!cell) return;
    setBusy(true);
    try { await onReport({ cellId: cell.id, kind, count: Number(count), nameOrUnit: '', note, source }); setNote(''); } catch { /* shown as a toast */ } finally { setBusy(false); }
  };
  return <section className="fcard house-panel" aria-label={`House ${house.address}`}>
    <header><h3>{house.address || 'House'}</h3><button className="close" aria-label="Close" onClick={onClose}>×</button></header>
    <p className={`house-state state-${state}`}>{STATE_TEXT[state]}</p>
    {cell ? <>
      <dl className="cell-counts">
        <div><dt>Found</dt><dd>{cell.found}</dd></div><div><dt>Reported missing</dt><dd>{cell.reportedMissing}</dd></div>
        <div><dt>Reported safe</dt><dd>{cell.reportedSafe}</dd></div><div><dt>Unaccounted</dt><dd className={cell.unaccounted > 0 ? 'warn' : ''}>{cell.unaccounted}</dd></div>
      </dl>
      {reports.length > 0 && <ul className="reports">{reports.map((report) => <li key={String(report.id)}><time>{report.time}</time>{report.text}</li>)}</ul>}
      {!readOnly && <>
        <div className="house-actions">
          <button className="btn" disabled={!canSendRobot} title={canSendRobot ? '' : 'No robot is online'} onClick={() => onAction('send', cell.id)}>Send robot</button>
          <button className="btn ghost" onClick={() => onAction('searched', cell.id)}>Mark searched</button>
          <button className="btn ghost" onClick={() => onAction('partial', cell.id)}>Mark partial</button>
        </div>
        <form className="report-form" onSubmit={submit}>
          <select aria-label="Report type" value={kind} onChange={(event) => setKind(event.target.value as PersonReportInput['kind'])}><option value="missing">Missing</option><option value="safe">Safe</option></select>
          <input aria-label="People" type="number" min={1} max={500} value={count} onChange={(event) => setCount(event.target.value)} />
          <select aria-label="Source" value={source} onChange={(event) => setSource(event.target.value as PersonReportInput['source'])}><option value="family">Family</option><option value="neighbor">Neighbor</option><option value="hotline">Hotline</option><option value="coordinator">Coordinator</option></select>
          <input aria-label="Note" placeholder="Note, e.g. both were home" value={note} onChange={(event) => setNote(event.target.value)} />
          <button className="btn" disabled={busy}>Add report</button>
        </form>
      </>}
    </> : <p className="empty">This house has no search cell yet, so it cannot take reports or missions.</p>}
  </section>;
}
