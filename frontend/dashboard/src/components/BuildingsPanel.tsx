import { useState, type FormEvent } from 'react';
import { useBoard } from '../data/LiveSource';
import { enumTagToContract } from '../stdb/enums';
import { timestampToMs } from '../stdb/time';

export type PersonReportInput = { cellId: bigint; kind: 'missing' | 'safe'; count: number; nameOrUnit: string; note: string; source: 'family' | 'neighbor' | 'hotline' | 'coordinator' };
type Props = { readOnly: boolean; onReport: (input: PersonReportInput) => Promise<void>; selectedCellId?: bigint | null };

const sourceLabels: Record<PersonReportInput['source'], string> = { family: 'Family', neighbor: 'Neighbor', hotline: 'Hotline', coordinator: 'Coordinator' };

function ReportForm({ cellId, readOnly, onReport }: { cellId: bigint; readOnly: boolean; onReport: Props['onReport'] }) {
  const [kind, setKind] = useState<PersonReportInput['kind']>('missing');
  const [count, setCount] = useState('1');
  const [nameOrUnit, setNameOrUnit] = useState('');
  const [source, setSource] = useState<PersonReportInput['source']>('family');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError(''); setSaving(true);
    try {
      await onReport({ cellId, kind, count: Number(count), nameOrUnit, note, source });
      setCount('1'); setNameOrUnit(''); setNote('');
    } catch (issue) { setError(issue instanceof Error ? issue.message : String(issue)); }
    finally { setSaving(false); }
  };
  return <form className="person-report-form" onSubmit={submit}>
    <div className="report-form-grid">
      <label>Report type<select value={kind} onChange={(event) => setKind(event.target.value as PersonReportInput['kind'])}><option value="missing">Missing</option><option value="safe">Safe</option></select></label>
      <label>Count<input required min="1" max="500" type="number" value={count} onChange={(event) => setCount(event.target.value)} /></label>
      <label>Name or unit<input value={nameOrUnit} placeholder="unit 3B" onChange={(event) => setNameOrUnit(event.target.value)} /></label>
      <label>Source<select value={source} onChange={(event) => setSource(event.target.value as PersonReportInput['source'])}>{Object.entries(sourceLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    </div>
    <label>Note<textarea required value={note} onChange={(event) => setNote(event.target.value)} /></label>
    <p className="panel-hint">Enter what family, neighbors, or a hotline told you. Use a unit or a first name only.</p>
    {error && <p className="registration-error" role="alert">{error}</p>}
    <button className="button primary" type="submit" disabled={readOnly || saving || !note.trim()}>{saving ? 'Saving…' : 'Add person report'}</button>
  </form>;
}

export function BuildingsPanel({ readOnly, onReport, selectedCellId }: Props) {
  const board = useBoard();
  const cells = board.cells.filter((cell) => cell.siteId === board.site?.id && (cell.reportedMissing > 0 || cell.reportedSafe > 0 || cell.found > 0 || board.personReports.some((report) => report.cellId === cell.id) || board.survivors.some((survivor) => survivor.cellId === cell.id)))
    .sort((a, b) => b.unaccounted - a.unaccounted || a.label.localeCompare(b.label));
  return <section className="panel detail-tab-panel" aria-labelledby="buildings-title">
    <div className="panel-heading"><div><p className="eyebrow">WHAT WE KNOW ABOUT PEOPLE</p><h2 id="buildings-title">Buildings & reports</h2></div><span className="count-pill">{cells.length} cells with information</span></div>
    <p className="panel-hint">We show reports and finds without claiming a building is empty.</p>
    <div className="building-list">{cells.map((cell) => {
      const reports = board.personReports.filter((report) => report.cellId === cell.id).slice().sort((a, b) => timestampToMs(b.createdAt) - timestampToMs(a.createdAt));
      return <article className="building-card" key={cell.id.toString()}>
        <header><div><p className="eyebrow">{enumTagToContract(cell.status).replaceAll('_', ' ').toUpperCase()}</p><h3>{cell.label}</h3></div>{cell.unaccounted > 0 ? <strong className="unaccounted-badge">⚠ {cell.unaccounted} UNACCOUNTED</strong> : <span className="no-reports">{reports.length ? 'No unaccounted people' : 'No reports'}</span>}</header>
        <dl className="building-counts"><div><dt>Found</dt><dd>{cell.found}</dd></div><div><dt>Reported missing</dt><dd>{cell.reportedMissing}</dd></div><div><dt>Reported safe</dt><dd>{cell.reportedSafe}</dd></div></dl>
        {reports.length > 0 && <div className="building-reports"><h4>Reports</h4>{reports.map((report) => <div className="building-report" key={report.id.toString()}>
          <time>{new Date(timestampToMs(report.createdAt)).toLocaleTimeString()}</time><strong>{enumTagToContract(report.kind).toUpperCase()} · {report.count}</strong>
          <span>{report.nameOrUnit ?? 'Unit not specified'} · {enumTagToContract(report.source)} · {report.reportedBy}</span><p>{report.note}</p>
        </div>)}</div>}
        <details className="building-add-report" open={selectedCellId === cell.id}><summary>Add person report</summary><ReportForm cellId={cell.id} readOnly={readOnly} onReport={onReport} /></details>
      </article>;
    })}</div>
    {cells.length === 0 && <p className="empty-state">No reports or survivor findings yet.</p>}
  </section>;
}
