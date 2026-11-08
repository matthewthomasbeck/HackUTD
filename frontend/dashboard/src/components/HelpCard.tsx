// "Who needs help first": the critical count and the ranked survivors; the count in the header folds the card.
// Selecting a row opens its evidence and the coordinator's actions (assign a rescuer, resolve).
import { useState, type FormEvent } from 'react';
import type { HouseState } from '../site/houses';
import { CardHeader, useCollapsed } from './CardHeader';

export interface HelpRow {
  id: bigint;
  level: string;
  place: string;
  score: string;
  why: string;
  status: { text: string; tone: 'ok' | 'warn' | 'muted' };
  details: string[];
  canAssign: boolean;
}
export type Resolution = 'rescued' | 'handed_off' | 'false_alarm' | 'duplicate';

type Props = {
  critical: number;
  rows: readonly HelpRow[];
  selectedId: bigint | null;
  rescuers: ReadonlyArray<{ id: string; name: string }>;
  readOnly: boolean;
  onSelect: (id: bigint | null) => void;
  onAssign: (survivorId: bigint, rescuerId: string) => Promise<void>;
  onResolve: (survivorId: bigint, resolution: Resolution, note: string) => Promise<void>;
};

const LEVEL_TEXT: Record<string, string> = { immediate: 'IMMEDIATE', delayed: 'DELAYED', minor: 'MINOR', unknown: 'NOT SCORED' };

export function LevelGlyph({ level, size = 18 }: { level: HouseState | string; size?: number }) {
  return <svg className={`glyph glyph-${level}`} width={size} height={size} viewBox="0 0 12 12" aria-hidden="true">
    {level === 'immediate' ? <path d="M6 1 L11 11 H1 Z" />
      : level === 'delayed' ? <rect x="1.5" y="1.5" width="9" height="9" />
        : level === 'minor' ? <circle cx="6" cy="6" r="4.5" />
          : level === 'searched' ? <path d="M2 6.5 L5 9.5 L10 3" />
            : level === 'unsearched' || level === 'searching' ? <circle cx="6" cy="6" r="2.2" />
              : <path d="M6 1 L11 6 L6 11 L1 6 Z" />}
  </svg>;
}

function Actions({ row, rescuers, onAssign, onResolve }: { row: HelpRow } & Pick<Props, 'rescuers' | 'onAssign' | 'onResolve'>) {
  const [rescuer, setRescuer] = useState(rescuers[0]?.id ?? '');
  const [resolution, setResolution] = useState<Resolution>('rescued');
  const [busy, setBusy] = useState(false);
  const run = async (event: FormEvent, action: () => Promise<void>) => {
    event.preventDefault();
    setBusy(true);
    try { await action(); } catch { /* the app shows the reducer error as a toast */ } finally { setBusy(false); }
  };
  return <div className="row-actions">
    {row.canAssign && <form onSubmit={(event) => run(event, () => onAssign(row.id, rescuer))}>
      <select aria-label="Rescuer" value={rescuer} onChange={(event) => setRescuer(event.target.value)} disabled={!rescuers.length}>
        {rescuers.length ? rescuers.map((person) => <option key={person.id} value={person.id}>{person.name}</option>) : <option>No rescuer online</option>}
      </select>
      <button className="btn" disabled={busy || !rescuer}>Propose rescuer</button>
    </form>}
    <form onSubmit={(event) => run(event, () => onResolve(row.id, resolution, ''))}>
      <select aria-label="Resolution" value={resolution} onChange={(event) => setResolution(event.target.value as Resolution)}>
        <option value="rescued">Rescued</option><option value="handed_off">Handed off</option><option value="false_alarm">False alarm</option><option value="duplicate">Duplicate</option>
      </select>
      <button className="btn ghost" disabled={busy}>Resolve</button>
    </form>
  </div>;
}

export function HelpCard({ critical, rows, selectedId, rescuers, readOnly, onSelect, onAssign, onResolve }: Props) {
  const { collapsed, toggle } = useCollapsed();
  const [levelFilter, setLevelFilter] = useState<string | null>(null);
  const levels = [
    { key: 'immediate', label: 'Immediate', count: critical },
    { key: 'delayed', label: 'Delayed', count: rows.filter((row) => row.level === 'delayed').length },
    { key: 'minor', label: 'Minor', count: rows.filter((row) => row.level === 'minor').length },
    { key: 'unknown', label: 'Not scored', count: rows.filter((row) => row.level === 'unknown').length },
  ];
  const visibleRows = levelFilter ? rows.filter((row) => row.level === levelFilter) : rows;
  return <section className={`fcard help ${collapsed ? 'collapsed' : ''}`} aria-label="Who needs help first">
    <CardHeader title="Who needs help first" count={<span title={`${rows.length} people on the board`}>{rows.length}</span>} collapsed={collapsed} onToggle={toggle} display />
    {!collapsed && <>
    <div className="triage-summary" aria-label="People by triage level">
      {levels.map((level) => <button type="button" key={level.key} className={`triage-count triage-${level.key}`}
        aria-label={`Filter ${level.label}: ${level.count} people`} aria-pressed={levelFilter === level.key}
        onClick={() => setLevelFilter(levelFilter === level.key ? null : level.key)}>
        <div><LevelGlyph level={level.key} size={14} /><b>{level.count}</b></div><span>{level.label}</span>
      </button>)}
    </div>
    <p className="queue-explainer">{rows.length} people on the board · urgency score out of 100<br />Higher scores need help sooner. Select a person for evidence.</p>
    {levelFilter && <button className="queue-reset" onClick={() => setLevelFilter(null)}>Show all {rows.length} people</button>}
    <div className="rows">
      {rows.length === 0 && <p className="empty">No one found yet. Survivors appear here the moment a robot reports a find.</p>}
      {rows.length > 0 && visibleRows.length === 0 && <p className="empty">No people in this triage level.</p>}
      {visibleRows.map((row) => {
        const open = row.id === selectedId;
        return <article key={String(row.id)} className={`row triage-${row.level} ${open ? 'sel' : ''}`}>
          <button className="row-main" aria-expanded={open} onClick={() => onSelect(open ? null : row.id)}>
            <span className="g"><LevelGlyph level={row.level} /></span>
            <span className="addr"><span className={`lvl lvl-${row.level}`}>{LEVEL_TEXT[row.level] ?? row.level.toUpperCase()}</span><span className="place">{row.place}</span></span>
            <span className="side-r"><span className="score-label">Urgency</span><span className="score" aria-label={row.score === '--' ? 'Not scored yet' : `Urgency score ${row.score} out of 100`}>{row.score}{row.score !== '--' && <small>/100</small>}</span></span>
            <span className="why">{row.why}</span>
            <span className={`queue-status tone-${row.status.tone}`} title="For queued people, this timer is the time since their first report.">{row.status.text}</span>
          </button>
          {open && <div className="row-detail">
            <ul>{row.details.map((line) => <li key={line}>{line}</li>)}</ul>
            {!readOnly && <Actions row={row} rescuers={rescuers} onAssign={onAssign} onResolve={onResolve} />}
          </div>}
        </article>;
      })}
    </div>
    </>}
  </section>;
}
